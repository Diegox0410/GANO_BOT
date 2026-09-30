import {
  getGanoHostedRuntime,
} from "../scripts/gano-hosted-runtime.mjs";

const ALLOWED_ORIGINS = new Set([
  "https://gano-sim.vercel.app",
  "https://gano-bot-web.vercel.app",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
]);

function getAllowedOrigin(request) {
  const origin = request.headers?.origin;
  if (typeof origin === "string" && ALLOWED_ORIGINS.has(origin)) return origin;
  return null;
}

function applyCorsHeaders(request, response) {
  const origin = getAllowedOrigin(request);
  if (!origin) return false;
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", [
    "Authorization",
    "Content-Type",
    "Accept-Language",
    "X-Request-Id",
    "X-Correlation-Id",
    "X-Client-Version",
  ].join(", "));
  response.setHeader("Access-Control-Expose-Headers", [
    "X-Request-Id",
    "X-Correlation-Id",
    "Content-Type",
  ].join(", "));
  response.setHeader("Access-Control-Max-Age", "600");
  response.setHeader("Vary", "Origin");
  return true;
}

function appendHeader(headers, name, value) {
  if (Array.isArray(value)) {
    for (const item of value) headers.append(name, item);
    return;
  }
  if (value !== undefined) headers.set(name, String(value));
}

function resolveBackendPath(request) {
  const path = typeof request.query?.path === "string" ? request.query.path : "";
  if (!path) return "/";
  return `/v1/${path}`;
}

function resolveBody(request) {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  if (request.body === undefined || request.body === null) return undefined;
  if (typeof request.body === "string") return request.body;
  if (Buffer.isBuffer(request.body)) return request.body;
  return JSON.stringify(request.body);
}

export default async function handler(request, response) {
  const hasAllowedOrigin = applyCorsHeaders(request, response);

  if (request.method === "OPTIONS") {
    if (request.headers?.origin && !hasAllowedOrigin) {
      response.status(403).json({
        success: false,
        error: {
          code: "CORS_ORIGIN_DENIED",
          message: "El origen de la solicitud no está autorizado.",
        },
      });
      return;
    }
    response.status(204).end();
    return;
  }

  try {
    const backendPath = resolveBackendPath(request);

    const runtime = await getGanoHostedRuntime();
    const headers = new Headers();

    for (const [name, value] of Object.entries(request.headers)) {
      appendHeader(headers, name, value);
    }

    const method = request.method ?? "GET";
    const query = new URLSearchParams();

    for (const [name, value] of Object.entries(request.query ?? {})) {
      if (name === "path") continue;
      if (Array.isArray(value)) {
        for (const item of value) query.append(name, item);
      } else if (value !== undefined) {
        query.set(name, String(value));
      }
    }

    const queryString = query.toString();
    const url =
      `https://gano-bot.internal${backendPath}` +
      (queryString ? `?${queryString}` : "");

    const body = resolveBody(request);
    const webRequest = new Request(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
    });

    const backendResponse = await runtime.application.handle(webRequest);
    response.statusCode = backendResponse.status;

    backendResponse.headers.forEach((value, name) => {
      response.setHeader(name, value);
    });

    applyCorsHeaders(request, response);

    const buffer = Buffer.from(await backendResponse.arrayBuffer());
    response.end(buffer);
  } catch (error) {
    console.error(
      "[GANO_BOT Vercel]",
      error instanceof Error ? error.message : "unknown-error",
    );

    applyCorsHeaders(request, response);

    response.status(500).json({
      success: false,
      error: {
        code: "HOSTED_RUNTIME_ERROR",
        message: "Error interno de GANO_BOT.",
      },
    });
  }
}
