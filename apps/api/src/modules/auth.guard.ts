import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { rolePresets, type Permission } from "@mts-lbmp/permissions";
import { LogisticsService } from "./logistics.service.js";
import { verifyAuthToken, type AuthTokenPayload } from "./security.js";

export const IS_PUBLIC_ROUTE = "isPublicRoute";
export const REQUIRED_PERMISSIONS = "requiredPermissions";
export const REQUIRED_ANY_PERMISSIONS = "requiredAnyPermissions";
export const PublicRoute = () => SetMetadata(IS_PUBLIC_ROUTE, true);
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);
/**
 * Phase 6 P6-2: the any-of companion to RequirePermissions (which is
 * all-of). Used only where two genuinely different jobs legitimately
 * reach the same read — the balance endpoints are the first case:
 * reports.view (owners, Delivery Admin — its first real enforcement)
 * OR customers.manage (the customer-desk roles that work balances from
 * the Customers module, the gate every other customer-money endpoint
 * already uses). Prefer RequirePermissions for new endpoints; reach for
 * this only with a documented reason like that one.
 */
export const RequireAnyPermissions = (...permissions: Permission[]) => SetMetadata(REQUIRED_ANY_PERMISSIONS, permissions);

/**
 * Phase 5 P5-2: the only endpoint a mustChangePassword-flagged account
 * may reach. The flag means the account's password is an admin-set
 * temporary (initial provisioning, admin reset, first-boot bootstrap);
 * until the user replaces it through this endpoint, every other
 * authenticated route is refused.
 */
const PASSWORD_CHANGE_PATH_SUFFIX = "/auth/change-password";

/**
 * Phase 5 P5-5: WHY a request was refused, stamped on the response as
 * the `x-auth-failure` header. The guard returns false for both refusal
 * kinds and Nest turns either into the same 403, so the status code
 * alone cannot tell the web shell "your session is over" apart from
 * "your (valid) session lacks this permission". The header is the
 * reliable signal the shell keys on: `session` → route back to the
 * login screen with a session-expired notice; `permission` → an
 * ordinary access-denied error, session untouched. A CORS-exposed
 * header (see main.ts) so browser fetch can read it.
 */
export const AUTH_FAILURE_HEADER = "x-auth-failure";
export type AuthFailureKind = "session" | "permission";

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
    // P5-5: every refusal is stamped with its kind before returning
    // false (see AUTH_FAILURE_HEADER). Stamping is best-effort — a
    // transport double without a response object must not break auth.
    const deny = (kind: AuthFailureKind): boolean => {
      try {
        const response = context.switchToHttp().getResponse<{
          setHeader?: (name: string, value: string) => void;
          header?: (name: string, value: string) => void;
        }>();
        if (typeof response?.setHeader === "function") response.setHeader(AUTH_FAILURE_HEADER, kind);
        else if (typeof response?.header === "function") response.header(AUTH_FAILURE_HEADER, kind);
      } catch {
        // No response object on this context — the 403 still stands.
      }
      return false;
    };
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (!token) return deny("session");

    // Phase 5 P5-2: ONLY real JWTs authenticate. The static `demo-token-*`
    // bearer map that used to be consulted here (audit Door 3 — including
    // a System Admin token that bypassed even account disabling) is
    // deleted along with the demo accounts.
    const verifiedToken = this.verifyToken(token);
    if (!verifiedToken?.sub) return deny("session");
    const user = this.logistics.getAuthUserById(verifiedToken.sub);
    if (!user) return deny("session");
    // Phase 5 P5-1 revocation: a real JWT carries the sessionVersion it was
    // issued under (`sv`). Credential changes bump the stored version, so
    // a mismatch means the token predates the change and is rejected even
    // though its signature and expiry are still fine.
    const currentVersion = (user as { sessionVersion?: number }).sessionVersion;
    if (currentVersion !== undefined && (verifiedToken.sv ?? 0) !== currentVersion) return deny("session");
    // Phase 5 P5-2 forced password change: a flagged account's token is
    // good for exactly one thing — setting a real password.
    if ((user as { mustChangePassword?: boolean }).mustChangePassword) {
      const requestPath = (request.path ?? request.url ?? "").split("?")[0] ?? "";
      if (!requestPath.endsWith(PASSWORD_CHANGE_PATH_SUFFIX)) return deny("session");
    }
    request.user = user;
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS, [
      context.getHandler(),
      context.getClass()
    ]);
    const requiredAnyPermissions = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_ANY_PERMISSIONS, [
      context.getHandler(),
      context.getClass()
    ]);
    const userPermissions = rolePresets[user.role] ?? [];
    // All-of gate (the established pattern): every listed permission.
    if (requiredPermissions?.length && !requiredPermissions.every((permission) => userPermissions.includes(permission))) {
      return deny("permission");
    }
    // Any-of gate (P6-2, see RequireAnyPermissions): at least one.
    if (requiredAnyPermissions?.length && !requiredAnyPermissions.some((permission) => userPermissions.includes(permission))) {
      return deny("permission");
    }
    return true;
  }

  private verifyToken(token: string) {
    try {
      return this.jwt.verify<AuthTokenPayload>(token);
    } catch {
      return verifyAuthToken(token);
    }
  }
}
