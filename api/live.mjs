import { timingSafeEqual } from "node:crypto";

import {
  getGanoHostedRuntime,
} from "../scripts/gano-hosted-runtime.mjs";

const MAXIMUM_BODY_BYTES = 16 * 1024;
const TENANT_ID = "tenant-floes";
const CHANNEL = "WHATSAPP";

function json(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(body));
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}

function readBody(request) {
  if (request.body === undefined || request.body === null) return undefined;
  if (typeof request.body === "string" || Buffer.isBuffer(request.body)) {
    const bytes = Buffer.isBuffer(request.body)
      ? request.body
      : Buffer.from(request.body, "utf8");
    if (bytes.byteLength > MAXIMUM_BODY_BYTES) throw new RangeError("body-too-large");
    return JSON.parse(bytes.toString("utf8"));
  }
  const serialized = JSON.stringify(request.body);
  if (Buffer.byteLength(serialized, "utf8") > MAXIMUM_BODY_BYTES) {
    throw new RangeError("body-too-large");
  }
  return request.body;
}

function authorized(request, expected) {
  const authorization = request.headers?.authorization;
  if (!expected || typeof authorization !== "string") return false;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const supplied = Buffer.from(match[1].trim(), "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}

export function describeLiveError(error, fallbackStage) {
  const value = record(error);
  const stage =
    typeof value?.stage === "string" && /^[a-z][a-z0-9-]{1,63}$/.test(value.stage)
      ? value.stage
      : fallbackStage;
  const status =
    typeof value?.status === "number" && Number.isInteger(value.status)
      ? value.status
      : undefined;
  const name =
    error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name)
      ? error.name
      : "Error";
  const message =
    typeof value?.safeMessage === "string" && value.safeMessage.length <= 160
      ? value.safeMessage
      : "Unexpected live runtime failure.";
  return Object.freeze({
    stage,
    ...(status !== undefined ? { status } : {}),
    name,
    message,
  });
}

export function validateLivePayload(value) {
  const body = record(value);
  const customer = record(body?.customer);
  const tenantId = typeof body?.tenantId === "string" ? body.tenantId.trim() : "";
  const channel = typeof body?.channel === "string" ? body.channel.trim() : "";
  const providerMessageId =
    typeof body?.providerMessageId === "string" ? body.providerMessageId.trim() : "";
  const rawPhone = typeof customer?.phone === "string" ? customer.phone.trim() : "";
  const phone = rawPhone.replace(/\D/g, "");
  const name = typeof customer?.name === "string" ? customer.name.trim() : "";
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (tenantId !== TENANT_ID) return Object.freeze({ status: 403, error: "tenant-not-allowed" });
  if (channel !== CHANNEL) return Object.freeze({ status: 400, error: "channel-not-allowed" });
  if (!providerMessageId || providerMessageId.length > 256 || /[\s\x00-\x1f\x7f]/.test(providerMessageId)) {
    return Object.freeze({ status: 400, error: "invalid-provider-message-id" });
  }
  if (rawPhone.length > 32 || !/^\d{8,15}$/.test(phone)) {
    return Object.freeze({ status: 400, error: "invalid-customer-phone" });
  }
  if (name.length > 100) return Object.freeze({ status: 400, error: "invalid-customer-name" });
  if (!text || text.length > 4000) return Object.freeze({ status: 400, error: "invalid-text" });

  return Object.freeze({
    value: Object.freeze({
      tenantId: TENANT_ID,
      channel: CHANNEL,
      providerMessageId,
      customer: Object.freeze({
        phone,
        ...(name ? { name } : {}),
      }),
      text,
    }),
  });
}

export function createLiveHandler({
  environment = process.env,
  runtimeFactory = getGanoHostedRuntime,
  logger = console,
} = {}) {
  return async function liveHandler(request, response) {
    if (request.method !== "POST") {
      json(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } });
      return;
    }

    const expected = environment.GANOBOT_LIVE_BEARER_TOKEN?.trim();
    if (!authorized(request, expected)) {
      json(response, 401, { error: { code: "UNAUTHORIZED", message: "Unauthorized." } });
      return;
    }

    let stage = "request-validation";
    try {
      const validation = validateLivePayload(readBody(request));
      if (validation.value === undefined) {
        json(response, validation.status, {
          error: { code: "INVALID_LIVE_REQUEST", message: "Invalid live request." },
        });
        return;
      }

      stage = "runtime-initialization";
      const runtime = await runtimeFactory();
      stage = "commerce-processing";
      const result = await runtime.processLiveWhatsApp(validation.value);
      if (typeof result?.reply !== "string" || !result.reply.trim() || result.reply.length > 4000) {
        throw new Error("invalid-live-reply");
      }
      json(response, 200, { reply: result.reply.trim() });
    } catch (error) {
      if (error instanceof SyntaxError) {
        json(response, 400, { error: { code: "INVALID_JSON", message: "Invalid JSON body." } });
        return;
      }
      if (error instanceof RangeError) {
        json(response, 413, { error: { code: "PAYLOAD_TOO_LARGE", message: "Payload too large." } });
        return;
      }
      logger.error(
        "[GANO_BOT Live] request-failed",
        describeLiveError(error, stage),
      );
      json(response, 503, { error: { code: "LIVE_UNAVAILABLE", message: "Live assistant unavailable." } });
    }
  };
}

export default createLiveHandler();
