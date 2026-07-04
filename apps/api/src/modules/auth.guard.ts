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

const demoTokens = new Map([
  ["demo-token-user_owner", { id: "user_daet_owner", role: "Daet Owner", branchAccess: "Daet" }],
  ["demo-token-user_daet_owner", { id: "user_daet_owner", role: "Daet Owner", branchAccess: "Daet" }],
  ["demo-token-user_naga_owner", { id: "user_naga_owner", role: "Naga Owner", branchAccess: "Naga" }],
  ["demo-token-user_system_admin", { id: "user_system_admin", role: "System Admin", branchAccess: "All branches" }],
  ["demo-token-user_receiving", { id: "user_receiving", role: "Receiving Staff" }],
  ["demo-token-user_delivery", { id: "user_delivery", role: "Delivery Staff" }],
  ["demo-token-user_customer", { id: "user_customer", role: "Customer Owner" }]
]);

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

    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; user?: unknown }>();
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (!token) return false;

    const verifiedToken = this.verifyToken(token);
    const tokenUserId = token.startsWith("demo-token-") ? token.slice("demo-token-".length) : verifiedToken?.sub ?? "";
    const user = demoTokens.get(token) ?? (tokenUserId ? this.logistics.getAuthUserById(tokenUserId) : undefined);
    if (!user) return false;
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
