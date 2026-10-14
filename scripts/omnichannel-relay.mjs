import { createHash } from "node:crypto";

const CHANNEL_PROVIDER = Object.freeze({
  WEB: "WEB",
  INSTAGRAM: "META",
  FACEBOOK: "META",
  TIKTOK: "TIKTOK",
});
const ID = /^[A-Za-z0-9:_-]{1,256}$/;

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function requiredId(value, field) {
  if (typeof value !== "string" || !ID.test(value.trim())) throw new Error(`invalid-${field}`);
  return value.trim();
}

function optionalText(value, maximum, field) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.trim().length > maximum) throw new Error(`invalid-${field}`);
  const result = value.trim();
  return result || undefined;
}

function envelopeFrom({ channel, tenantId, provider, providerMessageId, externalConversationId, externalCustomerId, customer, text, receivedAt, acquisitionSource }, now) {
  tenantId = requiredId(tenantId, "tenant");
  channel = requiredId(channel, "channel");
  provider = requiredId(provider, "provider");
  providerMessageId = requiredId(providerMessageId, "provider-message-id");
  externalConversationId = requiredId(externalConversationId, "external-conversation-id");
  externalCustomerId = requiredId(externalCustomerId, "external-customer-id");
  if (CHANNEL_PROVIDER[channel] !== provider) throw new Error("provider-channel-not-allowed");
  const name = optionalText(customer?.name, 100, "customer-name");
  const phone = optionalText(customer?.phone, 32, "customer-phone");
  const email = optionalText(customer?.email, 254, "customer-email");
  const message = optionalText(text, 4000, "message-text");
  if (!message) throw new Error("invalid-message-text");
  const received = receivedAt === undefined ? now() : new Date(receivedAt);
  if (!(received instanceof Date) || Number.isNaN(received.valueOf())) throw new Error("invalid-received-at");
  const conversationKey = JSON.stringify([tenantId, provider, channel, externalConversationId]);
  const conversationId = `conversation_${createHash("sha256").update(conversationKey).digest("hex")}`;
  return Object.freeze({
    tenantId,
    channel,
    provider,
    providerMessageId,
    externalConversationId,
    externalCustomerId,
    ...(name || phone || email ? { customer: Object.freeze({ ...(name ? { name } : {}), ...(phone ? { phone } : {}), ...(email ? { email } : {}) }) } : {}),
    text: message,
    receivedAt: received.toISOString(),
    acquisitionSource: acquisitionSource ?? channel,
    conversationId,
  });
}

function adapter({ channel, tenantId, provider, accountId, parse }) {
  const configuredTenantId = requiredId(tenantId, "configured-tenant");
  const configuredAccountId = accountId === undefined ? undefined : requiredId(accountId, "configured-account");
  return Object.freeze({
    channel,
    provider,
    tenantId: configuredTenantId,
    normalize(event, now = () => new Date()) {
      const input = object(event);
      if (!input) throw new Error("invalid-provider-event");
      if (input.tenantId !== undefined && input.tenantId !== configuredTenantId) throw new Error("tenant-not-allowed");
      const records = parse(input, configuredAccountId);
      return Object.freeze(records.map((record) => envelopeFrom({ channel, tenantId: configuredTenantId, provider, ...record }, now)));
    },
  });
}

export function createWebInboundAdapter({ tenantId }) {
  return adapter({ channel: "WEB", tenantId, provider: CHANNEL_PROVIDER.WEB, parse(event) {
    return [{ providerMessageId: event.messageId, externalConversationId: event.sessionId, externalCustomerId: event.visitorId, customer: event.customer, text: event.text, receivedAt: event.receivedAt, acquisitionSource: event.acquisitionSource ?? "WEB" }];
  } });
}

function createMetaInboundAdapter({ tenantId, channel, pageId }) {
  return adapter({ channel, tenantId, provider: CHANNEL_PROVIDER[channel], accountId: pageId, parse(event, configuredPageId) {
    const entries = Array.isArray(event.entry) ? event.entry : [];
    const matching = entries.filter(entry => object(entry)?.id === configuredPageId);
    if (!matching.length || matching.length !== entries.length) throw new Error("provider-account-not-allowed");
    return matching.flatMap(entry => (Array.isArray(entry.messaging) ? entry.messaging : []).map(item => {
      const message = object(item?.message);
      const senderId = requiredId(item?.sender?.id, "external-customer-id");
      return { providerMessageId: message?.mid, externalConversationId: item?.conversation?.id ?? senderId, externalCustomerId: senderId, customer: item?.sender?.name ? { name: item.sender.name } : undefined, text: message?.text, receivedAt: item?.timestamp === undefined ? undefined : new Date(Number(item.timestamp)).toISOString(), acquisitionSource: channel };
    }));
  } });
}

export function createInstagramInboundAdapter(config) {
  return createMetaInboundAdapter({ ...config, channel: "INSTAGRAM" });
}

export function createFacebookInboundAdapter(config) {
  return createMetaInboundAdapter({ ...config, channel: "FACEBOOK" });
}

export function createTikTokInboundAdapter({ tenantId, businessAccountId }) {
  return adapter({ channel: "TIKTOK", tenantId, provider: CHANNEL_PROVIDER.TIKTOK, accountId: businessAccountId, parse(event, configuredAccountId) {
    if (event.to_business_id !== configuredAccountId) throw new Error("provider-account-not-allowed");
    return [{ providerMessageId: event.message_id, externalConversationId: event.conversation_id, externalCustomerId: event.sender_id, customer: event.customer, text: event.text, receivedAt: event.timestamp === undefined ? undefined : new Date(Number(event.timestamp)).toISOString(), acquisitionSource: "TIKTOK" }];
  } });
}

export function createChopifyInboundHttpAdapter({ allowedTenantIds, tenantConfigurations, environment = process.env, fetchImplementation = fetch, timeoutMilliseconds = 5000 }) {
  const allowed = new Set(allowedTenantIds);
  if (!allowed.size || [...allowed].some(tenantId => !ID.test(tenantId))) throw new Error("invalid-tenant-allowlist");
  return Object.freeze({
    async persist(envelope, { signal } = {}) {
      const tenantId = requiredId(envelope?.tenantId, "tenant");
      if (!allowed.has(tenantId)) throw new Error("tenant-not-allowed");
      const tenantSuffix = { "tenant-floes": "FLOES", "tenant-mg": "MG", "tenant-dgng": "DGNG" }[tenantId];
      const configured = object(tenantConfigurations?.[tenantId]);
      const config = configured ?? (tenantSuffix ? { baseUrl: environment[`CHOPIFY_API_BASE_URL_${tenantSuffix}`], bearerToken: environment[`CHOPIFY_GANOBOT_INBOUND_TOKEN_${tenantSuffix}`] } : undefined);
      if (!config || typeof config.baseUrl !== "string" || typeof config.bearerToken !== "string" || !config.bearerToken.trim()) throw new Error("chopify-tenant-configuration-unavailable");
      let baseUrl;
      try { baseUrl = new URL(config.baseUrl); } catch { throw new Error("invalid-chopify-base-url"); }
      if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password) throw new Error("invalid-chopify-base-url");
      if (envelope.conversationId !== envelopeFrom({ ...envelope, customer: envelope.customer }, () => new Date(envelope.receivedAt)).conversationId) throw new Error("invalid-canonical-conversation-id");
      const controller = new AbortController();
      const abort = () => controller.abort(signal?.reason);
      signal?.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(() => controller.abort(new Error("chopify-request-timeout")), timeoutMilliseconds);
      const idempotencyKey = createHash("sha256").update(`${tenantId}:${envelope.provider}:${envelope.channel}:${envelope.providerMessageId}`).digest("hex");
      try {
        const response = await fetchImplementation(new URL("/api/channel-inbound", baseUrl), {
          method: "POST",
          headers: Object.freeze({ authorization: `Bearer ${config.bearerToken}`, "content-type": "application/json", "idempotency-key": idempotencyKey }),
          body: JSON.stringify(envelope),
          signal: controller.signal,
        });
        const bodyText = await response.text();
        let body;
        try { body = JSON.parse(bodyText); } catch { throw new Error("chopify-invalid-response"); }
        if (!response.ok) throw new Error(`chopify-persist-failed-${response.status}`);
        if (body?.conversationId !== envelope.conversationId || typeof body?.customerId !== "string") throw new Error("chopify-invalid-response");
        return Object.freeze({ conversationId: body.conversationId, customerId: body.customerId, duplicate: body.duplicate === true });
      } catch (error) {
        if (controller.signal.aborted && !signal?.aborted) throw new Error("chopify-request-timeout");
        throw error;
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
      }
    },
  });
}

export function createChopifyOutboundHttpAdapter({ allowedTenantIds, tenantConfigurations, environment = process.env, fetchImplementation = fetch, timeoutMilliseconds = 5000 }) {
  return Object.freeze({
    async persist(envelope, { signal } = {}) {
      const tenantId = requiredId(envelope?.tenantId, "tenant");
      if (!new Set(allowedTenantIds).has(tenantId)) throw new Error("tenant-not-allowed");
      const suffix = { "tenant-floes": "FLOES", "tenant-mg": "MG", "tenant-dgng": "DGNG" }[tenantId];
      const configured = object(tenantConfigurations?.[tenantId]);
      const config = configured ?? (suffix ? { baseUrl: environment[`CHOPIFY_API_BASE_URL_${suffix}`], bearerToken: environment[`CHOPIFY_GANOBOT_INBOUND_TOKEN_${suffix}`] } : undefined);
      if (!config || typeof config.baseUrl !== "string" || typeof config.bearerToken !== "string" || !config.bearerToken.trim()) throw new Error("chopify-tenant-configuration-unavailable");
      let baseUrl;
      try { baseUrl = new URL(config.baseUrl); } catch { throw new Error("invalid-chopify-base-url"); }
      if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password) throw new Error("invalid-chopify-base-url");
      const channel = requiredId(envelope.channel, "channel");
      const provider = requiredId(envelope.provider, "provider");
      if (CHANNEL_PROVIDER[channel] !== provider) throw new Error("provider-channel-not-allowed");
      const conversationId = requiredId(envelope.conversationId, "conversation-id");
      const customerId = requiredId(envelope.customerId, "customer-id");
      const messageId = requiredId(envelope.messageId, "message-id");
      const correlationId = requiredId(envelope.correlationId, "correlation-id");
      const text = optionalText(envelope.text, 4000, "message-text");
      if (!text) throw new Error("invalid-message-text");
      const createdAt = new Date(envelope.createdAt);
      if (Number.isNaN(createdAt.valueOf())) throw new Error("invalid-created-at");
      const body = Object.freeze({ tenantId, channel, provider, conversationId, customerId, messageId, correlationId, text, createdAt: createdAt.toISOString() });
      const controller = new AbortController();
      const abort = () => controller.abort(signal?.reason);
      signal?.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(() => controller.abort(new Error("chopify-request-timeout")), timeoutMilliseconds);
      const idempotencyKey = createHash("sha256").update(`${tenantId}:${conversationId}:${customerId}:${channel}:${correlationId}`).digest("hex");
      try {
        const response = await fetchImplementation(new URL("/api/channel-outbound", baseUrl), { method: "POST", headers: Object.freeze({ authorization: `Bearer ${config.bearerToken}`, "content-type": "application/json", "idempotency-key": idempotencyKey }), body: JSON.stringify(body), signal: controller.signal });
        let result;
        try { result = JSON.parse(await response.text()); } catch { throw new Error("chopify-invalid-response"); }
        if (!response.ok) {
          const code = typeof result?.error === "string" && /^[A-Z0-9_]{1,80}$/.test(result.error) ? result.error : "UNKNOWN";
          throw new Error(`chopify-outbound-persist-failed-${response.status}-${code}`);
        }
        if (result?.conversationId !== conversationId || result?.customerId !== customerId || result?.messageId !== messageId) throw new Error("chopify-invalid-response");
        return Object.freeze({ conversationId, customerId, messageId, duplicate: result.duplicate === true });
      } catch (error) {
        if (controller.signal.aborted && !signal?.aborted) throw new Error("chopify-request-timeout");
        throw error;
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
      }
    },
  });
}

export function createOmnichannelInboundRelay({ adapters, allowedTenantIds, persistInbound, persistOutbound, processMessage, now = () => new Date(), deliveryRepository }) {
  const tenantAllowlist = new Set(allowedTenantIds);
  const adapterList = Array.isArray(adapters) ? adapters : [];
  const adapterMap = new Map(adapterList.map(item => [`${item.tenantId}:${item.channel}`, item]));
  if (!tenantAllowlist.size || [...tenantAllowlist].some(tenantId => typeof tenantId !== "string" || !ID.test(tenantId)) || !adapterMap.size || adapterMap.size !== adapterList.length || typeof persistInbound !== "function" || typeof persistOutbound !== "function" || typeof processMessage !== "function") throw new Error("invalid-omnichannel-relay-configuration");
  if (adapterList.some(item => !tenantAllowlist.has(item.tenantId) || !CHANNEL_PROVIDER[item.channel])) throw new Error("invalid-omnichannel-relay-configuration");
  // Retain stage results so retries can resume safely after partial progress.
  // The map is scoped to this relay instance; the HTTP adapters remain idempotent
  // across retries that reach Chopify more than once.
  const deliveries = new Map();
  const inFlight = new Map();
  return Object.freeze({
    async receive(channel, tenantId, providerEvent) {
      if (!tenantAllowlist.has(tenantId)) throw new Error("tenant-not-allowed");
      const input = object(providerEvent);
      if (input?.channel !== undefined && input.channel !== channel) throw new Error("channel-not-allowed");
      const selected = adapterMap.get(`${tenantId}:${channel}`);
      if (!selected) throw new Error("channel-not-allowed");
      const envelopes = selected.normalize(providerEvent, now);
      const results = [];
      for (const envelope of envelopes) {
        const dedupeKey = `${envelope.tenantId}:${envelope.provider}:${envelope.channel}:${envelope.providerMessageId}`;
        const localPrevious = deliveries.get(dedupeKey);
        if (!deliveryRepository && (localPrevious?.stage === "completed" || localPrevious?.stage === "human-blocked")) {
          results.push(Object.freeze({ status: "duplicate", conversationId: envelope.conversationId }));
          continue;
        }
        let work = inFlight.get(dedupeKey);
        if (!work) {
          const processDelivery = async operations => {
            const previous = operations ? await operations.read() : deliveries.get(dedupeKey);
            if (previous?.stage === "completed" || previous?.stage === "human-blocked") {
              return Object.freeze({ deduplicated: true, conversationId: envelope.conversationId });
            }
            const persistStage = async value => {
              deliveries.set(dedupeKey, value);
              if (operations) await operations.write(Object.freeze({ ...value, tenantId: envelope.tenantId,
                channel: envelope.channel, provider: envelope.provider, providerMessageId: envelope.providerMessageId }));
            };
            const persisted = await persistInbound(envelope);
            if (persisted?.conversationId !== envelope.conversationId) throw new Error("chopify-conversation-mismatch");
            // Chopify only confirms that the inbound message already exists. Without
            // local stage state, completion cannot be distinguished from an earlier
            // partial failure, so fail closed and leave reconciliation to the durable
            // delivery ledger/manual workflow.
            if (!previous && persisted.duplicate === true) {
              return Object.freeze({ deduplicated: true, conversationId: envelope.conversationId });
            }
            const customerId = requiredId(previous?.customerId ?? persisted.customerId, "customer-id");
            if (previous?.customerId && persisted.customerId !== previous.customerId) throw new Error("chopify-customer-mismatch");
            let delivery = previous ?? Object.freeze({ stage: "inbound-persisted", customerId });
            if (!previous) await persistStage(delivery);

            if (delivery.stage === "inbound-persisted") {
              const result = await processMessage(Object.freeze({ ...envelope, customerId }));
              if (typeof result?.reply !== "string" || !result.reply.trim()) throw new Error("invalid-outbound-reply");
              const correlationId = requiredId(result?.commerce?.correlationId ?? `relay-${createHash("sha256").update(dedupeKey).digest("hex")}`, "correlation-id");
              const messageId = `gano_${createHash("sha256").update(`${dedupeKey}:${correlationId}`).digest("hex")}`;
              const outbound = Object.freeze({ tenantId: envelope.tenantId, channel: envelope.channel, provider: envelope.provider, conversationId: envelope.conversationId, customerId, messageId, correlationId, text: result.reply.trim(), createdAt: now().toISOString() });
              delivery = Object.freeze({ stage: "outbound-pending", customerId, result, outbound });
              await persistStage(delivery);
            }

            if (delivery.stage === "outbound-pending") {
              try {
                await persistOutbound(delivery.outbound);
              } catch (error) {
                // A human takeover or closed conversation is a terminal decision for
                // this generated reply. A later handback must not revive stale text.
                if (String(error?.message ?? error).includes("AUTOMATION_BLOCKED_BY_HANDOFF")) {
                  await persistStage(Object.freeze({ ...delivery, stage: "human-blocked" }));
                }
                throw error;
              }
              delivery = Object.freeze({ ...delivery, stage: "completed" });
              await persistStage(delivery);
            }

            return Object.freeze({ deduplicated: false, conversationId: envelope.conversationId, result: delivery.result });
          };
          work = (deliveryRepository
            ? deliveryRepository.withLock(dedupeKey, processDelivery)
            : processDelivery()).finally(() => inFlight.delete(dedupeKey));
          inFlight.set(dedupeKey, work);
        }
        const result = await work;
        results.push(result.deduplicated
          ? Object.freeze({ status: "duplicate", conversationId: envelope.conversationId })
          : Object.freeze({ status: "processed", conversationId: envelope.conversationId, result: result.result }));
      }
      return Object.freeze(results);
    },
  });
}
