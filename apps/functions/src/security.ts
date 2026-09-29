import { BackendApiError } from "./errors.js";
import type {
  ApiPermission,
  ApiPrincipal,
  ApiRole,
  AuthenticationProvider,
  AuthenticationResult,
  RateLimiter,
  RateLimitPolicy,
  RateLimitResult,
  TokenVerifier,
} from "./contracts.js";
export const PLATFORM_ADMIN_PERMISSIONS: readonly ApiPermission[] = Object.freeze([
  "platform:read",
  "platform:write",
  "platform:admin",
  "tenants:read",
  "tenants:create",
  "tenants:update",
  "tenants:suspend",
  "tenants:archive",
  "users:read",
  "users:create",
  "users:update",
  "users:suspend",
  "users:delete",
  "users:invite",
  "assistants:read",
  "assistants:write",
  "assistants:create",
  "assistants:update",
  "assistants:publish",
  "assistants:archive",
  "assistants:delete",
  "conversations:read",
  "conversations:write",
  "conversations:delete",
  "conversations:export",
  "chat:execute",
  "knowledge:read",
  "knowledge:write",
  "knowledge:create",
  "knowledge:update",
  "knowledge:delete",
  "ingestion:execute",
  "tools:execute",
  "tools:admin",
  "tools:read",
  "tools:configure",
  "metrics:read",
  "usage:read",
  "costs:read",
  "audit:read",
  "audit:export",
  "security:read",
  "security:update",
]);
export const TENANT_ADMIN_PERMISSIONS: readonly ApiPermission[] = Object.freeze(
  PLATFORM_ADMIN_PERMISSIONS.filter(
    (permission) =>
      !permission.startsWith("platform:") &&
      permission !== "tenants:create" &&
      permission !== "tenants:archive",
  ),
);
export class DevelopmentTokenVerifier implements TokenVerifier {
  public async verify(token: string): Promise<ApiPrincipal | undefined> {
    if (!token.startsWith("dev:")) return undefined;
    const [tenantId, actorId, role] = token.slice(4).split(":");
    if (
      tenantId === undefined ||
      actorId === undefined ||
      tenantId.length === 0 ||
      actorId.length === 0
    )
      return undefined;
    const admin = role === "tenant-admin" || role === "platform-admin";
    const resolvedRole: ApiRole =
      role === "platform-admin"
        ? "platform-admin"
        : admin
          ? "tenant-admin"
          : "user";
    const permissions: readonly ApiPermission[] = admin
      ? resolvedRole === "platform-admin"
        ? PLATFORM_ADMIN_PERMISSIONS
        : TENANT_ADMIN_PERMISSIONS
      : Object.freeze([
          "assistants:read",
          "conversations:read",
          "conversations:write",
          "chat:execute",
          "knowledge:read",
          "tools:execute",
        ]);
    return Object.freeze({
      actorId,
      tenantId,
      roles: Object.freeze([resolvedRole]),
      permissions,
      authenticated: true,
    });
  }
}
/** Exclusivo para desarrollo y pruebas; no valida tokens criptográficamente. */
export class DevelopmentAuthenticationProvider implements AuthenticationProvider {
  public constructor(
    private readonly verifier: TokenVerifier = new DevelopmentTokenVerifier(),
  ) {}
  public async authenticate(
    request: Request,
    signal: AbortSignal,
  ): Promise<AuthenticationResult> {
    const value = request.headers.get("authorization");
    if (value === null || !value.startsWith("Bearer "))
      return Object.freeze({ reason: "missing-token" });
    const principal = await this.verifier.verify(value.slice(7), signal);
    return principal === undefined
      ? Object.freeze({ reason: "invalid-token" })
      : Object.freeze({ principal });
  }
}
export function authorize(
  principal: ApiPrincipal,
  permission: ApiPermission,
  tenantId: string,
  assistantId?: string,
): void {
  const platform = principal.roles.includes("platform-admin");
  if (!platform && principal.tenantId !== tenantId)
    throw new BackendApiError(
      "FORBIDDEN",
      "El tenant solicitado no está autorizado.",
      403,
    );
  if (
    !principal.permissions.includes(permission) &&
    !principal.permissions.includes("admin:*")
  )
    throw new BackendApiError(
      "FORBIDDEN",
      "La operación no está autorizada.",
      403,
    );
  if (
    assistantId !== undefined &&
    principal.assistantIds !== undefined &&
    !principal.assistantIds.includes(assistantId)
  )
    throw new BackendApiError(
      "FORBIDDEN",
      "El asistente solicitado no está autorizado.",
      403,
    );
}
/** Adaptador volátil exclusivo para desarrollo y pruebas. */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<
    string,
    { count: number; reset: number }
  >();
  public async consume(
    key: string,
    policy: RateLimitPolicy,
    now: number,
  ): Promise<RateLimitResult> {
    const old = this.buckets.get(key);
    const bucket =
      old === undefined || old.reset <= now
        ? { count: 0, reset: now + policy.windowMilliseconds }
        : old;
    bucket.count += 1;
    this.buckets.set(key, bucket);
    const allowed = bucket.count <= policy.limit;
    const result: RateLimitResult = {
      allowed,
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - bucket.count),
      resetAt: new Date(bucket.reset).toISOString(),
      ...(!allowed
        ? {
            retryAfterSeconds: Math.max(
              1,
              Math.ceil((bucket.reset - now) / 1000),
            ),
          }
        : {}),
    };
    return Object.freeze(result);
  }
}
