/**
 * @package @gano-bot/ai-core
 * @file promptBuilder.ts
 * @version 0.2.0
 *
 * Constructor profesional de prompts para GANO_BOT.
 *
 * Responsabilidades:
 * - Crear prompts de sistema consistentes.
 * - Incorporar contexto del usuario y del negocio.
 * - Incorporar memoria relevante.
 * - Incorporar documentos recuperados mediante RAG.
 * - Incorporar planes de ejecución.
 * - Controlar un presupuesto aproximado de tokens.
 * - Priorizar y truncar secciones cuando sea necesario.
 * - Mantener el historial de conversación dentro de límites seguros.
 *
 * Este módulo:
 * - No llama directamente a ningún LLM.
 * - No depende de Firebase.
 * - No depende de React.
 * - No ejecuta herramientas.
 */

import type {
  AIBuiltPrompt,
  AIContext,
  AIContextSection,
  AIExecutionPlan,
  AIIdentifier,
  AIMessage,
  AIMemoryEntry,
  AIMetadata,
  AIPriority,
  AIPromptBuildRequest,
  AIPromptBuilder,
  AIPromptSection,
  AIPromptSectionType,
  AIRetrievedDocument,
  AITokenCount,
} from "./types.js";

import {
  EMPTY_AI_METADATA,
} from "./types.js";

/* ============================================================================
 * TIPOS PÚBLICOS
 * ========================================================================== */

export interface PromptBuilderIdentityConfig {
  readonly assistantName?: string;
  readonly organizationName?: string;
  readonly description?: string;
  readonly language?: string;
  readonly tone?: string;
}

export interface PromptBuilderLimits {
  /**
   * Máximo aproximado de tokens permitido para el prompt completo.
   */
  readonly maximumTokens?: AITokenCount;

  /**
   * Tokens reservados para la respuesta del modelo.
   */
  readonly reservedOutputTokens?: AITokenCount;

  /**
   * Máximo de mensajes históricos incorporados.
   */
  readonly maximumHistoryMessages?: number;

  /**
   * Máximo de recuerdos incorporados.
   */
  readonly maximumMemoryEntries?: number;

  /**
   * Máximo de documentos RAG incorporados.
   */
  readonly maximumDocuments?: number;

  /**
   * Máximo de secciones contextuales incorporadas.
   */
  readonly maximumContextSections?: number;

  /**
   * Máximo de caracteres permitido por sección.
   */
  readonly maximumSectionCharacters?: number;
}

export interface PromptBuilderConfig {
  readonly identity?: PromptBuilderIdentityConfig;
  readonly limits?: PromptBuilderLimits;

  /**
   * Instrucciones base adicionales.
   */
  readonly instructions?: readonly string[];

  /**
   * Reglas de seguridad adicionales.
   */
  readonly safetyRules?: readonly string[];

  /**
   * Reglas obligatorias para la salida.
   */
  readonly outputRules?: readonly string[];

  /**
   * Permite incluir contexto del usuario.
   */
  readonly includeUserContext?: boolean;

  /**
   * Permite incluir contexto comercial.
   */
  readonly includeBusinessContext?: boolean;

  /**
   * Permite incluir secciones contextuales.
   */
  readonly includeContextSections?: boolean;

  /**
   * Permite incluir recuerdos.
   */
  readonly includeMemory?: boolean;

  /**
   * Permite incluir documentos RAG.
   */
  readonly includeKnowledge?: boolean;

  /**
   * Permite incluir el plan de ejecución.
   */
  readonly includeExecutionPlan?: boolean;

  /**
   * Permite incorporar el historial de conversación.
   */
  readonly includeConversationHistory?: boolean;

  /**
   * Función personalizada para crear identificadores.
   */
  readonly generateId?: () => AIIdentifier;

  /**
   * Estimador de tokens personalizado.
   */
  readonly estimateTokens?: (
    text: string,
  ) => AITokenCount;
}

export interface CreatePromptSectionInput {
  readonly id?: AIIdentifier;
  readonly type: AIPromptSectionType;
  readonly title?: string;
  readonly content: string;
  readonly priority?: AIPriority;
  readonly enabled?: boolean;
  readonly metadata?: AIMetadata;
}

export interface PromptSectionCompilationResult {
  readonly systemPrompt: string;
  readonly includedSections: readonly AIPromptSection[];
  readonly omittedSectionIds: readonly AIIdentifier[];
  readonly estimatedTokens: AITokenCount;
  readonly truncated: boolean;
  readonly warnings: readonly string[];
}

/* ============================================================================
 * CONSTANTES
 * ========================================================================== */

export const DEFAULT_PROMPT_MAXIMUM_TOKENS =
  32_000;

export const DEFAULT_PROMPT_RESERVED_OUTPUT_TOKENS =
  4_000;

export const DEFAULT_PROMPT_MAXIMUM_HISTORY_MESSAGES =
  30;

export const DEFAULT_PROMPT_MAXIMUM_MEMORY_ENTRIES =
  12;

export const DEFAULT_PROMPT_MAXIMUM_DOCUMENTS =
  8;

export const DEFAULT_PROMPT_MAXIMUM_CONTEXT_SECTIONS =
  30;

export const DEFAULT_PROMPT_MAXIMUM_SECTION_CHARACTERS =
  12_000;

export const DEFAULT_PROMPT_ASSISTANT_NAME =
  "GANO_BOT";

export const DEFAULT_PROMPT_ORGANIZATION_NAME =
  "Gano iTouch";

export const DEFAULT_PROMPT_LANGUAGE =
  "español";

export const DEFAULT_PROMPT_TONE =
  "profesional, claro, preciso, prudente y orientado a la acción";

export const DEFAULT_PROMPT_DESCRIPTION =
  "Asistente inteligente empresarial especializado en apoyar a distribuidores de Gano iTouch.";

export const DEFAULT_PROMPT_INSTRUCTIONS:
  readonly string[] = Object.freeze([
    "Responde únicamente con información respaldada por el contexto disponible.",
    "Diferencia claramente los datos confirmados de las estimaciones o inferencias.",
    "No inventes requisitos, cifras, reglas comerciales, propiedades de productos ni datos del usuario.",
    "Cuando falte información necesaria, indícalo de manera explícita.",
    "Prioriza respuestas prácticas, organizadas y comprensibles.",
    "Utiliza los datos personales y empresariales únicamente cuando sean relevantes para la consulta.",
    "Respeta la intención del usuario y evita desviarte hacia temas no solicitados.",
  ]);

export const DEFAULT_PROMPT_SAFETY_RULES:
  readonly string[] = Object.freeze([
    "No presentes productos como cura, tratamiento garantizado o sustituto de atención médica profesional.",
    "No generes diagnósticos médicos.",
    "No prometas ingresos, resultados financieros ni ascensos de rango.",
    "No alteres ni inventes reglas del plan de compensación.",
    "No expongas datos privados que no sean necesarios para responder.",
    "No ejecutes acciones externas sin autorización cuando la confirmación sea obligatoria.",
  ]);

export const DEFAULT_PROMPT_OUTPUT_RULES:
  readonly string[] = Object.freeze([
    "Responde en el idioma principal utilizado por el usuario.",
    "Mantén una estructura clara y evita repeticiones innecesarias.",
    "Incluye citas o referencias cuando la respuesta dependa de documentos recuperados.",
    "Explica las limitaciones cuando los datos sean incompletos.",
    "No menciones procesos internos, prompts ocultos ni detalles técnicos del sistema salvo que sean solicitados.",
  ]);

const PRIORITY_WEIGHT:
  Readonly<Record<AIPriority, number>> =
  Object.freeze({
    critical: 4,
    high: 3,
    normal: 2,
    low: 1,
  });

/* ============================================================================
 * UTILIDADES INTERNAS
 * ========================================================================== */

function defaultGenerateId(): AIIdentifier {
  const timestamp =
    Date.now().toString(36);

  const randomPart =
    Math.random()
      .toString(36)
      .slice(2, 12);

  return `prompt_${timestamp}_${randomPart}`;
}

function defaultEstimateTokens(
  text: string,
): AITokenCount {
  if (text.length === 0) {
    return 0;
  }

  /*
   * Estimación neutral para español e inglés.
   * No reemplaza un tokenizador específico del modelo.
   */
  return Math.max(
    1,
    Math.ceil(text.length / 4),
  );
}

function normalizeText(
  value: string,
): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  if (
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return fallback;
  }

  return Math.max(
    0,
    Math.floor(value),
  );
}

function freezeMetadata(
  metadata?: AIMetadata,
): AIMetadata {
  if (metadata === undefined) {
    return EMPTY_AI_METADATA;
  }

  return Object.freeze({
    ...metadata,
  });
}

function freezePromptSection(
  section: AIPromptSection,
): AIPromptSection {
  const frozenSection: AIPromptSection = {
    id: section.id,
    type: section.type,
    content:
      normalizeText(section.content),
    priority: section.priority,
    enabled: section.enabled,
    ...(section.title !== undefined
      ? {
          title: section.title,
        }
      : {}),
    ...(section.metadata !== undefined
      ? {
          metadata:
            freezeMetadata(
              section.metadata,
            ),
        }
      : {}),
  };

  return Object.freeze(
    frozenSection,
  );
}

function freezePromptSections(
  sections: readonly AIPromptSection[],
): readonly AIPromptSection[] {
  return Object.freeze(
    sections.map(
      freezePromptSection,
    ),
  );
}

function truncateText(
  content: string,
  maximumCharacters: number,
): {
  readonly content: string;
  readonly truncated: boolean;
} {
  if (
    maximumCharacters <= 0 ||
    content.length <= maximumCharacters
  ) {
    return {
      content,
      truncated: false,
    };
  }

  const suffix =
    "\n\n[Contenido truncado por límite de contexto]";

  const availableCharacters =
    Math.max(
      0,
      maximumCharacters -
        suffix.length,
    );

  return {
    content:
      content.slice(
        0,
        availableCharacters,
      ) + suffix,
    truncated: true,
  };
}

function formatValue(
  value: unknown,
  indentation = 0,
): string {
  if (
    value === null ||
    value === undefined
  ) {
    return "No disponible";
  }

  if (typeof value === "string") {
    return value.trim().length > 0
      ? value
      : "No disponible";
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "Sin datos";
    }

    return value
      .map(
        (item, index) =>
          `${" ".repeat(indentation)}${index + 1}. ${formatValue(
            item,
            indentation + 2,
          )}`,
      )
      .join("\n");
  }

  if (typeof value === "object") {
    const entries =
      Object.entries(
        value as Record<
          string,
          unknown
        >,
      );

    if (entries.length === 0) {
      return "Sin datos";
    }

    return entries
      .map(
        ([key, item]) => {
          const formatted =
            formatValue(
              item,
              indentation + 2,
            );

          if (
            typeof item === "object" &&
            item !== null
          ) {
            return `${" ".repeat(indentation)}${key}:\n${formatted}`;
          }

          return `${" ".repeat(indentation)}${key}: ${formatted}`;
        },
      )
      .join("\n");
  }

  return String(value);
}

function formatNumber(
  value: number | undefined,
): string {
  if (value === undefined) {
    return "No disponible";
  }

  return new Intl.NumberFormat(
    "es-ES",
    {
      maximumFractionDigits: 2,
    },
  ).format(value);
}

function formatCurrency(
  value: number | undefined,
  currency: string | undefined,
): string {
  if (value === undefined) {
    return "No disponible";
  }

  const normalizedCurrency =
    currency?.trim().toUpperCase() ||
    "USD";

  try {
    return new Intl.NumberFormat(
      "es-ES",
      {
        style: "currency",
        currency:
          normalizedCurrency,
        maximumFractionDigits: 2,
      },
    ).format(value);
  } catch {
    return `${formatNumber(value)} ${normalizedCurrency}`;
  }
}

function formatList(
  values: readonly string[],
): string {
  return values
    .map(
      (value, index) =>
        `${index + 1}. ${value}`,
    )
    .join("\n");
}

function formatSectionForPrompt(
  section: AIPromptSection,
): string {
  const heading =
    section.title !== undefined &&
    section.title.trim().length > 0
      ? `## ${section.title}`
      : `## ${section.type}`;

  return `${heading}\n${section.content}`;
}

function sortSectionsByPriority(
  sections: readonly AIPromptSection[],
): readonly AIPromptSection[] {
  return [...sections].sort(
    (
      left,
      right,
    ) => {
      const priorityDifference =
        PRIORITY_WEIGHT[
          right.priority
        ] -
        PRIORITY_WEIGHT[
          left.priority
        ];

      if (
        priorityDifference !== 0
      ) {
        return priorityDifference;
      }

      return left.id.localeCompare(
        right.id,
      );
    },
  );
}

function sortMemoryEntries(
  entries: readonly AIMemoryEntry[],
): readonly AIMemoryEntry[] {
  return [...entries].sort(
    (
      left,
      right,
    ) => {
      if (
        right.importance !==
        left.importance
      ) {
        return (
          right.importance -
          left.importance
        );
      }

      if (
        right.confidence !==
        left.confidence
      ) {
        return (
          right.confidence -
          left.confidence
        );
      }

      return (
        Date.parse(
          right.updatedAt,
        ) -
        Date.parse(
          left.updatedAt,
        )
      );
    },
  );
}

function sortDocuments(
  documents:
    readonly AIRetrievedDocument[],
): readonly AIRetrievedDocument[] {
  return [...documents].sort(
    (
      left,
      right,
    ) => {
      if (
        right.score !== left.score
      ) {
        return (
          right.score -
          left.score
        );
      }

      return (
        left.rank -
        right.rank
      );
    },
  );
}

function cloneMessage(
  message: AIMessage,
): AIMessage {
  const clonedMessage: AIMessage = {
    id: message.id,
    role: message.role,
    content: message.content,
    contentType:
      message.contentType,
    status: message.status,
    createdAt:
      message.createdAt,
    updatedAt:
      message.updatedAt,
    ...(message.conversationId !==
    undefined
      ? {
          conversationId:
            message.conversationId,
        }
      : {}),
    ...(message.parts !== undefined
      ? {
          parts:
            Object.freeze([
              ...message.parts,
            ]),
        }
      : {}),
    ...(message.name !== undefined
      ? {
          name: message.name,
        }
      : {}),
    ...(message.toolCallId !==
    undefined
      ? {
          toolCallId:
            message.toolCallId,
        }
      : {}),
    ...(message.metadata !== undefined
      ? {
          metadata:
            freezeMetadata(
              message.metadata,
            ),
        }
      : {}),
  };

  return Object.freeze(
    clonedMessage,
  );
}

/* ============================================================================
 * CREACIÓN DE SECCIONES
 * ========================================================================== */

export function createPromptSection(
  input: CreatePromptSectionInput,
  generateId: () => AIIdentifier =
    defaultGenerateId,
): AIPromptSection {
  const content =
    normalizeText(input.content);

  if (content.length === 0) {
    throw new Error(
      "Una sección del prompt no puede tener contenido vacío.",
    );
  }

  const section: AIPromptSection = {
    id:
      input.id ??
      generateId(),
    type: input.type,
    content,
    priority:
      input.priority ??
      "normal",
    enabled:
      input.enabled ??
      true,
    ...(input.title !== undefined
      ? {
          title:
            normalizeText(
              input.title,
            ),
        }
      : {}),
    ...(input.metadata !== undefined
      ? {
          metadata:
            freezeMetadata(
              input.metadata,
            ),
        }
      : {}),
  };

  return freezePromptSection(
    section,
  );
}

/* ============================================================================
 * GENERADORES DE CONTENIDO
 * ========================================================================== */

function buildIdentityContent(
  identity: Required<
    PromptBuilderIdentityConfig
  >,
): string {
  return normalizeText(`
Eres ${identity.assistantName}, ${identity.description}

Organización de referencia: ${identity.organizationName}.
Idioma principal: ${identity.language}.
Tono de respuesta: ${identity.tone}.

Tu objetivo es ayudar al usuario de manera útil, responsable y basada en los datos disponibles.
`);
}

function buildUserContextContent(
  context: AIContext,
): string {
  const user =
    context.user;

  const lines = [
    `ID de usuario: ${user.userId ?? "No disponible"}`,
    `ID de distribuidor: ${user.distributorId ?? "No disponible"}`,
    `Nombre: ${user.name ?? "No disponible"}`,
    `Correo: ${user.email ?? "No disponible"}`,
    `País: ${user.country ?? "No disponible"}`,
    `Idioma: ${user.language ?? user.locale ?? "No disponible"}`,
    `Zona horaria: ${user.timezone ?? "No disponible"}`,
    `Autenticado: ${
      user.authenticated === undefined
        ? "No disponible"
        : user.authenticated
          ? "Sí"
          : "No"
    }`,
  ];

  if (user.metadata !== undefined) {
    lines.push(
      "",
      "Metadatos del usuario:",
      formatValue(
        user.metadata,
      ),
    );
  }

  return lines.join("\n");
}

function buildApplicationContextContent(
  context: AIContext,
): string {
  const application =
    context.application;

  const lines = [
    `Aplicación: ${application.applicationName ?? "No disponible"}`,
    `ID de aplicación: ${application.applicationId ?? "No disponible"}`,
    `Entorno: ${application.environment ?? "No disponible"}`,
    `Módulo actual: ${application.currentModule ?? "No disponible"}`,
    `Vista actual: ${application.currentView ?? "No disponible"}`,
    `Ruta actual: ${application.currentRoute ?? "No disponible"}`,
    `Sesión: ${application.sessionId ?? "No disponible"}`,
  ];

  if (
    application.metadata !==
    undefined
  ) {
    lines.push(
      "",
      "Metadatos de la aplicación:",
      formatValue(
        application.metadata,
      ),
    );
  }

  return lines.join("\n");
}

function buildBusinessContextContent(
  context: AIContext,
): string | null {
  const business =
    context.business;

  if (business === undefined) {
    return null;
  }

  const lines = [
    `Rango actual: ${business.rank ?? "No disponible"}`,
    `Rango objetivo: ${business.targetRank ?? "No disponible"}`,
    `Paquete: ${business.packageCode ?? "No disponible"}`,
    `Estado: ${business.status ?? "No disponible"}`,
    `PV personal: ${formatNumber(business.personalVolume)}`,
    `CV: ${formatNumber(business.commissionVolume)}`,
    `GCV: ${formatNumber(business.groupCommissionVolume)}`,
    `Volumen pierna izquierda: ${formatNumber(business.leftLegVolume)}`,
    `Volumen pierna derecha: ${formatNumber(business.rightLegVolume)}`,
    `Volumen pierna débil: ${formatNumber(business.weakLegVolume)}`,
    `Volumen pierna fuerte: ${formatNumber(business.strongLegVolume)}`,
    `Ingreso estimado: ${formatCurrency(
      business.estimatedIncome,
      business.currency,
    )}`,
    `Ciclo actual: ${business.currentCycleId ?? "No disponible"}`,
  ];

  if (
    business.metadata !== undefined
  ) {
    lines.push(
      "",
      "Metadatos empresariales:",
      formatValue(
        business.metadata,
      ),
    );
  }

  return lines.join("\n");
}

function buildContextSectionContent(
  section: AIContextSection,
): string {
  const lines = [
    `Dominio: ${section.domain}`,
    `Prioridad: ${section.priority}`,
  ];

  if (section.source !== undefined) {
    lines.push(
      `Fuente: ${section.source}`,
    );
  }

  if (
    section.updatedAt !== undefined
  ) {
    lines.push(
      `Actualizado: ${section.updatedAt}`,
    );
  }

  lines.push(
    "",
    formatValue(section.content),
  );

  return lines.join("\n");
}

function buildMemoryContent(
  entries: readonly AIMemoryEntry[],
): string {
  return entries
    .map(
      (entry, index) => {
        const sourceMessageIds =
          entry.sourceMessageIds !==
          undefined &&
          entry.sourceMessageIds.length >
            0
            ? entry.sourceMessageIds.join(
                ", ",
              )
            : "No disponible";

        return normalizeText(`
### Recuerdo ${index + 1}
Tipo: ${entry.type}
Alcance: ${entry.scope}
Importancia: ${entry.importance}
Confianza: ${entry.confidence}
Contenido: ${entry.content}
Mensajes de origen: ${sourceMessageIds}
`);
      },
    )
    .join("\n\n");
}

function buildKnowledgeContent(
  documents:
    readonly AIRetrievedDocument[],
): string {
  return documents
    .map(
      (document, index) => {
        const source =
          document.chunk.source;

        return normalizeText(`
### Documento ${index + 1}
ID de fragmento: ${document.chunk.id}
ID de documento: ${document.chunk.documentId}
Título: ${source.title}
Tipo: ${source.type}
Puntuación de relevancia: ${document.score}
Posición: ${document.rank}
Página: ${source.page ?? "No disponible"}
Sección: ${source.section ?? "No disponible"}
URI: ${source.uri ?? "No disponible"}

Contenido:
${document.chunk.content}
`);
      },
    )
    .join("\n\n");
}

function buildExecutionPlanContent(
  plan: AIExecutionPlan,
): string {
  const steps =
    plan.steps
      .map(
        (step, index) => {
          const dependencyText =
            step.dependsOn.length > 0
              ? step.dependsOn.join(
                  ", ",
                )
              : "Ninguna";

          const baseLines = [
            `${index + 1}. ${step.name}`,
            `   - ID: ${step.id}`,
            `   - Tipo: ${step.type}`,
            `   - Prioridad: ${step.priority}`,
            `   - Opcional: ${step.optional ? "Sí" : "No"}`,
            `   - Dependencias: ${dependencyText}`,
          ];

          if (
            step.description !==
            undefined
          ) {
            baseLines.push(
              `   - Descripción: ${step.description}`,
            );
          }

          if (
            step.type ===
            "execute-tool"
          ) {
            baseLines.push(
              `   - Herramienta: ${step.toolName}`,
              `   - Requiere confirmación: ${step.requiresConfirmation ? "Sí" : "No"}`,
              `   - Argumentos: ${formatValue(step.arguments)}`,
            );
          }

          return baseLines.join(
            "\n",
          );
        },
      )
      .join("\n\n");

  return normalizeText(`
ID del plan: ${plan.id}
Intención principal: ${plan.intent.primary.name}
Confianza de intención: ${plan.intent.primary.confidence}
Complejidad estimada: ${plan.estimatedComplexity}
Requiere recuperación de conocimiento: ${plan.requiresKnowledgeRetrieval ? "Sí" : "No"}
Requiere datos empresariales: ${plan.requiresBusinessData ? "Sí" : "No"}
Requiere herramientas: ${plan.requiresTools ? "Sí" : "No"}

Pasos:
${steps}
`);
}

function buildUserRequestContent(
  userMessage: AIMessage,
): string {
  return normalizeText(`
Mensaje actual del usuario:

${userMessage.content}
`);
}

/* ============================================================================
 * COMPILADOR DE SECCIONES
 * ========================================================================== */

export function compilePromptSections(
  sections: readonly AIPromptSection[],
  options: {
    readonly maximumTokens: AITokenCount;
    readonly reservedOutputTokens: AITokenCount;
    readonly estimateTokens?: (
      text: string,
    ) => AITokenCount;
  },
): PromptSectionCompilationResult {
  const estimateTokens =
    options.estimateTokens ??
    defaultEstimateTokens;

  const availableTokens =
    Math.max(
      0,
      options.maximumTokens -
        options.reservedOutputTokens,
    );

  const enabledSections =
    sortSectionsByPriority(
      sections.filter(
        (section) =>
          section.enabled &&
          section.content.trim().length >
            0,
      ),
    );

  const includedSections:
    AIPromptSection[] = [];

  const omittedSectionIds:
    AIIdentifier[] = [];

  const warnings:
    string[] = [];

  let estimatedTokens = 0;
  let truncated = false;

  for (
    const section of
    enabledSections
  ) {
    const formatted =
      formatSectionForPrompt(
        section,
      );

    const sectionTokens =
      estimateTokens(formatted);

    if (
      estimatedTokens +
        sectionTokens <=
      availableTokens
    ) {
      includedSections.push(
        section,
      );

      estimatedTokens +=
        sectionTokens;

      continue;
    }

    if (
      section.priority ===
        "critical" &&
      estimatedTokens <
        availableTokens
    ) {
      const remainingTokens =
        availableTokens -
        estimatedTokens;

      const approximateCharacters =
        Math.max(
          0,
          remainingTokens * 4,
        );

      const truncatedResult =
        truncateText(
          section.content,
          approximateCharacters,
        );

      if (
        truncatedResult.content
          .trim().length > 0
      ) {
        const truncatedSection =
          freezePromptSection({
            ...section,
            content:
              truncatedResult.content,
          });

        includedSections.push(
          truncatedSection,
        );

        estimatedTokens +=
          estimateTokens(
            formatSectionForPrompt(
              truncatedSection,
            ),
          );

        truncated = true;

        warnings.push(
          `La sección crítica "${section.id}" fue truncada para respetar el presupuesto de tokens.`,
        );

        continue;
      }
    }

    omittedSectionIds.push(
      section.id,
    );

    truncated = true;

    warnings.push(
      `La sección "${section.id}" fue omitida por falta de espacio en el contexto.`,
    );
  }

  const systemPrompt =
    includedSections
      .map(
        formatSectionForPrompt,
      )
      .join("\n\n");

  return Object.freeze({
    systemPrompt,
    includedSections:
      freezePromptSections(
        includedSections,
      ),
    omittedSectionIds:
      Object.freeze([
        ...omittedSectionIds,
      ]),
    estimatedTokens:
      Math.min(
        estimatedTokens,
        availableTokens,
      ),
    truncated,
    warnings:
      Object.freeze([
        ...warnings,
      ]),
  });
}

/* ============================================================================
 * CONSTRUCTOR PRINCIPAL
 * ========================================================================== */

export class DefaultPromptBuilder
  implements AIPromptBuilder
{
  private readonly identity:
    Required<PromptBuilderIdentityConfig>;

  private readonly maximumTokens:
    AITokenCount;

  private readonly reservedOutputTokens:
    AITokenCount;

  private readonly maximumHistoryMessages:
    number;

  private readonly maximumMemoryEntries:
    number;

  private readonly maximumDocuments:
    number;

  private readonly maximumContextSections:
    number;

  private readonly maximumSectionCharacters:
    number;

  private readonly instructions:
    readonly string[];

  private readonly safetyRules:
    readonly string[];

  private readonly outputRules:
    readonly string[];

  private readonly includeUserContext:
    boolean;

  private readonly includeBusinessContext:
    boolean;

  private readonly includeContextSections:
    boolean;

  private readonly includeMemory:
    boolean;

  private readonly includeKnowledge:
    boolean;

  private readonly includeExecutionPlan:
    boolean;

  private readonly includeConversationHistory:
    boolean;

  private readonly generateId:
    () => AIIdentifier;

  private readonly estimateTokens:
    (
      text: string,
    ) => AITokenCount;

  public constructor(
    config: PromptBuilderConfig = {},
  ) {
    this.identity = Object.freeze({
      assistantName:
        config.identity
          ?.assistantName ??
        DEFAULT_PROMPT_ASSISTANT_NAME,

      organizationName:
        config.identity
          ?.organizationName ??
        DEFAULT_PROMPT_ORGANIZATION_NAME,

      description:
        config.identity
          ?.description ??
        DEFAULT_PROMPT_DESCRIPTION,

      language:
        config.identity
          ?.language ??
        DEFAULT_PROMPT_LANGUAGE,

      tone:
        config.identity
          ?.tone ??
        DEFAULT_PROMPT_TONE,
    });

    this.maximumTokens =
      normalizePositiveInteger(
        config.limits
          ?.maximumTokens,
        DEFAULT_PROMPT_MAXIMUM_TOKENS,
      );

    this.reservedOutputTokens =
      normalizePositiveInteger(
        config.limits
          ?.reservedOutputTokens,
        DEFAULT_PROMPT_RESERVED_OUTPUT_TOKENS,
      );

    this.maximumHistoryMessages =
      normalizePositiveInteger(
        config.limits
          ?.maximumHistoryMessages,
        DEFAULT_PROMPT_MAXIMUM_HISTORY_MESSAGES,
      );

    this.maximumMemoryEntries =
      normalizePositiveInteger(
        config.limits
          ?.maximumMemoryEntries,
        DEFAULT_PROMPT_MAXIMUM_MEMORY_ENTRIES,
      );

    this.maximumDocuments =
      normalizePositiveInteger(
        config.limits
          ?.maximumDocuments,
        DEFAULT_PROMPT_MAXIMUM_DOCUMENTS,
      );

    this.maximumContextSections =
      normalizePositiveInteger(
        config.limits
          ?.maximumContextSections,
        DEFAULT_PROMPT_MAXIMUM_CONTEXT_SECTIONS,
      );

    this.maximumSectionCharacters =
      normalizePositiveInteger(
        config.limits
          ?.maximumSectionCharacters,
        DEFAULT_PROMPT_MAXIMUM_SECTION_CHARACTERS,
      );

    this.instructions =
      Object.freeze([
        ...DEFAULT_PROMPT_INSTRUCTIONS,
        ...(config.instructions ??
          []),
      ]);

    this.safetyRules =
      Object.freeze([
        ...DEFAULT_PROMPT_SAFETY_RULES,
        ...(config.safetyRules ??
          []),
      ]);

    this.outputRules =
      Object.freeze([
        ...DEFAULT_PROMPT_OUTPUT_RULES,
        ...(config.outputRules ??
          []),
      ]);

    this.includeUserContext =
      config.includeUserContext ??
      true;

    this.includeBusinessContext =
      config.includeBusinessContext ??
      true;

    this.includeContextSections =
      config.includeContextSections ??
      true;

    this.includeMemory =
      config.includeMemory ??
      true;

    this.includeKnowledge =
      config.includeKnowledge ??
      true;

    this.includeExecutionPlan =
      config.includeExecutionPlan ??
      true;

    this.includeConversationHistory =
      config.includeConversationHistory ??
      true;

    this.generateId =
      config.generateId ??
      defaultGenerateId;

    this.estimateTokens =
      config.estimateTokens ??
      defaultEstimateTokens;
  }

  public async build(
    request: AIPromptBuildRequest,
  ): Promise<AIBuiltPrompt> {
    const sections =
      this.createSections(request);

    const requestedMaximumTokens =
      request.maximumTokens !==
      undefined
        ? normalizePositiveInteger(
            request.maximumTokens,
            this.maximumTokens,
          )
        : this.maximumTokens;

    const compilation =
      compilePromptSections(
        sections,
        {
          maximumTokens:
            requestedMaximumTokens,
          reservedOutputTokens:
            this.reservedOutputTokens,
          estimateTokens:
            this.estimateTokens,
        },
      );

    const history =
      this.includeConversationHistory
        ? this.prepareHistory(
            request.history,
          )
        : [];

    const messages =
      this.buildOutputMessages(
        history,
        request.userMessage,
      );

    const messageTokens =
      this.estimateMessageTokens(
        messages,
      );

    const totalEstimatedTokens =
      compilation.estimatedTokens +
      messageTokens;

    const warnings = [
      ...compilation.warnings,
    ];

    let truncated =
      compilation.truncated;

    if (
      totalEstimatedTokens >
      requestedMaximumTokens
    ) {
      warnings.push(
        "El tamaño estimado del prompt completo supera el límite solicitado después de incorporar los mensajes.",
      );

      truncated = true;
    }

    return Object.freeze({
      systemPrompt:
        compilation.systemPrompt,
      messages:
        Object.freeze(messages),
      sections:
        compilation.includedSections,
      estimatedTokens:
        totalEstimatedTokens,
      truncated,
      warnings:
        Object.freeze(warnings),
      metadata:
        Object.freeze({
          builder:
            "DefaultPromptBuilder",
          sectionCount:
            compilation
              .includedSections
              .length,
          messageCount:
            messages.length,
          omittedSectionCount:
            compilation
              .omittedSectionIds
              .length,
        }),
    });
  }

  private createSections(
    request: AIPromptBuildRequest,
  ): readonly AIPromptSection[] {
    const sections:
      AIPromptSection[] = [];

    sections.push(
      createPromptSection(
        {
          id: "identity",
          type: "identity",
          title:
            "Identidad del asistente",
          content:
            buildIdentityContent(
              this.identity,
            ),
          priority: "critical",
        },
        this.generateId,
      ),
    );

    sections.push(
      createPromptSection(
        {
          id: "instructions",
          type: "instructions",
          title:
            "Instrucciones generales",
          content:
            formatList(
              this.instructions,
            ),
          priority: "critical",
        },
        this.generateId,
      ),
    );

    sections.push(
      createPromptSection(
        {
          id: "safety",
          type: "safety",
          title:
            "Reglas de seguridad y precisión",
          content:
            formatList(
              this.safetyRules,
            ),
          priority: "critical",
        },
        this.generateId,
      ),
    );

    sections.push(
      createPromptSection(
        {
          id: "output-format",
          type: "output-format",
          title:
            "Reglas de respuesta",
          content:
            formatList(
              this.outputRules,
            ),
          priority: "high",
        },
        this.generateId,
      ),
    );

    if (
      this.includeUserContext
    ) {
      sections.push(
        createPromptSection(
          {
            id: "user-context",
            type: "user",
            title:
              "Contexto del usuario",
            content:
              buildUserContextContent(
                request.context,
              ),
            priority: "high",
          },
          this.generateId,
        ),
      );

      sections.push(
        createPromptSection(
          {
            id: "application-context",
            type: "context",
            title:
              "Contexto de la aplicación",
            content:
              buildApplicationContextContent(
                request.context,
              ),
            priority: "normal",
          },
          this.generateId,
        ),
      );
    }

    if (
      this.includeBusinessContext
    ) {
      const businessContent =
        buildBusinessContextContent(
          request.context,
        );

      if (
        businessContent !== null
      ) {
        sections.push(
          createPromptSection(
            {
              id: "business-context",
              type: "business",
              title:
                "Contexto empresarial",
              content:
                businessContent,
              priority: "high",
            },
            this.generateId,
          ),
        );
      }
    }

    if (
      this.includeContextSections
    ) {
      const contextSections =
        [...request.context.sections]
          .sort(
            (
              left,
              right,
            ) =>
              PRIORITY_WEIGHT[
                right.priority
              ] -
              PRIORITY_WEIGHT[
                left.priority
              ],
          )
          .slice(
            0,
            this.maximumContextSections,
          );

      for (
        const contextSection of
        contextSections
      ) {
        const truncated =
          truncateText(
            buildContextSectionContent(
              contextSection,
            ),
            this.maximumSectionCharacters,
          );

        sections.push(
          createPromptSection(
            {
              id:
                `context-${contextSection.id}`,
              type: "context",
              title:
                contextSection.title,
              content:
                truncated.content,
              priority:
                contextSection.priority,
              metadata: {
                domain:
                  contextSection.domain,
                source:
                  contextSection.source ??
                  "No disponible",
                truncated:
                  truncated.truncated,
              },
            },
            this.generateId,
          ),
        );
      }
    }

    if (
      this.includeMemory &&
      request.memory !== undefined &&
      request.memory.length > 0
    ) {
      const memories =
        sortMemoryEntries(
          request.memory,
        ).slice(
          0,
          this.maximumMemoryEntries,
        );

      const memoryContent =
        truncateText(
          buildMemoryContent(
            memories,
          ),
          this.maximumSectionCharacters,
        );

      sections.push(
        createPromptSection(
          {
            id: "memory",
            type: "memory",
            title:
              "Memoria relevante",
            content:
              memoryContent.content,
            priority: "normal",
            metadata: {
              memoryCount:
                memories.length,
              truncated:
                memoryContent.truncated,
            },
          },
          this.generateId,
        ),
      );
    }

    if (
      this.includeKnowledge &&
      request.documents !==
        undefined &&
      request.documents.length > 0
    ) {
      const documents =
        sortDocuments(
          request.documents,
        ).slice(
          0,
          this.maximumDocuments,
        );

      const knowledgeContent =
        truncateText(
          buildKnowledgeContent(
            documents,
          ),
          this.maximumSectionCharacters,
        );

      sections.push(
        createPromptSection(
          {
            id: "knowledge",
            type: "knowledge",
            title:
              "Conocimiento recuperado",
            content:
              knowledgeContent.content,
            priority: "high",
            metadata: {
              documentCount:
                documents.length,
              truncated:
                knowledgeContent.truncated,
            },
          },
          this.generateId,
        ),
      );
    }

    if (
      this.includeExecutionPlan &&
      request.plan !== undefined
    ) {
      const planContent =
        truncateText(
          buildExecutionPlanContent(
            request.plan,
          ),
          this.maximumSectionCharacters,
        );

      sections.push(
        createPromptSection(
          {
            id: "execution-plan",
            type: "tools",
            title:
              "Plan interno de ejecución",
            content:
              planContent.content,
            priority: "normal",
            metadata: {
              planId:
                request.plan.id,
              truncated:
                planContent.truncated,
            },
          },
          this.generateId,
        ),
      );
    }

    sections.push(
      createPromptSection(
        {
          id: "current-user-request",
          type: "user",
          title:
            "Solicitud actual",
          content:
            buildUserRequestContent(
              request.userMessage,
            ),
          priority: "critical",
        },
        this.generateId,
      ),
    );

    return freezePromptSections(
      sections,
    );
  }

  private prepareHistory(
    history: readonly AIMessage[],
  ): readonly AIMessage[] {
    const usableMessages =
      history.filter(
        (message) =>
          message.status ===
            "completed" &&
          message.content.trim().length >
            0 &&
          message.role !== "system" &&
          message.role !==
            "developer",
      );

    return Object.freeze(
      usableMessages
        .slice(
          -this.maximumHistoryMessages,
        )
        .map(cloneMessage),
    );
  }

  private buildOutputMessages(
    history: readonly AIMessage[],
    userMessage: AIMessage,
  ): readonly AIMessage[] {
    const userAlreadyIncluded =
      history.some(
        (message) =>
          message.id ===
          userMessage.id,
      );

    const messages = [
      ...history,
    ];

    if (!userAlreadyIncluded) {
      messages.push(
        cloneMessage(
          userMessage,
        ),
      );
    }

    return Object.freeze(
      messages,
    );
  }

  private estimateMessageTokens(
    messages: readonly AIMessage[],
  ): AITokenCount {
    return messages.reduce(
      (
        total,
        message,
      ) =>
        total +
        this.estimateTokens(
          `${message.role}: ${message.content}`,
        ),
      0,
    );
  }
}

/* ============================================================================
 * CONSTRUCTOR FUNCIONAL
 * ========================================================================== */

export type FunctionalPromptBuilderHandler =
  (
    request: AIPromptBuildRequest,
  ) => Promise<AIBuiltPrompt>;

export class FunctionalPromptBuilder
  implements AIPromptBuilder
{
  private readonly handler:
    FunctionalPromptBuilderHandler;

  public constructor(
    handler:
      FunctionalPromptBuilderHandler,
  ) {
    this.handler = handler;
  }

  public build(
    request: AIPromptBuildRequest,
  ): Promise<AIBuiltPrompt> {
    return this.handler(request);
  }
}

/* ============================================================================
 * FACTORÍAS PÚBLICAS
 * ========================================================================== */

export function createDefaultPromptBuilder(
  config: PromptBuilderConfig = {},
): DefaultPromptBuilder {
  return new DefaultPromptBuilder(
    config,
  );
}

export function createFunctionalPromptBuilder(
  handler:
    FunctionalPromptBuilderHandler,
): FunctionalPromptBuilder {
  return new FunctionalPromptBuilder(
    handler,
  );
}

export function estimatePromptTokens(
  text: string,
): AITokenCount {
  return defaultEstimateTokens(
    text,
  );
}