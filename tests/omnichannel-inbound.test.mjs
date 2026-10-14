import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createChopifyInboundHttpAdapter,
  createChopifyOutboundHttpAdapter,
  createFacebookInboundAdapter,
  createInstagramInboundAdapter,
  createOmnichannelInboundRelay,
  createTikTokInboundAdapter,
  createWebInboundAdapter,
} from "../scripts/omnichannel-relay.mjs";
import defaultOmnichannelHandler, { createDefaultOmnichannelHandler, createOmnichannelInboundHandler } from "../api/omnichannel-inbound.mjs";
import { createFloesEngineFixture } from "./helpers/floes-commerce-engine.mjs";

const now = () => new Date("2026-10-13T12:00:00.000Z");
const tenantId = "tenant-floes";
const adapters = [
  createWebInboundAdapter({ tenantId }),
  createInstagramInboundAdapter({ tenantId, pageId: "ig-page-1" }),
  createFacebookInboundAdapter({ tenantId, pageId: "fb-page-1" }),
  createTikTokInboundAdapter({ tenantId, businessAccountId: "tt-business-1" }),
];
const events = [
  { channel: "WEB", messageId: "web-msg-1", sessionId: "web-session-1", visitorId: "web-visitor-1", text: "Hola desde web", customer: { name: "Web Customer", email: "web@example.test" } },
  { channel: "INSTAGRAM", entry: [{ id: "ig-page-1", messaging: [{ sender: { id: "ig-user-1" }, recipient: { id: "ig-page-1" }, timestamp: 1791892800000, message: { mid: "ig-msg-1", text: "Hola desde Instagram" } }] }] },
  { channel: "FACEBOOK", entry: [{ id: "fb-page-1", messaging: [{ sender: { id: "fb-user-1" }, recipient: { id: "fb-page-1" }, timestamp: 1791892800000, message: { mid: "fb-msg-1", text: "Hola desde Facebook" } }] }] },
  { channel: "TIKTOK", message_id: "tt-msg-1", conversation_id: "tt-thread-1", sender_id: "tt-user-1", to_business_id: "tt-business-1", timestamp: 1791892800000, text: "Hola desde TikTok" },
];

test("adapters normalizan WEB, Instagram, Facebook y TikTok al mismo contrato Chopify", () => {
  for (let index = 0; index < adapters.length; index += 1) {
    const adapter = adapters[index];
    const event = events[index];
    assert.ok(adapter);
    assert.ok(event);
    const [envelope] = adapter.normalize(event, now);
    assert.equal(envelope?.tenantId, tenantId);
    assert.equal(envelope?.channel, event.channel);
    assert.equal(typeof envelope?.provider, "string");
    assert.equal(typeof envelope?.providerMessageId, "string");
    assert.equal(typeof envelope?.externalConversationId, "string");
    assert.equal(typeof envelope?.externalCustomerId, "string");
    assert.equal(typeof envelope?.text, "string");
    assert.equal(envelope?.receivedAt, "2026-10-13T12:00:00.000Z");
    assert.match(envelope?.conversationId ?? "", /^conversation_[a-f0-9]{64}$/);
  }
  assert.notEqual(adapters[0]?.normalize(events[0], now)[0]?.conversationId, adapters[1]?.normalize(events[1], now)[0]?.conversationId);
});

test("relay persists canonically once per tenant/provider/channel/message and skips repeated dispatch", async () => {
  const persisted = [];
  const outboundPersisted = [];
  const processed = [];
  const relay = createOmnichannelInboundRelay({
    adapters,
    allowedTenantIds: [tenantId],
    now,
    async persistInbound(envelope) { persisted.push(envelope); return { conversationId: envelope.conversationId, customerId: "customer-1" }; },
    async persistOutbound(envelope) { outboundPersisted.push(envelope); },
    async processMessage(envelope) { processed.push(envelope); return { reply: "Recibido", commerce: { correlationId: "corr-1" } }; },
  });
  const first = await relay.receive("INSTAGRAM", tenantId, events[1]);
  const duplicate = await relay.receive("INSTAGRAM", tenantId, events[1]);
  assert.equal(first[0]?.status, "processed");
  assert.equal(duplicate[0]?.status, "duplicate");
  assert.equal(persisted.length, 1);
  assert.equal(processed.length, 1);
  assert.equal(outboundPersisted.length, 1);
  assert.equal(processed[0]?.customerId, "customer-1");
});

test("relay fails closed on tenant, channel, and provider-account mismatches", async () => {
  const relay = createOmnichannelInboundRelay({ adapters, allowedTenantIds: [tenantId], persistInbound: async envelope => ({ conversationId: envelope.conversationId, customerId: "customer-1" }), persistOutbound: async () => {}, processMessage: async () => ({ reply: "Recibido" }) });
  await assert.rejects(() => relay.receive("WEB", "tenant-other", events[0]), /tenant-not-allowed/);
  await assert.rejects(() => relay.receive("FACEBOOK", tenantId, { ...events[2], channel: "INSTAGRAM" }), /channel-not-allowed/);
  await assert.rejects(() => relay.receive("INSTAGRAM", tenantId, { entry: [{ id: "other-page", messaging: [] }] }), /provider-account-not-allowed/);
  await assert.rejects(() => relay.receive("TIKTOK", tenantId, { ...events[3], to_business_id: "other-business" }), /provider-account-not-allowed/);
  await assert.rejects(() => relay.receive("WEB", tenantId, { ...events[0], messageId: "" }), /invalid-provider-message-id/);
});

test("a persisted inbound resumes outbound after a partial failure without rerunning the processor", async () => {
  let inboundCalls = 0;
  let processCalls = 0;
  let outboundCalls = 0;
  const attemptedOutbound = [];
  const relay = createOmnichannelInboundRelay({
    adapters,
    allowedTenantIds: [tenantId],
    now,
    persistInbound: async envelope => ({ conversationId: envelope.conversationId, customerId: "customer-1", duplicate: inboundCalls++ > 0 }),
    async persistOutbound(envelope) {
      outboundCalls += 1;
      attemptedOutbound.push(envelope);
      if (outboundCalls === 1) throw new Error("synthetic-outbound-failure");
    },
    async processMessage() { processCalls += 1; return { reply: "Respuesta recuperable", commerce: { correlationId: "corr-recovery" } }; },
  });
  await assert.rejects(() => relay.receive("WEB", tenantId, events[0]), /synthetic-outbound-failure/);
  const replay = await relay.receive("WEB", tenantId, events[0]);
  assert.equal(replay[0]?.status, "processed");
  assert.equal(replay[0]?.result.reply, "Respuesta recuperable");
  assert.equal(inboundCalls, 2);
  assert.equal(processCalls, 1);
  assert.equal(outboundCalls, 2);
  assert.deepEqual(attemptedOutbound[1], attemptedOutbound[0]);
});

test("a persisted inbound retries processing after a processor failure", async () => {
  let inboundCalls = 0;
  let processCalls = 0;
  let outboundCalls = 0;
  const relay = createOmnichannelInboundRelay({
    adapters,
    allowedTenantIds: [tenantId],
    now,
    persistInbound: async envelope => ({ conversationId: envelope.conversationId, customerId: "customer-1", duplicate: inboundCalls++ > 0 }),
    async persistOutbound() { outboundCalls += 1; },
    async processMessage() {
      processCalls += 1;
      if (processCalls === 1) throw new Error("synthetic-processing-failure");
      return { reply: "Respuesta reintentada", commerce: { correlationId: "corr-processing-retry" } };
    },
  });
  await assert.rejects(() => relay.receive("WEB", tenantId, events[0]), /synthetic-processing-failure/);
  const replay = await relay.receive("WEB", tenantId, events[0]);
  assert.equal(replay[0]?.status, "processed");
  assert.equal(replay[0]?.result.reply, "Respuesta reintentada");
  assert.equal(inboundCalls, 2);
  assert.equal(processCalls, 2);
  assert.equal(outboundCalls, 1);
});

test("a completed inbound replay returns duplicate without processing or enqueueing another outbound", async () => {
  let inboundCalls = 0;
  let processCalls = 0;
  let outboundCalls = 0;
  const relay = createOmnichannelInboundRelay({
    adapters,
    allowedTenantIds: [tenantId],
    now,
    persistInbound: async envelope => ({ conversationId: envelope.conversationId, customerId: "customer-1", duplicate: inboundCalls++ > 0 }),
    async persistOutbound() { outboundCalls += 1; },
    async processMessage() { processCalls += 1; return { reply: "Respuesta final" }; },
  });
  const first = await relay.receive("WEB", tenantId, events[0]);
  const replay = await relay.receive("WEB", tenantId, events[0]);
  assert.equal(first[0]?.status, "processed");
  assert.equal(replay[0]?.status, "duplicate");
  assert.equal(inboundCalls, 1);
  assert.equal(processCalls, 1);
  assert.equal(outboundCalls, 1);
});

test("concurrent duplicates share one processing and outbound persistence attempt", async () => {
  let inboundCalls = 0;
  let processCalls = 0;
  let outboundCalls = 0;
  const relay = createOmnichannelInboundRelay({
    adapters,
    allowedTenantIds: [tenantId],
    now,
    async persistInbound(envelope) { inboundCalls += 1; return { conversationId: envelope.conversationId, customerId: "customer-1" }; },
    async persistOutbound() { outboundCalls += 1; },
    async processMessage() {
      processCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return { reply: "Una respuesta" };
    },
  });
  const [left, right] = await Promise.all([
    relay.receive("WEB", tenantId, events[0]),
    relay.receive("WEB", tenantId, events[0]),
  ]);
  assert.equal(left[0]?.status, "processed");
  assert.equal(right[0]?.status, "processed");
  assert.equal(inboundCalls, 1);
  assert.equal(processCalls, 1);
  assert.equal(outboundCalls, 1);
});

test("human takeover blocks a pending bot reply permanently across later handback", async () => {
  let processCalls = 0;
  let persistCalls = 0;
  let handedToHuman = true;
  const relay = createOmnichannelInboundRelay({
    adapters,
    allowedTenantIds: [tenantId],
    now,
    async persistInbound(envelope) { return { conversationId: envelope.conversationId, customerId: "customer-1", duplicate: persistCalls++ > 0 }; },
    async persistOutbound() {
      if (handedToHuman) throw new Error("chopify-outbound-persist-failed-409-AUTOMATION_BLOCKED_BY_HANDOFF");
    },
    async processMessage() { processCalls += 1; return { reply: "Respuesta vieja", commerce: { correlationId: "stale-reply" } }; },
  });

  await assert.rejects(() => relay.receive("WEB", tenantId, events[0]), /AUTOMATION_BLOCKED_BY_HANDOFF/);
  handedToHuman = false;
  const replayAfterHandback = await relay.receive("WEB", tenantId, events[0]);
  assert.equal(replayAfterHandback[0]?.status, "duplicate");
  assert.equal(processCalls, 1);
  assert.equal(persistCalls, 1);
});

test("a new relay fails closed when Chopify reports an inbound duplicate without local stage state", async () => {
  let inboundPersisted = false;
  const makeRelay = counters => createOmnichannelInboundRelay({
    adapters,
    allowedTenantIds: [tenantId],
    now,
    async persistInbound(envelope) {
      const duplicate = inboundPersisted;
      inboundPersisted = true;
      return { conversationId: envelope.conversationId, customerId: "customer-1", duplicate };
    },
    async persistOutbound() { counters.outboundCalls += 1; },
    async processMessage() { counters.processCalls += 1; return { reply: "No debe generar otra respuesta" }; },
  });

  const originalCounters = { processCalls: 0, outboundCalls: 0 };
  const original = await makeRelay(originalCounters).receive("WEB", tenantId, events[0]);
  assert.equal(original[0]?.status, "processed");
  assert.deepEqual(originalCounters, { processCalls: 1, outboundCalls: 1 });

  const restartedCounters = { processCalls: 0, outboundCalls: 0 };
  const replay = await makeRelay(restartedCounters).receive("WEB", tenantId, events[0]);
  assert.equal(replay[0]?.status, "duplicate");
  assert.deepEqual(restartedCounters, { processCalls: 0, outboundCalls: 0 });
});

test("Chopify HTTP adapter sends tenant bearer, canonical envelope, timeout signal and stable idempotency key", async () => {
  const captured = [];
  const adapter = createChopifyInboundHttpAdapter({
    allowedTenantIds: [tenantId],
    tenantConfigurations: { [tenantId]: { baseUrl: "https://chopify.example.test", bearerToken: "synthetic-service-token" } },
    async fetchImplementation(url, init) {
      captured.push({ url: String(url), init });
      const envelope = JSON.parse(init.body);
      return new Response(JSON.stringify({ conversationId: envelope.conversationId, customerId: "customer-1", duplicate: false }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const envelope = adapters[0].normalize(events[0], now)[0];
  const result = await adapter.persist(envelope);
  assert.equal(result.conversationId, envelope.conversationId);
  assert.equal(captured[0]?.url, "https://chopify.example.test/api/channel-inbound");
  assert.equal(captured[0]?.init.headers.authorization, "Bearer synthetic-service-token");
  assert.match(captured[0]?.init.headers["idempotency-key"] ?? "", /^[a-f0-9]{64}$/);
  assert.equal(captured[0]?.init.signal instanceof AbortSignal, true);
  await assert.rejects(() => adapter.persist({ ...envelope, tenantId: "tenant-other" }), /tenant-not-allowed/);
  const unconfigured = createChopifyInboundHttpAdapter({ allowedTenantIds: [tenantId], tenantConfigurations: {} });
  await assert.rejects(() => unconfigured.persist(envelope), /configuration-unavailable/);
});

test("Chopify outbound adapter persists reply with exact idempotency contract and never dispatches externally", async () => {
  const captured = [];
  const adapter = createChopifyOutboundHttpAdapter({
    allowedTenantIds: [tenantId],
    tenantConfigurations: { [tenantId]: { baseUrl: "https://chopify.example.test", bearerToken: "synthetic-service-token" } },
    async fetchImplementation(url, init) {
      captured.push({ url: String(url), init });
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({ conversationId: body.conversationId, customerId: body.customerId, messageId: body.messageId, duplicate: false }), { status: 200 });
    },
  });
  const outbound = { tenantId, channel: "INSTAGRAM", provider: "META", conversationId: `conversation_${"a".repeat(64)}`, customerId: "customer-1", messageId: "gano-message-1", correlationId: "corr-1", text: "Respuesta local", createdAt: "2026-10-13T12:00:00.000Z" };
  const result = await adapter.persist(outbound);
  assert.equal(result.messageId, outbound.messageId);
  assert.equal(captured[0]?.url, "https://chopify.example.test/api/channel-outbound");
  assert.equal(captured[0]?.init.headers.authorization, "Bearer synthetic-service-token");
  assert.equal(captured[0]?.init.headers["idempotency-key"], createHash("sha256").update(`${tenantId}:${outbound.conversationId}:${outbound.customerId}:${outbound.channel}:${outbound.correlationId}`).digest("hex"));
  const handoffBlocked = createChopifyOutboundHttpAdapter({
    allowedTenantIds: [tenantId],
    tenantConfigurations: { [tenantId]: { baseUrl: "https://chopify.example.test", bearerToken: "synthetic-service-token" } },
    async fetchImplementation() { return new Response(JSON.stringify({ ok: false, error: "AUTOMATION_BLOCKED_BY_HANDOFF" }), { status: 409 }); },
  });
  await assert.rejects(() => handoffBlocked.persist(outbound), /409-AUTOMATION_BLOCKED_BY_HANDOFF/);
});

test("los cuatro canales cruzan el relay y el motor comercial local usando una conversación canónica común", async () => {
  const product = { productId: "fixture-daniela", name: "Daniela", available: true, variants: [], price: { amount: 39.99, currency: "USD" }, pricingStatus: "READY" };
  const engine = createFloesEngineFixture({ port: {
    async resolveCustomerIdentity(_context, input) { return { customerId: `customer-${input.channel.toLowerCase()}`, identityId: `identity-${input.channel.toLowerCase()}`, channel: input.channel, externalIdentifier: input.externalIdentifier, createdCustomer: false, createdIdentity: false }; },
    async searchProducts() { return [product]; },
    async getProductDetails() { return product; },
  } });
  const persisted = [];
  const outboundPersisted = [];
  const relayed = [];
  const relay = createOmnichannelInboundRelay({
    adapters,
    allowedTenantIds: [tenantId],
    now,
    async persistInbound(envelope) { persisted.push(envelope); return { conversationId: envelope.conversationId, customerId: `customer-${envelope.channel.toLowerCase()}` }; },
    async persistOutbound(envelope) { outboundPersisted.push(envelope); },
    async processMessage(envelope) { relayed.push(envelope); return engine.runtime.processLiveOmnichannel(envelope); },
  });
  for (let index = 0; index < adapters.length; index += 1) {
    const adapter = adapters[index];
    const event = events[index];
    const result = await relay.receive(adapter.channel, tenantId, event);
    assert.equal(result[0]?.status, "processed");
    assert.equal(result[0]?.conversationId, persisted[index]?.conversationId);
    assert.equal(result[0]?.result.commerce.conversationId, persisted[index]?.conversationId);
  }
  assert.equal(persisted.length, 4);
  assert.equal(outboundPersisted.length, 4);
  assert.equal(outboundPersisted[0]?.conversationId, persisted[0]?.conversationId);
  assert.equal(outboundPersisted[0]?.customerId, "customer-web");
  assert.equal(typeof outboundPersisted[0]?.text, "string");
  assert.ok(outboundPersisted[0]?.text.length > 0);
  assert.equal(outboundPersisted[0]?.provider, "WEB");
  assert.equal(relayed.length, 4);
  assert.equal(new Set(persisted.map(item => item.conversationId)).size, 4);
  assert.equal((await engine.conversations.list(tenantId, "chopify-whatsapp-live")).length, 4);
  await relay.receive("WEB", tenantId, events[0]);
  assert.equal(persisted.length, 4);
  assert.equal(outboundPersisted.length, 4);
});

test("internal HTTP ingress requires its bearer and rejects unknown channels before relay", async () => {
  let calls = 0;
  const handler = createOmnichannelInboundHandler({ relay: { async receive() { calls += 1; return [{ status: "duplicate" }]; } }, environment: { GANOBOT_OMNICHANNEL_INGRESS_TOKEN_FLOES: "synthetic-ingress-floes", GANOBOT_OMNICHANNEL_INGRESS_TOKEN_MG: "synthetic-ingress-mg" }, logger: { error() {} } });
  async function request(authorization, body) {
    const result = {};
    await handler({ method: "POST", headers: { authorization }, body }, { set statusCode(value) { result.status = value; }, setHeader() {}, end(value) { result.body = JSON.parse(value); } });
    return result;
  }
  assert.equal((await request("Bearer wrong", { channel: "WEB", tenantId, event: events[0] })).status, 401);
  assert.equal((await request("Bearer synthetic-ingress-floes", { channel: "WEB", tenantId: "tenant-mg", event: events[0] })).status, 403);
  assert.equal((await request("Bearer synthetic-ingress-floes", { channel: "SMS", tenantId, event: events[0] })).status, 400);
  assert.equal(calls, 0);
  const accepted = await request("Bearer synthetic-ingress-floes", { channel: "WEB", tenantId, event: events[0] });
  assert.equal(accepted.status, 202);
  assert.equal(calls, 1);
  const duplicated = createOmnichannelInboundHandler({ relay: { async receive() { throw new Error("must-not-run"); } }, environment: { GANOBOT_OMNICHANNEL_INGRESS_TOKEN_FLOES: "same-secret", GANOBOT_OMNICHANNEL_INGRESS_TOKEN_MG: "same-secret" }, logger: { error() {} } });
  assert.equal((await requestWith(duplicated, "Bearer same-secret", { channel: "WEB", tenantId, event: events[0] })).status, 401);
});

async function requestWith(handler, authorization, body) {
  const result = {};
  await handler({ method: "POST", headers: { authorization }, body }, { set statusCode(value) { result.status = value; }, setHeader() {}, end(value) { result.body = JSON.parse(value); } });
  return result;
}

test("deployable default handler composes tenant token, Chopify HTTP adapters, and hosted runtime without real calls", async () => {
  assert.equal(typeof defaultOmnichannelHandler, "function");
  const protectedEnvironmentKeys = ["GANOBOT_OMNICHANNEL_INGRESS_TOKEN_FLOES", "GANOBOT_OMNICHANNEL_INGRESS_TOKEN_MG", "GANOBOT_OMNICHANNEL_INGRESS_TOKEN_DGNG", "CHOPIFY_API_BASE_URL_FLOES", "CHOPIFY_API_BASE_URL_MG", "CHOPIFY_API_BASE_URL_DGNG", "CHOPIFY_GANOBOT_INBOUND_TOKEN_FLOES", "CHOPIFY_GANOBOT_INBOUND_TOKEN_MG", "CHOPIFY_GANOBOT_INBOUND_TOKEN_DGNG"];
  const previousValues = new Map(protectedEnvironmentKeys.map(key => [key, process.env[key]]));
  for (const key of protectedEnvironmentKeys) delete process.env[key];
  try {
    const closed = await requestWith(defaultOmnichannelHandler, "Bearer missing", { tenantId, channel: "WEB", event: events[0] });
    assert.equal(closed.status, 503);
    assert.equal(closed.body.error.code, "OMNICHANNEL_CONFIGURATION_INVALID");
  } finally {
    for (const [key, value] of previousValues) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  const requests = [];
  const runtimeCalls = [];
  const environment = {
    GANOBOT_OMNICHANNEL_INGRESS_TOKEN_FLOES: "unique-ingress-token-floes",
    CHOPIFY_API_BASE_URL_FLOES: "https://chopify.synthetic.test",
    CHOPIFY_GANOBOT_INBOUND_TOKEN_FLOES: "synthetic-chopify-token",
    GANOBOT_OMNICHANNEL_INSTAGRAM_ACCOUNT_FLOES: "ig-page-1",
    GANOBOT_OMNICHANNEL_FACEBOOK_ACCOUNT_FLOES: "fb-page-1",
    GANOBOT_OMNICHANNEL_TIKTOK_ACCOUNT_FLOES: "tt-business-1",
  };
  const handler = createDefaultOmnichannelHandler({
    environment,
    logger: { error() {} },
    now,
    async runtimeFactory(authenticatedTenantId) {
      runtimeCalls.push(authenticatedTenantId);
      return { async processLiveOmnichannel(envelope) { return { reply: `respuesta ${envelope.text}`, commerce: { tenantId: authenticatedTenantId, customerId: "customer-1", conversationId: envelope.conversationId, correlationId: "corr-default" } }; } };
    },
    async fetchImplementation(url, init) {
      requests.push({ url: String(url), init });
      const envelope = JSON.parse(init.body);
      const response = String(url).endsWith("channel-inbound")
        ? { conversationId: envelope.conversationId, customerId: "customer-1", duplicate: false }
        : { conversationId: envelope.conversationId, customerId: envelope.customerId, messageId: envelope.messageId, duplicate: false };
      return new Response(JSON.stringify(response), { status: 200 });
    },
  });
  const response = await requestWith(handler, "Bearer unique-ingress-token-floes", { tenantId, channel: "WEB", event: events[0] });
  assert.equal(response.status, 202);
  assert.equal(runtimeCalls.join(","), tenantId);
  assert.deepEqual(requests.map(item => item.url), ["https://chopify.synthetic.test/api/channel-inbound", "https://chopify.synthetic.test/api/channel-outbound"]);
  assert.ok(requests.every(item => item.init.headers.authorization === "Bearer synthetic-chopify-token"));
  assert.equal(requests[1]?.init.headers["idempotency-key"], createHash("sha256").update(`${tenantId}:${JSON.parse(requests[1].init.body).conversationId}:customer-1:WEB:corr-default`).digest("hex"));
  assert.throws(() => createDefaultOmnichannelHandler({ environment: { ...environment, GANOBOT_OMNICHANNEL_INGRESS_TOKEN_MG: "unique-ingress-token-floes" } }), /token-configuration-invalid/);
  assert.throws(() => createDefaultOmnichannelHandler({ environment: { GANOBOT_OMNICHANNEL_INGRESS_TOKEN_FLOES: "only-token" } }), /chopify-configuration-incomplete/);
});
