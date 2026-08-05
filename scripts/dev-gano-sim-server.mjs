import { createServer } from "node:http";
import { Readable } from "node:stream";

import { AIChatProviderRegistry } from "../packages/ai-core/dist/chat/registry.js";
import { AssistantManager } from "../packages/ai-core/dist/runtime/manager.js";
import {
  createToolRegistry,
  createToolServices,
} from "../packages/ai-core/dist/tools-engine/index.js";

import {
  AssistantManagerChatGateway,
  DevelopmentGanoSimAffiliateProfileProvider,
  InMemoryAssistantRepository,
  createBackendApplication,
  createGanoSimAffiliateProfileTool,
} from "../apps/functions/dist/index.js";

const HOST = "127.0.0.1";
const PORT = 8788;

const tenantId = "gano-sim";
const assistantId = "gano-assistant";

const allowedOrigins = new Set([
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

const now = () => new Date().toISOString();

const descriptor = Object.freeze({
  id: assistantId,
  tenantId,
  name: "Asistente Gano Sim",
  version: "1.0.0",
  locale: "es",
  enabled: true,
  capabilities: Object.freeze({
    conversation: true,
    intentDetection: true,
    contextBuilding: true,
    promptBuilding: true,
    responseValidation: true,
    chatFallback: false,
    embeddings: false,
    memory: false,
    knowledge: false,
    tools: true,
    streaming: false,
  }),
});

const provider = Object.freeze({
  name: "development",

  descriptor: Object.freeze({
    id: "gano-sim-development",
    name: "development",
    displayName: "Gano Sim Development Provider",
    defaultModel: "deterministic-mvp",
    enabled: true,
    capabilities: Object.freeze({
      supportsStreaming: false,
      supportsTools: true,
      supportsJson: false,
      supportsMultimodal: false,
      supportsSeed: true,
    }),
  }),

  async generate(request) {
    const createdAt = now();
    const last = request.messages.at(-1);

    const toolMessage = request.messages.findLast(
      (message) => message.role === "tool",
    );

    const personal = /perfil|rango|progreso/i.test(
      last?.content ?? "",
    );

    const tool =
      toolMessage === undefined
        ? undefined
        : JSON.parse(toolMessage.content);

    const content =
      tool?.authenticated === true
        ? `${tool.profile.displayName}, tu rango actual es ${tool.profile.currentRank}, acumulas ${tool.profile.personalVolume} PV y tu siguiente objetivo es ${tool.profile.nextRank}.`
        : tool?.authenticated === false
          ? tool.message
          : personal
            ? "Consultando tu perfil autorizado…"
            : "Puedo orientarte con información pública de Gano Sim. Inicia sesión para consultar datos personales.";

    const toolCalls =
      personal && tool === undefined
        ? Object.freeze([
            {
              id: `call-${Date.now()}`,
              name: "gano.getCurrentAffiliateProfile",
              arguments: Object.freeze({}),
            },
          ])
        : Object.freeze([]);

    const message = Object.freeze({
      id: `message-${Date.now()}`,
      role: "assistant",
      content,
      contentType: "text",
      status: "completed",
      createdAt,
      updatedAt: createdAt,
    });

    return Object.freeze({
      id: `response-${Date.now()}`,
      requestId: request.requestId,
      provider: "development",
      model: "deterministic-mvp",
      content,
      message,
      toolCalls,
      finishReason:
        toolCalls.length > 0
          ? "tool_calls"
          : "stop",
      createdAt,
    });
  },
});

const chatProviders = new AIChatProviderRegistry({
  providers: [provider],
  defaultProviderId: provider.descriptor.id,
});

const manager = new AssistantManager();

manager.create({
  definition: Object.freeze({
    descriptor,

    configuration: Object.freeze({
      primaryChatProviderId:
        provider.descriptor.id,

      tools: Object.freeze([
        {
          name: "gano.getCurrentAffiliateProfile",
          description:
            "Obtiene el perfil del afiliado autenticado.",
          parameters: Object.freeze({
            type: "object",
            additionalProperties: false,
            properties: Object.freeze({}),
          }),
        },
      ]),

      persistMessages: false,
    }),
  }),

  dependencies: Object.freeze({
    chatProviders,
  }),
});

const assistants =
  new InMemoryAssistantRepository();

assistants.register(descriptor);

const profileProvider =
  new DevelopmentGanoSimAffiliateProfileProvider(
    Object.freeze({
      [`${tenantId}:affiliate-demo`]:
        Object.freeze({
          affiliateId: "affiliate-demo",
          displayName: "Afiliada Demo",
          currentRank: "Bronce",
          personalVolume: 860,
          nextRank: "Plata",
        }),
    }),
  );

const registry = createToolRegistry();

registry.register(
  createGanoSimAffiliateProfileTool(
    profileProvider,
    tenantId,
    assistantId,
  ),
);

const runtimeGateway =
  new AssistantManagerChatGateway(manager);

const application = createBackendApplication({
  chat: Object.freeze({
    async generate(input) {
      try {
        return await runtimeGateway.generate(input);
      } catch (error) {
        console.error(
          "Gano Sim runtime error",
          error,
        );

        throw error;
      }
    },
  }),

  assistants,

  tools: createToolServices({
    registry,
  }),
});

const getAllowedOrigin = (incoming) => {
  const origin = incoming.headers.origin;

  if (
    typeof origin === "string" &&
    allowedOrigins.has(origin)
  ) {
    return origin;
  }

  return null;
};

const applyCorsHeaders = (
  outgoing,
  origin,
) => {
  if (!origin) {
    return;
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
};

const server = createServer(
  async (incoming, outgoing) => {
    const origin =
      getAllowedOrigin(incoming);

    applyCorsHeaders(
      outgoing,
      origin,
    );

    if (
      incoming.method === "OPTIONS"
    ) {
      if (
        incoming.headers.origin &&
        !origin
      ) {
        outgoing.statusCode = 403;
        outgoing.setHeader(
          "Content-Type",
          "application/json; charset=utf-8",
        );

        outgoing.end(
          JSON.stringify({
            success: false,
            error: {
              code: "CORS_ORIGIN_DENIED",
              message:
                "El origen de la solicitud no está autorizado.",
            },
          }),
        );

        return;
      }

      outgoing.statusCode = 204;
      outgoing.end();

      return;
    }

    try {
      const headers = new Headers();

      for (
        const [name, value] of Object.entries(
          incoming.headers,
        )
      ) {
        if (Array.isArray(value)) {
          for (const item of value) {
            headers.append(name, item);
          }
        } else if (value !== undefined) {
          headers.set(name, value);
        }
      }

      const method =
        incoming.method ?? "GET";

      const request = new Request(
        `http://${HOST}:${PORT}${incoming.url ?? "/"}`,
        {
          method,
          headers,

          ...(method === "GET" ||
          method === "HEAD"
            ? {}
            : {
                body: Readable.toWeb(
                  incoming,
                ),
                duplex: "half",
              }),
        },
      );

      const response =
        await application.handle(
          request,
        );

      outgoing.statusCode =
        response.status;

      response.headers.forEach(
        (value, name) => {
          outgoing.setHeader(
            name,
            value,
          );
        },
      );

      applyCorsHeaders(
        outgoing,
        origin,
      );

      const body = Buffer.from(
        await response.arrayBuffer(),
      );

      outgoing.end(body);
    } catch (error) {
      console.error(
        "Gano Sim development server error",
        error,
      );

      outgoing.statusCode = 500;

      applyCorsHeaders(
        outgoing,
        origin,
      );

      outgoing.setHeader(
        "Content-Type",
        "application/json; charset=utf-8",
      );

      outgoing.end(
        JSON.stringify({
          success: false,
          error: {
            code: "DEVELOPMENT_SERVER_ERROR",
            message:
              "El servidor local encontró un error interno.",
          },
        }),
      );
    }
  },
);

server.on("error", (error) => {
  if (
    error?.code === "EADDRINUSE"
  ) {
    console.error(
      `El puerto ${PORT} ya está ocupado. Finaliza el proceso anterior antes de iniciar otro servidor.`,
    );

    process.exitCode = 1;
    return;
  }

  console.error(
    "No fue posible iniciar el servidor local:",
    error,
  );

  process.exitCode = 1;
});

server.listen(
  PORT,
  HOST,
  () => {
    console.log(
      `Gano Sim MVP Backend: http://${HOST}:${PORT}`,
    );

    console.log(
      "Orígenes de desarrollo autorizados:",
    );

    for (const origin of allowedOrigins) {
      console.log(`- ${origin}`);
    }
  },
);