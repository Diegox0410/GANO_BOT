import test from "node:test";
import assert from "node:assert/strict";

import {
  validateLivePayload,
  createLiveHandler,
} from "../api/live.mjs";

function payload(tenantId) {
  return {
    tenantId,
    channel: "WHATSAPP",
    providerMessageId: `wamid-${tenantId}`,
    customer: {
      phone: "593999999999",
      name: "Cliente",
    },
    text: "Hola",
  };
}

function responseHarness() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(value = "") {
      this.body = value;
    },
  };
}

test("live acepta FLOES y MG como tenants comerciales habilitados", () => {
  const floes = validateLivePayload(payload("tenant-floes"));
  const mg = validateLivePayload(payload("tenant-mg"));

  assert.equal(floes.value?.tenantId, "tenant-floes");
  assert.equal(mg.value?.tenantId, "tenant-mg");
});

test("live rechaza DGNG y tenants arbitrarios mientras no esten habilitados", () => {
  assert.equal(validateLivePayload(payload("tenant-dgng")).status, 403);
  assert.equal(validateLivePayload(payload("tenant-attacker")).status, 403);
});

test("live preserva tenant-mg hasta el runtime sin sustituirlo por FLOES", async () => {
  let received;

  const handler = createLiveHandler({
    environment: {
      GANOBOT_LIVE_BEARER_TOKEN: "test-live-secret",
    },
    runtimeFactory: async () => ({
      async processLiveWhatsApp(value) {
        received = value;
        return { reply: "Respuesta MG" };
      },
    }),
    logger: {
      error() {},
    },
  });

  const request = {
    method: "POST",
    headers: {
      authorization: "Bearer test-live-secret",
    },
    body: payload("tenant-mg"),
  };

  const response = responseHarness();

  await handler(request, response);

  assert.equal(response.statusCode, 200);
  assert.equal(received.tenantId, "tenant-mg");
  assert.equal(received.channel, "WHATSAPP");
  assert.equal(JSON.parse(response.body).reply, "Respuesta MG");
});