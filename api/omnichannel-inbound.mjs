import { timingSafeEqual } from "node:crypto";
import { getGanoHostedRuntime } from "../scripts/gano-hosted-runtime.mjs";
import { createDefaultOmnichannelDeliveryRepository } from "../scripts/firestore-omnichannel-delivery-ledger.mjs";
import {
  createChopifyInboundHttpAdapter,
  createChopifyOutboundHttpAdapter,
  createFacebookInboundAdapter,
  createInstagramInboundAdapter,
  createOmnichannelInboundRelay,
  createTikTokInboundAdapter,
  createWebInboundAdapter,
} from "../scripts/omnichannel-relay.mjs";

const MAXIMUM_BODY_BYTES = 24 * 1024;
const CHANNELS = new Set(["WEB", "INSTAGRAM", "FACEBOOK", "TIKTOK"]);

function json(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(body));
}

function readBody(request) {
  if (request.body === undefined || request.body === null) throw new Error("empty-body");
  const serialized = typeof request.body === "string" || Buffer.isBuffer(request.body) ? request.body : JSON.stringify(request.body);
  const bytes = Buffer.isBuffer(serialized) ? serialized : Buffer.from(serialized, "utf8");
  if (bytes.byteLength > MAXIMUM_BODY_BYTES) throw new RangeError("body-too-large");
  return JSON.parse(bytes.toString("utf8"));
}

function authorized(request, expected) {
  const match = request.headers?.authorization?.match(/^Bearer\s+(.+)$/i);
  if (typeof expected !== "string" || !expected.trim() || !match) return false;
  const received = Buffer.from(match[1].trim(), "utf8");
  const configured = Buffer.from(expected.trim(), "utf8");
  return received.length === configured.length && timingSafeEqual(received, configured);
}

const TENANTS = Object.freeze({ FLOES: "tenant-floes", MG: "tenant-mg", DGNG: "tenant-dgng" });

function configuredTenantTokens(environment) {
  return Object.entries(TENANTS).flatMap(([suffix, tenantId]) => {
    const value = environment[`GANOBOT_OMNICHANNEL_INGRESS_TOKEN_${suffix}`];
    const token = typeof value === "string" ? value.trim() : "";
    return token ? [{ suffix, tenantId, token }] : [];
  });
}

function authenticatedTenant(request, environment) {
  const tokens = configuredTenantTokens(environment);
  const matches = tokens.filter(entry => authorized(request, entry.token));
  if (matches.length !== 1) return undefined;
  const distinct = new Set(tokens.map(entry => entry.token));
  if (distinct.size !== tokens.length) return undefined;
  return matches[0];
}

export function createDefaultOmnichannelHandler({ environment = process.env, logger = console, runtimeFactory = getGanoHostedRuntime, fetchImplementation = fetch, now = () => new Date(), deliveryRepository } = {}) {
  const configured = configuredTenantTokens(environment);
  if (!configured.length || new Set(configured.map(entry => entry.token)).size !== configured.length) throw new Error("omnichannel-tenant-token-configuration-invalid");
  const tenantConfigurations = Object.fromEntries(configured.map(({ suffix, tenantId }) => {
    const baseUrl = environment[`CHOPIFY_API_BASE_URL_${suffix}`];
    const bearerToken = environment[`CHOPIFY_GANOBOT_INBOUND_TOKEN_${suffix}`];
    if (typeof baseUrl !== "string" || !baseUrl.trim() || typeof bearerToken !== "string" || !bearerToken.trim()) throw new Error("omnichannel-chopify-configuration-incomplete");
    return [tenantId, { baseUrl, bearerToken }];
  }));
  const adapters = [];
  for (const { suffix, tenantId } of configured) {
    adapters.push(createWebInboundAdapter({ tenantId }));
    const instagramAccountId = environment[`GANOBOT_OMNICHANNEL_INSTAGRAM_ACCOUNT_${suffix}`];
    const facebookAccountId = environment[`GANOBOT_OMNICHANNEL_FACEBOOK_ACCOUNT_${suffix}`];
    const tikTokAccountId = environment[`GANOBOT_OMNICHANNEL_TIKTOK_ACCOUNT_${suffix}`];
    if (instagramAccountId) adapters.push(createInstagramInboundAdapter({ tenantId, pageId: instagramAccountId }));
    if (facebookAccountId) adapters.push(createFacebookInboundAdapter({ tenantId, pageId: facebookAccountId }));
    if (tikTokAccountId) adapters.push(createTikTokInboundAdapter({ tenantId, businessAccountId: tikTokAccountId }));
  }
  const allowedTenantIds = configured.map(entry => entry.tenantId);
  const inbound = createChopifyInboundHttpAdapter({ allowedTenantIds, tenantConfigurations, environment, fetchImplementation });
  const outbound = createChopifyOutboundHttpAdapter({ allowedTenantIds, tenantConfigurations, environment, fetchImplementation });
  const relay = createOmnichannelInboundRelay({
    adapters,
    allowedTenantIds,
    now,
    deliveryRepository: deliveryRepository ?? (environment === process.env && runtimeFactory === getGanoHostedRuntime
      ? createDefaultOmnichannelDeliveryRepository({ environment }) : undefined),
    persistInbound: envelope => inbound.persist(envelope),
    persistOutbound: envelope => outbound.persist(envelope),
    async processMessage(envelope) {
      const runtime = await runtimeFactory(envelope.tenantId);
      if (typeof runtime?.processLiveOmnichannel !== "function") throw new Error("omnichannel-runtime-unavailable");
      return runtime.processLiveOmnichannel(envelope);
    },
  });
  return createOmnichannelInboundHandler({ relay, environment, logger });
}

function errorResponse(error) {
  const message = error instanceof Error ? error.message : "relay-failed";
  if (message === "tenant-not-allowed") return [403, "TENANT_NOT_ALLOWED"];
  if (message === "channel-not-allowed" || message === "provider-account-not-allowed") return [400, "CHANNEL_NOT_ALLOWED"];
  if (message.startsWith("invalid-") || message === "invalid-provider-event" || message === "empty-body" || error instanceof SyntaxError) return [400, "INVALID_PROVIDER_EVENT"];
  if (message.startsWith("chopify-") || message === "chopify-conversation-mismatch") return [502, "CHOPIFY_PERSISTENCE_FAILED"];
  return [503, "OMNICHANNEL_PROCESSING_FAILED"];
}

export function createOmnichannelInboundHandler({ relay, environment = process.env, logger = console }) {
  if (!relay || typeof relay.receive !== "function") throw new Error("omnichannel-relay-required");
  return async function handleOmnichannelInbound(request, response) {
    if (request.method !== "POST") return json(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } });
    const tokenTenant = authenticatedTenant(request, environment);
    if (!tokenTenant) return json(response, 401, { error: { code: "UNAUTHORIZED", message: "Unauthorized." } });
    try {
      const body = readBody(request);
      const tenantId = typeof body?.tenantId === "string" ? body.tenantId.trim() : "";
      if (tenantId !== tokenTenant.tenantId) return json(response, 403, { error: { code: "TENANT_NOT_ALLOWED", message: "Tenant does not match the authenticated service token." } });
      const channel = typeof body?.channel === "string" ? body.channel.trim().toUpperCase() : "";
      if (!CHANNELS.has(channel)) return json(response, 400, { error: { code: "CHANNEL_NOT_ALLOWED", message: "Unsupported channel." } });
      const result = await relay.receive(channel, tenantId, body.event);
      return json(response, 202, { results: result });
    } catch (error) {
      const [status, code] = errorResponse(error);
      logger.error("[GANO_BOT Omnichannel] inbound-failed", { code });
      return json(response, status, { error: { code, message: "Inbound message could not be processed." } });
    }
  };
}

let defaultHandler;
export default async function handler(request, response) {
  try {
    defaultHandler ??= createDefaultOmnichannelHandler();
    return await defaultHandler(request, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "initialization-failed";
    const code = message.startsWith("omnichannel-") ? "OMNICHANNEL_CONFIGURATION_INVALID" : "OMNICHANNEL_UNAVAILABLE";
    console.error("[GANO_BOT Omnichannel] initialization-failed", { code });
    return json(response, 503, { error: { code, message: "Omnichannel ingress is not configured." } });
  }
}
