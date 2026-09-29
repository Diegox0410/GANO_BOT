import assert from "node:assert/strict";
import type { DecodedIdToken } from "firebase-admin/auth";
import { FirebaseAuthenticationProvider } from "../integrations/firebaseAuthentication.js";
import { createBackendApplication } from "../application.js";
import { InMemoryAssistantRepository } from "../repositories.js";

assert.throws(
  () =>
    createBackendApplication({
      assistants: new InMemoryAssistantRepository(),
      chat: Object.freeze({
        async generate() {
          throw new Error("not used");
        },
      }),
    }),
  /AuthenticationProvider is required/,
);

function decoded(overrides: Readonly<Record<string, unknown>> = {}): DecodedIdToken {
  return {
    aud: "project",
    auth_time: 1,
    exp: 2,
    firebase: { identities: {}, sign_in_provider: "custom" },
    iat: 1,
    iss: "https://securetoken.google.com/project",
    sub: "user-1",
    uid: "user-1",
    tenantId: "tenant-a",
    roles: ["user"],
    ...overrides,
  } as DecodedIdToken;
}

const provider = new FirebaseAuthenticationProvider({
  verifyIdToken: async (token) => {
    if (token === "invalid") throw new Error("invalid signature");
    if (token === "foreign") return decoded({ tenantId: "tenant-b" });
    return decoded();
  },
});

const authenticated = await provider.authenticate(
  new Request("https://api.example.test/v1/chat", {
    headers: { authorization: "Bearer signed-token" },
  }),
  new AbortController().signal,
);
assert.equal(authenticated.principal?.tenantId, "tenant-a");
assert.equal(authenticated.principal?.actorId, "user-1");
assert.deepEqual(authenticated.principal?.permissions, [
  "assistants:read",
  "conversations:read",
  "conversations:write",
  "chat:execute",
  "knowledge:read",
  "tools:execute",
]);

const unsigned = await provider.authenticate(
  new Request("https://api.example.test/v1/chat", {
    headers: { authorization: "Bearer dev:tenant-a:user-1:tenant-admin" },
  }),
  new AbortController().signal,
);
assert.equal(unsigned.principal, undefined);
assert.equal(unsigned.reason, "invalid-token");

const missingTenantProvider = new FirebaseAuthenticationProvider({
  verifyIdToken: async () => decoded({ tenantId: undefined, tenant_id: undefined }),
});
const missingTenant = await missingTenantProvider.authenticate(
  new Request("https://api.example.test/v1/chat", {
    headers: { authorization: "Bearer signed-token" },
  }),
  new AbortController().signal,
);
assert.equal(missingTenant.principal, undefined);
assert.equal(missingTenant.reason, "invalid-claims");

console.log("Firebase Authentication: signed claims, fail-closed tenant y rechazo dev token OK");
