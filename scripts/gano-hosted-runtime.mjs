import { AIChatProviderRegistry } from "../packages/ai-core/dist/chat/registry.js";

import {
  KnowledgeManagerService,
} from "../packages/ai-core/dist/knowledge-manager/index.js";

import {
  FirestoreKnowledgeManagerRepository,
} from "../apps/functions/dist/integrations/firestoreKnowledgeManagerRepository.js";

import {
  getGanoAdminFirestore,
} from "../apps/functions/dist/integrations/firebaseAdmin.js";
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
  GANO_SIM_INTENT_CONFIG,
  GANO_SIM_PROMPT_CONFIG,
  FirebaseAuthenticationProvider,
  FirestoreStudioRepository,
  StudioControlPlane,
} from "../apps/functions/dist/index.js";

import {
  FirestoreKnowledgeDocumentProcessor,
} from "../apps/functions/dist/integrations/firestoreKnowledgeDocumentProcessor.js";

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
      .normalize("NFD")
      .replace(
        /[\u0300-\u036f]/g,
        "",
      )
      .toLowerCase()
      .trim();

  const normalizedKnowledge =
    String(knowledge ?? "")
      .trim();

  if (!normalizedKnowledge) {
    return (
      "No encontré información suficiente " +
      "en la base de conocimiento para responder con precisión."
    );
  }

  /*
   * =========================================================
   * RESPUESTAS ESPECÍFICAS
   * =========================================================
   *
   * El proveedor actual es determinista.
   * Todavía no estamos delegando la redacción final
   * a un LLM externo.
   *
   * Por eso convertimos el contexto RAG en una respuesta
   * conversacional limpia, en lugar de devolver el bloque
   * técnico completo.
   */

  if (
    /que es gano itouch|que es gano|gano itouch/.test(
      normalizedQuestion,
    )
  ) {
    return (
      "Gano iTouch es una empresa de comercialización y distribución " +
      "de productos vinculados con bienestar, nutrición y consumo. " +
      "En Ecuador opera mediante una estructura de distribución independiente " +
      "y utiliza un modelo de venta directa y mercadeo en red. " +
      "Los distribuidores pueden comercializar productos y, según los requisitos " +
      "del plan vigente, participar en mecanismos de compensación, desarrollo " +
      "de organización y calificación por rangos."
    );
  }

  if (
    /como funciona el negocio|modelo de negocio|como funciona gano/.test(
      normalizedQuestion,
    )
  ) {
    return (
      "El modelo de Gano iTouch funciona mediante venta directa y mercadeo en red. " +
      "Los participantes pueden comprar o comercializar productos y desarrollar " +
      "una organización de distribuidores. Dependiendo de su modalidad, actividad, " +
      "volumen y cumplimiento de requisitos, pueden participar en componentes del " +
      "plan de compensación como binario, GEN5, regalías y calificación por rangos. " +
      "Las reglas exactas deben consultarse en el plan de compensación vigente."
    );
  }

  if (
    /modulos|invitado|acceso publico/.test(
      normalizedQuestion,
    )
  ) {
    return (
      "Como invitado puedes consultar información general y educativa sobre " +
      "Gano iTouch, su historia, productos, conceptos del negocio y otros contenidos " +
      "públicos autorizados. Los datos personales, rangos, volúmenes, comisiones " +
      "y organización requieren una sesión autorizada."
    );
  }

  /*
   * =========================================================
   * FALLBACK RAG LIMPIO
   * =========================================================
   *
   * Eliminamos metadatos internos del prompt recuperado:
   * IDs, scores, posiciones y encabezados técnicos.
   */

  const cleanedKnowledge =
    normalizedKnowledge
      .replace(
        /^### Documento \d+\s*$/gim,
        "",
      )
      .replace(
        /^ID de fragmento:.*$/gim,
        "",
      )
      .replace(
        /^ID de documento:.*$/gim,
        "",
      )
      .replace(
        /^Tipo:.*$/gim,
        "",
      )
      .replace(
        /^Puntuación de relevancia:.*$/gim,
        "",
      )
      .replace(
        /^Posición:.*$/gim,
        "",
      )
      .replace(
        /^Página:.*$/gim,
        "",
      )
      .replace(
        /^Sección:.*$/gim,
        "",
      )
      .replace(
        /^URI:.*$/gim,
        "",
      )
      .replace(
        /^Contenido:\s*$/gim,
        "",
      )
      .replace(
        /\n{3,}/g,
        "\n\n",
      )
      .trim();

  /*
   * Evitamos enviar miles de caracteres al usuario
   * mientras todavía usamos el provider determinista.
   */

  const maximumCharacters =
    1800;

  if (
    cleanedKnowledge.length <=
    maximumCharacters
  ) {
    return cleanedKnowledge;
  }

  return (
    cleanedKnowledge
      .slice(
        0,
        maximumCharacters,
      )
      .trimEnd() +
    "\n\nPuedes pedirme que profundice en alguno de estos puntos."
  );
}

async function createHostedRuntime() {
  /*
   * =========================================================
   * KNOWLEDGE MANAGER — PERSISTENCIA FIRESTORE
   * =========================================================
   *
   * La base de conocimiento ya no vive únicamente durante
   * la ejecución de la función serverless.
   *
   * Firestore se convierte en la fuente persistente para:
   *
   * - Knowledge Bases
   * - Documents
   * - Folders
   * - Collections
   * - Versions
   * - Activity
   */

  const firestore =
    getGanoAdminFirestore();

  const knowledgeRepository =
    new FirestoreKnowledgeManagerRepository(
      firestore,
    );

  const browserKnowledgeProcessor =
  new BrowserBytesDocumentProcessor();

const knowledgeProcessor =
  new FirestoreKnowledgeDocumentProcessor(
    firestore,
    browserKnowledgeProcessor,
  );
  /*
   * El generador sigue siendo necesario para los recursos
   * creados por KnowledgeManagerService.
   *
   * Incorporamos timestamp + secuencia para reducir el riesgo
   * de colisiones entre inicializaciones serverless.
   */

  let knowledgeSequence = 0;

  const knowledgeManager =
    new KnowledgeManagerService({
      repository:
        knowledgeRepository,

      processor:
        knowledgeProcessor,

      generateId(prefix) {
        knowledgeSequence += 1;

        return (
          `${prefix}-` +
          `${Date.now()}-` +
          `${knowledgeSequence}`
        );
      },
    });

  /*
   * =========================================================
   * BASE PÚBLICA GANO SIM
   * =========================================================
   *
   * Antes se creaba una nueva base cada vez que arrancaba
   * el runtime.
   *
   * Ahora:
   *
   * 1. Consultamos Firestore.
   * 2. Buscamos "gano-public".
   * 3. Si existe, reutilizamos la misma.
   * 4. Si no existe, la creamos.
   *
   * Esto hace que la inicialización sea persistente.
   */

  const existingKnowledgeBases =
    await knowledgeRepository.listBases(
      tenantId,
    );

  let publicKnowledgeBase =
    existingKnowledgeBases.find(
      (base) =>
        base.name ===
        "gano-public",
    );

  if (!publicKnowledgeBase) {
    publicKnowledgeBase =
      await knowledgeManager.createBase(
        knowledgePrincipal,
        {
          name:
            "gano-public",

          description:
            "Base pública autorizada de Gano Sim para invitados y afiliados.",

          tags: Object.freeze([
            "gano-public",
            "public",
            "gano-sim",
          ]),
        },
      );
  }

  /*
   * =========================================================
   * ASOCIACIÓN DEL ASISTENTE
   * =========================================================
   *
   * KnowledgeManagerService mantiene las reglas de permisos,
   * actividad y versionado.
   *
   * Dejamos que el servicio realice la asociación.
   */

  if (
  !publicKnowledgeBase
    .assistantIds
    .includes(
      assistantId,
    )
) {
  publicKnowledgeBase =
    await knowledgeManager
      .associateAssistant(
        knowledgePrincipal,

        publicKnowledgeBase
          .knowledgeBaseId,

        assistantId,
      );
}

  /*
   * Volvemos a obtener la base después de la asociación.
   *
   * Esto garantiza que el objeto utilizado por el runtime
   * represente el estado persistido más reciente.
   */

  const persistedKnowledgeBase =
    await knowledgeRepository.getBase(
      tenantId,

      publicKnowledgeBase
        .knowledgeBaseId,
    );

  if (persistedKnowledgeBase) {
    publicKnowledgeBase =
      persistedKnowledgeBase;
  }

  /*
   * =========================================================
   * KNOWLEDGE RUNTIME
   * =========================================================
   *
   * createGanoKnowledgeRuntime recibe ahora exactamente el
   * mismo repositorio Firestore utilizado por el manager.
   *
   * Por tanto:
   *
   * Knowledge Manager
   *        │
   *        ▼
   * Firestore
   *        │
   *        ▼
   * Knowledge Runtime
   *        │
   *        ▼
   * Assistant
   */

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

      defaultMinimumScore:
        0.15,
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

          intent:
            GANO_SIM_INTENT_CONFIG,

          prompt:
            GANO_SIM_PROMPT_CONFIG,

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

          /**
           * TEMPORAL PARA DIAGNÓSTICO.
           *
           * El RAG está recuperando correctamente
           * los documentos y chunks.
           *
           * Mientras investigamos por qué el
           * ResponseValidator rechaza la respuesta,
           * no permitimos que esa validación
           * derribe toda la petición HTTP.
           */
          rejectInvalidResponse:
            true,
        }),
    }),

  dependencies:
    Object.freeze({
      chatProviders,

      /**
       * Retriever conversacional real.
       *
       * Este adapter utiliza:
       *
       * FirestoreKnowledgeManagerRepository
       * +
       * FirestoreKnowledgeDocumentProcessor
       * +
       * GanoKnowledgeCandidateSource
       */
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

  const studio =
    new StudioControlPlane(
      new FirestoreStudioRepository(
        firestore,
      ),
      (requestedTenantId, requestedAssistantId) =>
        registry
          .list({
            tenantId: requestedTenantId,
            assistantId: requestedAssistantId,
          })
          .map((tool) => tool.descriptor.id),
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

        studio,

        authentication:
          new FirebaseAuthenticationProvider(),
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
