import {
  createServer,
} from "node:http";

import {
  Readable,
} from "node:stream";

import {
  getGanoHostedRuntime,
} from "./gano-hosted-runtime.mjs";

const HOST =
  "127.0.0.1";

const PORT =
  8788;

const allowedOrigins =
  new Set([
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://localhost:5176",
    "http://localhost:5177",

    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:5175",
    "http://127.0.0.1:5176",
    "http://127.0.0.1:5177",
  ]);

function appendHeader(
  headers,
  name,
  value,
) {
  if (Array.isArray(value)) {
    for (const item of value) {
      headers.append(
        name,
        item,
      );
    }

    return;
  }

  if (
    value !== undefined
  ) {
    headers.set(
      name,
      String(value),
    );
  }
}

function getAllowedOrigin(
  incoming,
) {
  const origin =
    incoming.headers.origin;

  if (
    typeof origin ===
      "string" &&
    allowedOrigins.has(
      origin,
    )
  ) {
    return origin;
  }

  return null;
}

function applyCors(
  incoming,
  outgoing,
) {
  const origin =
    getAllowedOrigin(
      incoming,
    );

  if (!origin) {
    return false;
  }

  outgoing.setHeader(
    "Access-Control-Allow-Origin",
    origin,
  );

  outgoing.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  );

  outgoing.setHeader(
    "Access-Control-Allow-Headers",
    [
      "Authorization",
      "Content-Type",
      "Accept-Language",
      "X-Request-Id",
      "X-Correlation-Id",
      "X-Client-Version",
    ].join(", "),
  );

  outgoing.setHeader(
    "Access-Control-Expose-Headers",
    [
      "X-Request-Id",
      "X-Correlation-Id",
      "Content-Type",
    ].join(", "),
  );

  outgoing.setHeader(
    "Access-Control-Max-Age",
    "600",
  );

  outgoing.setHeader(
    "Vary",
    "Origin",
  );

  return true;
}

async function readNodeBody(
  request,
) {
  const chunks =
    [];

  for await (
    const chunk
    of request
  ) {
    chunks.push(
      Buffer.isBuffer(
        chunk,
      )
        ? chunk
        : Buffer.from(
            chunk,
          ),
    );
  }

  if (
    chunks.length === 0
  ) {
    return undefined;
  }

  return Buffer.concat(
    chunks,
  );
}

function buildHeaders(
  incoming,
) {
  const headers =
    new Headers();

  for (
    const [
      name,
      value,
    ] of Object.entries(
      incoming.headers,
    )
  ) {
    appendHeader(
      headers,
      name,
      value,
    );
  }

  return headers;
}

function writeHeaders(
  response,
  backendResponse,
) {
  backendResponse.headers.forEach(
    (
      value,
      name,
    ) => {
      response.setHeader(
        name,
        value,
      );
    },
  );
}

async function handleRequest(
  incoming,
  outgoing,
) {
  const corsAllowed =
    applyCors(
      incoming,
      outgoing,
    );

  if (
    incoming.method ===
      "OPTIONS"
  ) {
    if (
      incoming.headers
        .origin &&
      !corsAllowed
    ) {
      outgoing.statusCode =
        403;

      outgoing.setHeader(
        "Content-Type",
        "application/json; charset=utf-8",
      );

      outgoing.end(
        JSON.stringify({
          success: false,

          error: {
            code:
              "CORS_ORIGIN_DENIED",

            message:
              "El origen de la solicitud no está autorizado.",
          },
        }),
      );

      return;
    }

    outgoing.statusCode =
      204;

    outgoing.end();

    return;
  }

  try {
    const runtime =
      await getGanoHostedRuntime();

    const headers =
      buildHeaders(
        incoming,
      );

    const method =
      incoming.method ??
      "GET";

    const url =
      new URL(
        `http://${HOST}:${PORT}${incoming.url ?? "/"}`,
      );

    const body =
      method === "GET" ||
      method === "HEAD"
        ? undefined
        : await readNodeBody(
            incoming,
          );

    const webRequest =
      new Request(
        url,
        {
          method,
          headers,

          ...(
            body ===
            undefined
              ? {}
              : {
                  body,
                }
          ),
        },
      );

    const backendResponse =
      await runtime
        .application
        .handle(
          webRequest,
        );

    outgoing.statusCode =
      backendResponse.status;

    writeHeaders(
      outgoing,
      backendResponse,
    );

    applyCors(
      incoming,
      outgoing,
    );

    const buffer =
      Buffer.from(
        await backendResponse
          .arrayBuffer(),
      );

    outgoing.end(
      buffer,
    );
  } catch (error) {
    console.error(
      "[GANO_BOT local]",
      error,
    );

    outgoing.statusCode =
      500;

    outgoing.setHeader(
      "Content-Type",
      "application/json; charset=utf-8",
    );

    outgoing.end(
      JSON.stringify({
        success: false,

        error: {
          code:
            "LOCAL_RUNTIME_ERROR",

          message:
            error instanceof Error
              ? error.message
              : "Error interno de GANO_BOT.",
        },
      }),
    );
  }
}

const server =
  createServer(
    (
      incoming,
      outgoing,
    ) => {
      void handleRequest(
        incoming,
        outgoing,
      );
    },
  );

server.on(
  "error",
  (error) => {
    if (
      error &&
      typeof error ===
        "object" &&
      "code" in error &&
      error.code ===
        "EADDRINUSE"
    ) {
      console.error(
        `El puerto ${PORT} ya está ocupado. Finaliza el proceso anterior antes de iniciar otro servidor.`,
      );

      process.exit(1);
    }

    console.error(
      "[GANO_BOT local]",
      error,
    );

    process.exit(1);
  },
);

server.listen(
  PORT,
  HOST,
  () => {
    console.log(
      `Gano Sim MVP Backend: http://${HOST}:${PORT}`,
    );

    console.log(
      "Runtime: Firestore persistent",
    );

    console.log(
      "Knowledge Base: gano-public",
    );
  },
);