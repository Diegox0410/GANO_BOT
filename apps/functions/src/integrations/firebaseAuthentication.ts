import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import type {
  ApiPermission,
  ApiPrincipal,
  ApiRole,
  AuthenticationProvider,
  AuthenticationResult,
} from "../contracts.js";
import {
  PLATFORM_ADMIN_PERMISSIONS,
  TENANT_ADMIN_PERMISSIONS,
} from "../security.js";
import { getGanoFirebaseAdminApp } from "./firebaseAdmin.js";

const USER_PERMISSIONS: readonly ApiPermission[] = Object.freeze([
  "assistants:read",
  "conversations:read",
  "conversations:write",
  "chat:execute",
  "knowledge:read",
  "tools:execute",
]);

const ROLES = new Set<ApiRole>([
  "guest",
  "user",
  "operator",
  "assistant-admin",
  "tenant-admin",
  "platform-admin",
]);

function strings(value: unknown): readonly string[] {
  if (typeof value === "string" && value.trim()) {
    return Object.freeze([value.trim()]);
  }
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(
    value
      .filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
      .map((item) => item.trim()),
  );
}

function principalFromToken(token: DecodedIdToken): ApiPrincipal | undefined {
  const tenantId =
    typeof token.tenantId === "string"
      ? token.tenantId.trim()
      : typeof token.tenant_id === "string"
        ? token.tenant_id.trim()
        : "";
  if (!tenantId || !token.uid) return undefined;

  const roles = strings(token.roles).filter((role): role is ApiRole =>
    ROLES.has(role as ApiRole),
  );
  const normalizedRoles: readonly ApiRole[] = Object.freeze(
    roles.length > 0 ? roles : ["user"],
  );
  const isPlatformAdmin = normalizedRoles.includes("platform-admin");
  const isTenantAdmin = normalizedRoles.includes("tenant-admin");

  return Object.freeze({
    actorId: token.uid,
    tenantId,
    roles: normalizedRoles,
    permissions: isPlatformAdmin
      ? PLATFORM_ADMIN_PERMISSIONS
      : isTenantAdmin
        ? TENANT_ADMIN_PERMISSIONS
        : USER_PERMISSIONS,
    assistantIds: strings(token.assistantIds ?? token.assistant_ids),
    authenticated: true,
  });
}

export interface FirebaseAuthenticationProviderOptions {
  readonly verifyIdToken?: (token: string) => Promise<DecodedIdToken>;
}

/** Verifica Firebase ID tokens y deriva el scope únicamente desde claims firmados. */
export class FirebaseAuthenticationProvider implements AuthenticationProvider {
  private readonly verifyIdToken: (token: string) => Promise<DecodedIdToken>;

  public constructor(options: FirebaseAuthenticationProviderOptions = {}) {
    this.verifyIdToken =
      options.verifyIdToken ??
      ((token) => getAuth(getGanoFirebaseAdminApp()).verifyIdToken(token, true));
  }

  public async authenticate(
    request: Request,
    _signal: AbortSignal,
  ): Promise<AuthenticationResult> {
    const authorization = request.headers.get("authorization");
    if (authorization === null || !authorization.startsWith("Bearer ")) {
      return Object.freeze({ reason: "missing-token" });
    }
    const token = authorization.slice(7).trim();
    if (!token || token.startsWith("dev:")) {
      return Object.freeze({ reason: "invalid-token" });
    }
    try {
      const decoded = await this.verifyIdToken(token);
      const principal = principalFromToken(decoded);
      return principal === undefined
        ? Object.freeze({ reason: "invalid-claims" })
        : Object.freeze({ principal });
    } catch {
      return Object.freeze({ reason: "invalid-token" });
    }
  }
}
