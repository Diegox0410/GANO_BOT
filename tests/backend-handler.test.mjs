import assert from "node:assert/strict";
import test from "node:test";
import { createBackendHandler } from "../api/backend.mjs";

test("backend handler initializes the configured commerce tenant", async () => {
  let initializedTenant;
  const handler = createBackendHandler({
    environment: { GANO_COMMERCE_TENANT_ID: "tenant-floes" },
    runtimeFactory: async (tenantId) => {
      initializedTenant = tenantId;
      return {
        application: {
          handle: async () =>
            new Response(JSON.stringify({ success: true }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
        },
      };
    },
    logger: { error() {} },
  });
  const response = {
    headers: new Map(),
    statusCode: 200,
    body: undefined,
    setHeader(name, value) {
      this.headers.set(name.toLowerCase(), value);
    },
    end(body) {
      this.body = body;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = JSON.stringify(body);
    },
  };

  await handler(
    { method: "GET", headers: {}, query: { path: "health" } },
    response,
  );

  assert.equal(initializedTenant, "tenant-floes");
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { success: true });
});
