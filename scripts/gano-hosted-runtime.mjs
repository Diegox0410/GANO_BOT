import { AIChatProviderRegistry } from "../packages/ai-core/dist/chat/registry.js";
import { createHash } from "node:crypto";

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
  FirestoreConversationRepository,
  FirestoreRequestAuditSink,
  FirestoreRateLimiter,
  COMMERCE_ASSISTANT_ID,
  COMMERCE_PROMPT_CONFIG,
  createCommerceRuntimeFromEnv,
} from "../apps/functions/dist/index.js";

import {
  FirestoreKnowledgeDocumentProcessor,
} from "../apps/functions/dist/integrations/firestoreKnowledgeDocumentProcessor.js";

const tenantId = "gano-sim";
const assistantId = "gano-assistant";
const commerceTenantId = "tenant-floes";

class LiveProcessingError extends Error {
  constructor(stage, status, safeMessage) {
    super(safeMessage);
    this.name = "LiveProcessingError";
    this.stage = stage;
    this.status = status;
    this.safeMessage = safeMessage;
  }
}

function createAssistantMessage(content, createdAt) {
  return Object.freeze({
    id: `message-${crypto.randomUUID()}`,
    role: "assistant",
    content,
    contentType: "text",
    status: "completed",
    createdAt,
    updatedAt: createdAt,
  });
}

function commerceToolCall(message, conversationMessages = []) {
  const productMatch = message.match(/\b(?:producto|productId)\s*[:=]?\s*([\w.-]+)/i);
  const orderMatch = message.match(/\b(?:pedido|orderId)\s*[:=]?\s*([\w.-]+)/i);
  const quantityMatch = message.match(/\b(?:cantidad|quantity)\s*[:=]?\s*(\d+)/i);
  const requestsCatalog =
    /\b(?:cat[aá]logo|productos?|modelos?|opciones|scrubs?|qu[eé]\s+(?:tienen|venden|ofrecen)|mu[eé]strame|quiero\s+ver)\b/i.test(message) &&
    /\b(?:disponibles?|tienen|ofrecen|venden|mostrar|muestra|mu[eé]strame|listar|lista|cu[aá]les|qu[eé]|ver|hay)\b/i.test(message);

  if (/\b(?:estado|status)\b/i.test(message) && orderMatch) {
    return { name: "commerce.getOrderStatus", arguments: { orderId: orderMatch[1] } };
  }

  if (/\b(?:disponibilidad|stock|available)\b/i.test(message) && productMatch) {
    return {
      name: "commerce.checkAvailability",
      arguments: {
        productId: productMatch[1],
        ...(quantityMatch ? { quantity: Number(quantityMatch[1]) } : {}),
      },
    };
  }

  const normalizedCurrent = String(message ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const isContextualFollowUp =
    /^[¿¡]?(?:y\s+)?(?:cuanto|cuesta|precio|valor|que precio|y ese|y esa|ese|esa|este|esta|tiene colores|que colores|colores|hay stock|tienen stock|disponibilidad)(?:\s+.*)?[?!.]*$/i
      .test(normalizedCurrent.trim());

  let contextualProduct;

  if (isContextualFollowUp) {
    const previousUserMessages = conversationMessages
      .filter(
        (entry) =>
          entry &&
          entry.role === "user" &&
          typeof entry.content === "string" &&
          entry.content !== message,
      )
      .map((entry) => entry.content)
      .reverse();

    for (const previous of previousUserMessages) {
      const normalizedPrevious = previous
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();

      if (/maria belen/.test(normalizedPrevious)) {
        contextualProduct = "Scrub Mar\u00eda Bel\u00e9n";
        break;
      }

      if (/maria jose/.test(normalizedPrevious)) {
        contextualProduct = "Scrub Mar\u00eda Jos\u00e9";
        break;
      }

      if (/chaqueta/.test(normalizedPrevious)) {
        contextualProduct = "Chaqueta Mar\u00eda Jos\u00e9";
        break;
      }

      if (/esencial/.test(normalizedPrevious)) {
        contextualProduct = "Scrub Esencial";
        break;
      }
    }
  }

  let query = contextualProduct ?? message;
  if (/no (?:sea|se vea|tan) (?:tan )?b[aá]sico|m[aá]s diferenciad/i.test(message)) query = "Scrubs con Detalles";
  else if (/chaqueta/i.test(message)) query = "Chaqueta María José";
  else if (/mar[ií]a bel[eé]n/i.test(message)) query = "Scrub María Belén";
  else if (/mar[ií]a jos[eé]/i.test(message)) query = "Scrub María José";
  else if (/esencial|colores?/i.test(message)) query = "Scrub Esencial";

  return {
    name: "commerce.searchProducts",
    arguments: { query: requestsCatalog ? "" : query, limit: 5 },
  };
}

function commerceResultText(result) {
  if (Array.isArray(result)) {
    if (result.length === 0) {
      return (
        "Por ahora no encontr\u00e9 un producto que coincida exactamente con lo que buscas \ud83d\ude0a\n\n" +
        "Si quieres, cu\u00e9ntame un poquito m\u00e1s qu\u00e9 tipo de modelo est\u00e1s buscando y te ayudo a revisar las opciones disponibles."
      );
    }

    const products = result
      .map((item) => {
        const record =
          item && typeof item === "object"
            ? item
            : {};

        const price =
          record.price && typeof record.price === "object"
            ? record.price
            : {};

        const hasPrice =
          typeof price.amount === "number" &&
          record.pricingStatus !== "PENDING";

        const variants =
          Array.isArray(record.variants)
            ? record.variants
            : [];

        const colors = variants
          .map((variant) =>
            variant && typeof variant === "object"
              ? variant.color
              : undefined,
          )
          .filter(
            (color) =>
              typeof color === "string" &&
              color.trim().length > 0,
          );

        return {
          name: String(
            record.name ??
            record.productId ??
            "Producto",
          ),
          price:
            hasPrice
              ? `${price.amount.toFixed(2)} ${typeof price.currency === "string" ? price.currency : ""}`.trim()
              : undefined,
          colors,
        };
      });

    if (products.length === 1) {
      const product = products[0];

      const details = [];

      if (product.colors.length > 0) {
        details.push(
          `Lo tenemos en ${product.colors.join(", ")}.`,
        );
      }

      if (product.price) {
        details.push(
          `Su precio es ${product.price}.`,
        );
      } else {
        details.push(
          "El precio todav\u00eda est\u00e1 pendiente de confirmaci\u00f3n, as\u00ed que prefiero no darte un valor incorrecto.",
        );
      }

      return (
        `\u00a1Claro! \ud83d\ude0a Te cuento sobre el *${product.name}*.\n\n` +
        details.join(" ") +
        "\n\nSi quieres, tambi\u00e9n puedo ayudarte a revisar otro de nuestros modelos."
      );
    }

    const names =
      products.map((product) => `\u2022 *${product.name}*`);

    const productsWithColors =
      products.filter(
        (product) =>
          product.colors.length > 0,
      );

    let reply =
      "\u00a1Claro! \ud83d\ude0a Actualmente en FLOES tenemos estas opciones:\n\n" +
      names.join("\n");

    if (productsWithColors.length > 0) {
      reply += "\n\n";

      reply += productsWithColors
        .map(
          (product) =>
            `El *${product.name}* est\u00e1 disponible en ${product.colors.join(", ")}.`,
        )
        .join("\n");
    }

    reply +=
      "\n\nSi alguno te llam\u00f3 la atenci\u00f3n, dime cu\u00e1l y con gusto te cuento los detalles que tenemos disponibles. \u2728";

    return reply;
  }

  if (result && typeof result === "object") {
    const record = result;

    if (typeof record.orderId === "string") {
      const status =
        typeof record.status === "string"
          ? record.status
          : undefined;

      if (status) {
        return `Claro \ud83d\ude0a Tu pedido se encuentra actualmente con estado *${status}*. Si quieres, puedo ayudarte a revisar otro detalle del pedido.`;
      }

      return "Claro \ud83d\ude0a Encontr\u00e9 tu pedido, pero no tengo un estado adicional confirmado para mostrarte en este momento.";
    }

    if (
      typeof record.productId === "string" &&
      typeof record.available === "boolean"
    ) {
      if (record.available) {
        const quantity =
          typeof record.availableQuantity === "number"
            ? ` Actualmente aparecen ${record.availableQuantity} unidades disponibles.`
            : "";

        return (
          "S\u00ed \ud83d\ude0a El producto aparece disponible." +
          quantity +
          " Si quieres, puedo ayudarte con otro detalle."
        );
      }

      return (
        "En este momento no aparece disponibilidad confirmada para ese producto. " +
        "Si quieres, puedo ayudarte a revisar otra opci\u00f3n \ud83d\ude0a"
      );
    }
  }

  return (
    "La consulta se realiz\u00f3 correctamente, pero no tengo informaci\u00f3n suficiente para darte un detalle adicional sin asumir datos. " +
    "Si me indicas qu\u00e9 deseas conocer, con gusto lo revisamos \ud83d\ude0a"
  );
}

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

  const commerceRuntime =
    createCommerceRuntimeFromEnv(
      commerceTenantId,
    );

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

  const commerceProvider =
    Object.freeze({
      name: "development",

      descriptor:
        Object.freeze({
          id:
            "floes-commerce-deterministic",

          name: "development",

          displayName:
            "FLOES Commerce Deterministic Provider",

          defaultModel:
            "commerce-grounded-v1",

          enabled: true,

          capabilities:
            Object.freeze({
              supportsStreaming: false,
              supportsTools: true,
              supportsJson: false,
              supportsMultimodal: false,
              supportsSeed: true,
            }),
        }),

      async generate(request) {
        const createdAt = now();
        const lastToolMessage =
          request.messages.findLast(
            (message) =>
              message.role === "tool",
          );

        let content;
        let toolCalls = Object.freeze([]);

        if (lastToolMessage !== undefined) {
          let result;
          try {
            result = JSON.parse(
              lastToolMessage.content,
            );
          } catch {
            result = undefined;
          }
          content = commerceResultText(result);
        } else {
          const userMessage =
            request.messages.findLast(
              (message) =>
                message.role === "user",
            )?.content ?? "";
          const call =
            commerceToolCall(
              userMessage,
              request.messages,
            );
          content =
            "Consultando la fuente comercial autorizada…";
          toolCalls = Object.freeze([
            Object.freeze({
              id:
                `call-${crypto.randomUUID()}`,
              name: call.name,
              arguments:
                Object.freeze(call.arguments),
            }),
          ]);
        }

        const message =
          createAssistantMessage(
            content,
            createdAt,
          );

        return Object.freeze({
          id:
            `response-${crypto.randomUUID()}`,
          requestId:
            request.requestId,
          provider:
            "development",
          model:
            "commerce-grounded-v1",
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
      providers: [
        provider,
        commerceProvider,
      ],

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

  const commerceDescriptor =
    Object.freeze({
      id: COMMERCE_ASSISTANT_ID,
      tenantId:
        commerceTenantId,
      name:
        "FLOES Commerce Assistant",
      description:
        "Asistente comercial conectado server-to-server con Chopify.",
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
          knowledge: false,
          tools: true,
          streaming: false,
        }),
    });

  const commerceToolDefinitions =
    Object.freeze(
      commerceRuntime.tools.map(
        (tool) =>
          Object.freeze({
            name:
              tool.descriptor.id,
            description:
              tool.descriptor.description,
            parameters:
              tool.descriptor.inputSchema,
          }),
      ),
    );

  manager.create({
    definition:
      Object.freeze({
        descriptor:
          commerceDescriptor,
        configuration:
          Object.freeze({
            primaryChatProviderId:
              commerceProvider.descriptor.id,
            prompt:
              COMMERCE_PROMPT_CONFIG,
            tools:
              commerceToolDefinitions,
            persistMessages: true,
            rejectInvalidResponse: true,
          }),
      }),
    dependencies:
      Object.freeze({
        chatProviders,
      }),
  });

  const assistants =
    new InMemoryAssistantRepository();

  assistants.register(
    descriptor,
  );

  assistants.register(
    commerceDescriptor,
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

  for (const tool of commerceRuntime.tools) {
    registry.register(
      tool,
    );
  }

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

  const conversations =
    new FirestoreConversationRepository(
      firestore,
    );

  const audit =
    new FirestoreRequestAuditSink(
      firestore,
    );

  const rateLimiter =
    new FirestoreRateLimiter(
      firestore,
    );

  const toolServices =
    createToolServices({
      registry,
    });

  const chat =
    Object.freeze({
      async generate(input) {
        return runtimeGateway
          .generate(
            input,
          );
      },
    });

  const application =
    createBackendApplication(
      {
        chat,
        assistants,
        conversations,
        audit,
        rateLimiter,
        tools: toolServices,
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

  const livePrincipal =
    Object.freeze({
      actorId:
        "chopify-whatsapp-live",
      tenantId:
        commerceTenantId,
      roles:
        Object.freeze([
          "user",
        ]),
      permissions:
        Object.freeze([
          "assistants:read",
          "conversations:read",
          "conversations:write",
          "chat:execute",
          "tools:execute",
        ]),
      assistantIds:
        Object.freeze([
          COMMERCE_ASSISTANT_ID,
        ]),
      authenticated: true,
    });

  const liveApplication =
    createBackendApplication(
      {
        chat,
        assistants,
        conversations,
        audit,
        rateLimiter,
        tools: toolServices,
        knowledgeManager,
        studio,
        authentication:
          Object.freeze({
            async authenticate() {
              return Object.freeze({
                principal:
                  livePrincipal,
              });
            },
          }),
      },
      {
        maximumBodyBytes:
          32 * 1024,
      },
    );

  async function processLiveWhatsApp(input) {
    const requestId =
      `live-${crypto.randomUUID()}`;
    const correlationId =
      `whatsapp-${input.providerMessageId}`;
    const conversationId =
      `whatsapp-${createHash("sha256")
        .update(`${commerceTenantId}:${input.customer.phone}`)
        .digest("hex")}`;
    const headers =
      Object.freeze({
        authorization:
          "Bearer internal-live-boundary",
        "content-type":
          "application/json",
        "x-request-id":
          requestId,
        "x-correlation-id":
          correlationId,
      });

    const identityResponse =
      await liveApplication.handle(
        new Request(
          "https://gano-bot.internal/v1/tools/commerce.resolveCustomerIdentity/execute",
          {
            method: "POST",
            headers,
            body:
              JSON.stringify({
                assistantId:
                  COMMERCE_ASSISTANT_ID,
                conversationId,
                arguments:
                  {
                    channel:
                      "WHATSAPP",
                    externalIdentifier:
                      input.customer.phone,
                    phone:
                      input.customer.phone,
                    ...(input.customer.name
                      ? {
                          name:
                            input.customer.name,
                        }
                      : {}),
                    acquisitionSource:
                      "WHATSAPP",
                  },
              }),
          },
        ),
      );

    const identityPayload =
      await identityResponse.json();
    const identityResult =
      identityPayload?.data;

    if (
      !identityResponse.ok ||
      identityResult?.status !== "completed"
    ) {
      throw new LiveProcessingError(
        "resolve-customer-identity",
        identityResponse.status,
        `Identity tool ended with ${String(identityResult?.status ?? "invalid-response")}.`,
      );
    }

    const chatResponse =
      await liveApplication.handle(
        new Request(
          "https://gano-bot.internal/v1/chat",
          {
            method: "POST",
            headers,
            body:
              JSON.stringify({
                assistantId:
                  COMMERCE_ASSISTANT_ID,
                conversationId,
                message:
                  input.text,
                locale: "es",
                metadata:
                  {
                    channel:
                      "WHATSAPP",
                    providerMessageId:
                      input.providerMessageId,
                  },
              }),
          },
        ),
      );

    if (!chatResponse.ok) {
      throw new LiveProcessingError(
        "commerce-assistant",
        chatResponse.status,
        "Commerce assistant request failed.",
      );
    }

    const payload =
      await chatResponse.json();
    const reply =
      payload?.data?.message?.content;

    if (
      typeof reply !== "string" ||
      !reply.trim()
    ) {
      throw new LiveProcessingError(
        "response-validation",
        502,
        "Commerce assistant returned an invalid reply.",
      );
    }

    return Object.freeze({
      reply:
        reply.trim(),
    });
  }

  return Object.freeze({
    application,
    processLiveWhatsApp,

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
  commerceToolCall,
  commerceResultText,
};
