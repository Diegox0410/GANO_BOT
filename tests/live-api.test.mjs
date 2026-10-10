import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createLiveHandler, describeLiveError, validateLivePayload } from "../api/live.mjs";

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

test("Preview allowlist de FLOES rechaza MG y tenant ausente antes del runtime", () => {
  const environment = { GANOBOT_COMMERCE_ALLOWED_TENANTS: "tenant-floes" };
  assert.equal(validateLivePayload({ ...VALID_BODY, tenantId: "tenant-mg" }, environment).status, 403);
  assert.equal(validateLivePayload({ ...VALID_BODY, tenantId: "" }, environment).status, 403);
  assert.equal(validateLivePayload(VALID_BODY, environment).value.tenantId, "tenant-floes");
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

test("live entrega multimedia HTTPS ordenado y selecciona el runtime del tenant", async () => {
  let requestedTenant;
  const result = await invoke({ token: TOKEN, runtimeFactory: async tenantId => {
    requestedTenant = tenantId;
    return { async processLiveWhatsApp() { return { reply: "Daniela Vino", messages: [{ type: "image", url: "https://storage.example.test/daniela/vino.jpeg", caption: "Daniela · Vino" }, { type: "text", text: "Daniela Vino" }, { type: "image", url: "C:\\Users\\User\\vino.jpeg" }] }; } };
  } });
  assert.equal(requestedTenant, "tenant-floes"); assert.equal(result.status, 200);
  assert.deepEqual(result.payload.messages.map(message => message.type), ["image", "text"]);
});

test("live valida URL del comprobante sin permitir rutas locales", () => {
  assert.equal(validateLivePayload({ ...VALID_BODY, paymentProofUrl: "C:\\Users\\proof.jpg" }).status, 400);
  assert.equal(validateLivePayload({ ...VALID_BODY, paymentProofUrl: "https://storage.example.test/proof.jpg" }).value.paymentProofUrl, "https://storage.example.test/proof.jpg");
});

test("live valida referencia privada Meta y la entrega al runtime sin publicar el comprobante", async () => {
  const paymentProofReference = "meta-whatsapp://123456789/media/987654321";
  let received;
  const result = await invoke({ token: TOKEN, body: { ...VALID_BODY, paymentProofReference }, runtimeFactory: async () => ({ async processLiveWhatsApp(input) { received = input; return { reply: "Comprobante pendiente de revisión" }; } }) });
  assert.equal(result.status, 200);
  assert.equal(received.paymentProofReference, paymentProofReference);
  for (const reference of ["file:///proof.jpg", "meta-whatsapp://123456789/media/../../secret", "meta-whatsapp://tenant-mg/media/123", "https://localhost/a", "meta-whatsapp://123456789/media/id?token=secret"]) assert.equal(validateLivePayload({ ...VALID_BODY, paymentProofReference: reference }).status, 400);
});

test("live retorna trazabilidad comercial mínima y rechaza metadata de otro tenant", async () => {
  const result = await invoke({ token: TOKEN, runtimeFactory: async () => ({ async processLiveWhatsApp() { return { reply: "Pedido creado", commerce: { tenantId: "tenant-floes", customerId: "customer-1", orderId: "order-1", phone: "593000000001", token: "must-not-leak" } }; } }) });
  assert.deepEqual(result.payload.commerce, { tenantId: "tenant-floes", customerId: "customer-1", orderId: "order-1" });
  const otherTenant = await invoke({ token: TOKEN, runtimeFactory: async () => ({ async processLiveWhatsApp() { return { reply: "Respuesta", commerce: { tenantId: "tenant-mg", orderId: "mg-order" } }; } }) });
  assert.equal(otherTenant.payload.commerce, undefined);
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
  assert.deepEqual(logs, ["[GANO_BOT Live] request-failed"]);
});

test("el logging conserva etapa y status solo mediante campos seguros", () => {
  const error = new Error("Bearer secret-value");
  Object.assign(error, {
    stage: "resolve-customer-identity",
    status: 401,
    safeMessage: "Identity tool ended with failed.",
  });
  assert.deepEqual(describeLiveError(error, "commerce-processing"), {
    stage: "resolve-customer-identity",
    status: 401,
    name: "Error",
    message: "Identity tool ended with failed.",
  });
  assert.equal(JSON.stringify(describeLiveError(new Error("secret-value"), "runtime-initialization")).includes("secret-value"), false);
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
