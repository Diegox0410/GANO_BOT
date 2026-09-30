import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createLiveHandler, validateLivePayload } from "../api/live.mjs";

const TOKEN = "test-live-token-with-enough-entropy";
const VALID_BODY = Object.freeze({
  tenantId: "tenant-floes",
  channel: "WHATSAPP",
  providerMessageId: "wamid.test-1",
  customer: Object.freeze({ phone: "+57 300 123 4567", name: "  Ana  " }),
  text: "  ¿Qué productos tienen?  ",
});

function createResponse() {
  const result = { status: 0, headers: {}, payload: undefined };
  return {
    result,
    response: {
      setHeader(name, value) { result.headers[name] = value; },
      end(value) {
        result.payload = value === undefined ? undefined : JSON.parse(value);
      },
      set statusCode(value) { result.status = value; },
    },
  };
}

async function invoke({ token, body = VALID_BODY, runtimeFactory, logger } = {}) {
  const { result, response } = createResponse();
  const handler = createLiveHandler({
    environment: { GANOBOT_LIVE_BEARER_TOKEN: TOKEN },
    runtimeFactory: runtimeFactory ?? (async () => ({
      processLiveWhatsApp: async () => ({ reply: "Respuesta segura" }),
    })),
    logger: logger ?? { error() {} },
  });
  await handler({
    method: "POST",
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    body,
  }, response);
  return result;
}

test("rechaza solicitudes sin bearer token o con un token incorrecto", async () => {
  assert.equal((await invoke()).status, 401);
  assert.equal((await invoke({ token: "incorrecto" })).status, 401);
});

test("rechaza otro tenant, un canal distinto y payloads inválidos", async () => {
  const otherTenant = await invoke({ token: TOKEN, body: { ...VALID_BODY, tenantId: "tenant-other" } });
  const otherChannel = await invoke({ token: TOKEN, body: { ...VALID_BODY, channel: "WEB" } });
  const invalid = await invoke({ token: TOKEN, body: { ...VALID_BODY, text: "" } });
  assert.equal(otherTenant.status, 403);
  assert.equal(otherChannel.status, 400);
  assert.equal(invalid.status, 400);
});

test("normaliza identidad y procesa una solicitud válida con el runtime existente", async () => {
  let received;
  const result = await invoke({
    token: TOKEN,
    runtimeFactory: async () => ({
      processLiveWhatsApp: async (input) => {
        received = input;
        return { reply: "  Productos disponibles  " };
      },
    }),
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.payload, { reply: "Productos disponibles" });
  assert.deepEqual(received, {
    tenantId: "tenant-floes",
    channel: "WHATSAPP",
    providerMessageId: "wamid.test-1",
    customer: { phone: "573001234567", name: "Ana" },
    text: "¿Qué productos tienen?",
  });
});

test("no filtra secretos cuando el runtime falla", async () => {
  const leakedSecret = "never-return-this-secret";
  const logs = [];
  const result = await invoke({
    token: TOKEN,
    runtimeFactory: async () => {
      throw new Error(leakedSecret);
    },
    logger: { error(value) { logs.push(value); } },
  });
  const observable = JSON.stringify({ payload: result.payload, logs });
  assert.equal(result.status, 503);
  assert.equal(observable.includes(leakedSecret), false);
});

test("la validación no acepta privilegios declarados por el cliente", () => {
  const result = validateLivePayload({
    ...VALID_BODY,
    roles: ["platform-admin"],
    permissions: ["*"],
    customer: { ...VALID_BODY.customer, tenantId: "tenant-other" },
  });
  assert.equal("value" in result, true);
  assert.equal("roles" in result.value, false);
  assert.equal("permissions" in result.value, false);
  assert.equal("tenantId" in result.value.customer, false);
});

test("el runtime live no registra operaciones humanas ni usa su credencial", async () => {
  const source = await readFile(new URL("../scripts/gano-hosted-runtime.mjs", import.meta.url), "utf8");
  const forbidden = [
    "CHOPIFY_OPERATIONS_API_TOKEN",
    "commerce.approvePayment",
    "commerce.rejectPayment",
    "commerce.markOrderPreparing",
    "commerce.markOrderReady",
    "commerce.markOrderDispatched",
    "commerce.markOrderDelivered",
  ];
  for (const value of forbidden) assert.equal(source.includes(value), false, value);
});
