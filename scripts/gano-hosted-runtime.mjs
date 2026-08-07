import { AIChatProviderRegistry } from "../packages/ai-core/dist/chat/registry.js";

import {
  InMemoryKnowledgeManagerRepository,
  KnowledgeManagerService,
} from "../packages/ai-core/dist/knowledge-manager/index.js";

import {
  BrowserBytesDocumentProcessor,
} from "../apps/ingestion/dist/index.js";

import {
  AssistantManager,
} from "../packages/ai-core/dist/runtime/manager.js";

import {
  createToolRegistry,
  createToolServices,
} from "../packages/ai-core/dist/tools-engine/index.js";

import {
  AssistantManagerChatGateway,
  DevelopmentGanoSimAffiliateProfileProvider,
  InMemoryAssistantRepository,
  createBackendApplication,
  createGanoKnowledgeRuntime,
  createGanoSimAffiliateProfileTool,
} from "../apps/functions/dist/index.js";

const tenantId = "gano-sim";
const assistantId = "gano-assistant";

const knowledgePermissions = Object.freeze([
  "knowledge:read",
  "knowledge:create",
  "knowledge:update",
  "knowledge:delete",
  "knowledge:archive",
  "knowledge:restore",
  "knowledge:associate",

  "documents:read",
  "documents:create",
  "documents:update",
  "documents:delete",
  "documents:reprocess",

  "ingestion:read",
  "ingestion:execute",
  "ingestion:cancel",

  "versions:read",
  "versions:restore",
]);

const knowledgePrincipal = Object.freeze({
  actorId: "gano-sim-development-admin",
  tenantId,
  permissions: knowledgePermissions,
});

const now = () =>
  new Date().toISOString();

function extractKnowledgeFromPrompt(
  systemPrompt = "",
) {
  const marker =
    "## Conocimiento recuperado";

  const nextMarker =
    "## Reglas de respuesta";

  const start =
    systemPrompt.indexOf(marker);

  if (start < 0) {
    return "";
  }

  const contentStart =
    start + marker.length;

  const end =
    systemPrompt.indexOf(
      nextMarker,
      contentStart,
    );

  const section =
    end >= 0
      ? systemPrompt.slice(
          contentStart,
          end,
        )
      : systemPrompt.slice(
          contentStart,
        );

  const contentMarker =
    "Contenido:";

  const contentIndex =
    section.indexOf(
      contentMarker,
    );

  if (contentIndex < 0) {
    return section.trim();
  }

  return section
    .slice(
      contentIndex +
        contentMarker.length,
    )
    .trim();
}

function answerFromKnowledge({
  question,
  knowledge,
}) {
  const normalizedQuestion =
    String(question ?? "")
      .toLowerCase();

  if (
    /m[oó]dulos|invitado|acceso p[uú]blico/.test(
      normalizedQuestion,
    )
  ) {
    const match =
      knowledge.match(
        /En modo invitado permite explorar\s+(.+?)(?:\.\s|\.$|\n)/i,
      );

    if (match?.[1]) {
      return (
        `Como invitado puedes explorar ${match[1]}. ` +
        "Los datos personales, el rango, los volúmenes, " +
        "las comisiones y la organización requieren una sesión autorizada."
      );
    }
  }

  return knowledge;
}

async function createHostedRuntime() {
  const knowledgeRepository =
    new InMemoryKnowledgeManagerRepository();

  const knowledgeProcessor =
    new BrowserBytesDocumentProcessor();

  let knowledgeSequence = 0;

  const knowledgeManager =
    new KnowledgeManagerService({
      repository:
        knowledgeRepository,

      processor:
        knowledgeProcessor,

      generateId(prefix) {
        knowledgeSequence += 1;

        return `${prefix}-${knowledgeSequence}`;
      },
    });

  const publicKnowledgeBase =
    await knowledgeManager.createBase(
      knowledgePrincipal,
      {
        name: "gano-public",

        description:
          "Base pública autorizada de Gano Sim para invitados y afiliados.",

        tags: Object.freeze([
          "gano-public",
          "public",
          "gano-sim",
        ]),
      },
    );

  await knowledgeManager
    .associateAssistant(
      knowledgePrincipal,
      publicKnowledgeBase
        .knowledgeBaseId,
      assistantId,
    );

  const ganoKnowledgeRuntime =
    createGanoKnowledgeRuntime({
      repository:
        knowledgeRepository,

      processor:
        knowledgeProcessor,

      scope: {
        tenantId,
        assistantId,

        knowledgeBaseId:
          publicKnowledgeBase
            .knowledgeBaseId,
      },

      defaultLimit: 8,
      defaultMinimumScore: 0.15,
    });

  const descriptor =
    Object.freeze({
      id: assistantId,
      tenantId,

      name:
        "Asistente Gano Sim",

      version: "1.0.0",
      locale: "es",
      enabled: true,

      capabilities:
        Object.freeze({
          conversation: true,
          intentDetection: true,
          contextBuilding: true,
          promptBuilding: true,
          responseValidation: true,
          chatFallback: false,
          embeddings: false,
          memory: false,
          knowledge: true,
          tools: true,
          streaming: false,
        }),
    });

  const provider =
    Object.freeze({
      name: "development",

      descriptor:
        Object.freeze({
          id:
            "gano-sim-development",

          name: "development",

          displayName:
            "Gano Sim Development Provider",

          defaultModel:
            "deterministic-mvp",

          enabled: true,

          capabilities:
            Object.freeze({
              supportsStreaming:
                false,

              supportsTools: true,
              supportsJson: false,

              supportsMultimodal:
                false,

              supportsSeed: true,
            }),
        }),

      async generate(request) {
        const createdAt = now();

        const last =
          request.messages.at(-1);

        const toolMessage =
          request.messages.findLast(
            (message) =>
              message.role ===
              "tool",
          );

        const personal =
          /perfil|rango|progreso|volumen|pv|cv/i.test(
            last?.content ?? "",
          );

        let tool;

        if (
          toolMessage !==
          undefined
        ) {
          try {
            tool =
              JSON.parse(
                toolMessage.content,
              );
          } catch {
            tool =
              undefined;
          }
        }

        const knowledge =
          extractKnowledgeFromPrompt(
            request.systemPrompt,
          );

        let content;

        if (
          tool?.authenticated ===
          true
        ) {
          content =
            `${tool.profile.displayName}, ` +
            `tu rango actual es ${tool.profile.currentRank}, ` +
            `acumulas ${tool.profile.personalVolume} PV ` +
            `y tu siguiente objetivo es ${tool.profile.nextRank}.`;
        } else if (
          tool?.authenticated ===
          false
        ) {
          content =
            tool.message;
        } else if (
          personal &&
          tool === undefined
        ) {
          content =
            "Consultando tu perfil autorizado…";
        } else if (
          knowledge.length > 0
        ) {
          content =
            answerFromKnowledge({
              question:
                last?.content ??
                "",

              knowledge,
            });
        } else {
          content =
            "No encontré información suficiente en la base de conocimiento para responder con precisión.";
        }

        const toolCalls =
          personal &&
          tool === undefined
            ? Object.freeze([
                {
                  id:
                    `call-${Date.now()}`,

                  name:
                    "gano.getCurrentAffiliateProfile",

                  arguments:
                    Object.freeze({}),
                },
              ])
            : Object.freeze([]);

        const message =
          Object.freeze({
            id:
              `message-${Date.now()}`,

            role: "assistant",
            content,

            contentType:
              "text",

            status:
              "completed",

            createdAt,
            updatedAt:
              createdAt,
          });

        return Object.freeze({
          id:
            `response-${Date.now()}`,

          requestId:
            request.requestId,

          provider:
            "development",

          model:
            "deterministic-mvp",

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

  const chatProviders =
    new AIChatProviderRegistry({
      providers: [provider],

      defaultProviderId:
        provider.descriptor.id,
    });

  const manager =
    new AssistantManager();

  manager.create({
    definition:
      Object.freeze({
        descriptor,

        configuration:
          Object.freeze({
            primaryChatProviderId:
              provider.descriptor.id,

            tools:
              Object.freeze([
                {
                  name:
                    "gano.getCurrentAffiliateProfile",

                  description:
                    "Obtiene el perfil del afiliado autenticado.",

                  parameters:
                    Object.freeze({
                      type:
                        "object",

                      additionalProperties:
                        false,

                      properties:
                        Object.freeze({}),
                    }),
                },
              ]),

            persistMessages:
              false,
          }),
      }),

    dependencies:
      Object.freeze({
        chatProviders,

        knowledge:
          ganoKnowledgeRuntime
            .conversationRetriever,
      }),
  });

  const assistants =
    new InMemoryAssistantRepository();

  assistants.register(
    descriptor,
  );

  const profileProvider =
    new DevelopmentGanoSimAffiliateProfileProvider(
      Object.freeze({
        [`${tenantId}:affiliate-demo`]:
          Object.freeze({
            affiliateId:
              "affiliate-demo",

            displayName:
              "Afiliada Demo",

            currentRank:
              "Bronce",

            personalVolume:
              860,

            nextRank:
              "Plata",
          }),
      }),
    );

  const registry =
    createToolRegistry();

  registry.register(
    createGanoSimAffiliateProfileTool(
      profileProvider,
      tenantId,
      assistantId,
    ),
  );

  const runtimeGateway =
    new AssistantManagerChatGateway(
      manager,
    );

  const application =
    createBackendApplication(
      {
        chat:
          Object.freeze({
            async generate(
              input,
            ) {
              return runtimeGateway
                .generate(
                  input,
                );
            },
          }),

        assistants,

        tools:
          createToolServices({
            registry,
          }),

        knowledgeManager,
      },
      {
        maximumBodyBytes:
          60 *
          1024 *
          1024,
      },
    );

  return Object.freeze({
    application,

    manager,

    knowledgeManager,

    knowledgeRepository,

    knowledgeProcessor,

    knowledgeBase:
      publicKnowledgeBase,

    ganoKnowledgeRuntime,

    descriptor,
  });
}

const runtimeKey =
  Symbol.for(
    "gano-bot.hosted-runtime",
  );

export async function getGanoHostedRuntime() {
  const target =
    globalThis;

  if (!target[runtimeKey]) {
    target[runtimeKey] =
      createHostedRuntime();
  }

  return target[runtimeKey];
}

export {
  assistantId,
  tenantId,
  knowledgePrincipal,
};