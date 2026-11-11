import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { rolePresets, type Permission } from "@mts-lbmp/permissions";
import { LogisticsService } from "./logistics.service.js";
import { verifyAuthToken, type AuthTokenPayload } from "./security.js";

export const IS_PUBLIC_ROUTE = "isPublicRoute";
export const REQUIRED_PERMISSIONS = "requiredPermissions";
export const PublicRoute = () => SetMetadata(IS_PUBLIC_ROUTE, true);
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);

/**
 * Phase 5 P5-2: the only endpoint a mustChangePassword-flagged account
 * may reach. The flag means the account's password is an admin-set
 * temporary (initial provisioning, admin reset, first-boot bootstrap);
 * until the user replaces it through this endpoint, every other
 * authenticated route is refused.
 */
const PASSWORD_CHANGE_PATH_SUFFIX = "/auth/change-password";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(LogisticsService) private readonly logistics: LogisticsService,
    @Inject(JwtService) private readonly jwt: JwtService
  ) {}

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass()
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: unknown;
      url?: string;
      path?: string;
    }>();
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (!token) return false;

    // Phase 5 P5-2: ONLY real JWTs authenticate. The static `demo-token-*`
    // bearer map that used to be consulted here (audit Door 3 — including
    // a System Admin token that bypassed even account disabling) is
    // deleted along with the demo accounts.
    const verifiedToken = this.verifyToken(token);
    if (!verifiedToken?.sub) return false;
    const user = this.logistics.getAuthUserById(verifiedToken.sub);
    if (!user) return false;
    // Phase 5 P5-1 revocation: a real JWT carries the sessionVersion it was
    // issued under (`sv`). Credential changes bump the stored version, so
    // a mismatch means the token predates the change and is rejected even
    // though its signature and expiry are still fine.
    const currentVersion = (user as { sessionVersion?: number }).sessionVersion;
    if (currentVersion !== undefined && (verifiedToken.sv ?? 0) !== currentVersion) return false;
    // Phase 5 P5-2 forced password change: a flagged account's token is
    // good for exactly one thing — setting a real password.
    if ((user as { mustChangePassword?: boolean }).mustChangePassword) {
      const requestPath = (request.path ?? request.url ?? "").split("?")[0] ?? "";
      if (!requestPath.endsWith(PASSWORD_CHANGE_PATH_SUFFIX)) return false;
    }
    request.user = user;
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS, [
      context.getHandler(),
      context.getClass()
    ]);
    if (!requiredPermissions?.length) return true;

    const userPermissions = rolePresets[user.role] ?? [];
    return requiredPermissions.every((permission) => userPermissions.includes(permission));
  }

  private verifyToken(token: string) {
    try {
      return this.jwt.verify<AuthTokenPayload>(token);
    } catch {
      return verifyAuthToken(token);
    }
  }
}
