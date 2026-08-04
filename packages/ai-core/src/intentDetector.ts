/**
 * @package @gano-bot/ai-core
 * @file intentDetector.ts
 * @version 0.2.0
 *
 * Detector de intenciones para GANO_BOT.
 *
 * Responsabilidades:
 * - Analizar el mensaje actual del usuario.
 * - Detectar la intención principal.
 * - Generar intenciones alternativas.
 * - Extraer entidades básicas.
 * - Determinar si se requieren:
 *   - datos empresariales;
 *   - recuperación de conocimiento;
 *   - herramientas externas.
 * - Detectar el idioma principal.
 * - Permitir reglas personalizadas.
 * - Permitir detectores personalizados.
 *
 * Este módulo no depende directamente de:
 * - Firebase;
 * - React;
 * - Zustand;
 * - OpenAI;
 * - Gemini;
 * - Firestore.
 *
 * El detector predeterminado funciona mediante reglas ponderadas,
 * por lo que puede utilizarse sin conexión a un modelo de lenguaje.
 */

import type {
  AIConfidence,
  AIContext,
  AIIdentifier,
  AIIntentCandidate,
  AIIntentDetection,
  AIIntentDetectionRequest,
  AIIntentDetector,
  AIIntentEntity,
  AIIntentName,
  AIMessage,
  AIMetadata,
} from "./types.js";

import {
  EMPTY_AI_METADATA,
} from "./types.js";

/* ============================================================================
 * TIPOS PÚBLICOS
 * ========================================================================== */

/**
 * Patrón de coincidencia textual de una regla.
 */
export interface AIIntentPattern {
  /**
   * Texto o expresión regular que debe buscarse.
   */
  readonly value: string | RegExp;

  /**
   * Peso agregado cuando el patrón coincide.
   */
  readonly weight?: number;

  /**
   * Razón descriptiva agregada al resultado.
   */
  readonly reason?: string;

  /**
   * Permite indicar que el patrón debe coincidir con una palabra
   * o frase completa.
   *
   * Solo se utiliza cuando value es string.
   */
  readonly exact?: boolean;
}

/**
 * Regla utilizada para calcular una intención.
 */
export interface AIIntentRule {
  readonly id: AIIdentifier;
  readonly intent: AIIntentName;

  /**
   * Patrones positivos que aumentan la puntuación.
   */
  readonly patterns: readonly AIIntentPattern[];

  /**
   * Patrones que reducen la puntuación.
   */
  readonly negativePatterns?: readonly AIIntentPattern[];

  /**
   * Peso base de la regla.
   */
  readonly baseWeight?: number;

  /**
   * Confianza mínima necesaria para conservar la intención.
   */
  readonly minimumConfidence?: AIConfidence;

  /**
   * Indica si la intención requiere datos personales o empresariales.
   */
  readonly requiresBusinessData?: boolean;

  /**
   * Indica si se deben recuperar documentos o conocimiento.
   */
  readonly requiresKnowledgeRetrieval?: boolean;

  /**
   * Indica si pueden ser necesarias herramientas.
   */
  readonly requiresTools?: boolean;

  /**
   * Habilita o deshabilita la regla.
   */
  readonly enabled?: boolean;

  readonly metadata?: AIMetadata;
}

/**
 * Patrón para extraer una entidad.
 */
export interface AIEntityPattern {
  readonly name: string;
  readonly pattern: RegExp;
  readonly confidence?: AIConfidence;

  /**
   * Grupo de captura que contiene el valor.
   *
   * Por defecto se utiliza el grupo 1.
   */
  readonly valueGroup?: number;

  /**
   * Normalizador personalizado.
   */
  readonly normalize?: (
    value: string,
  ) => string;

  readonly metadata?: AIMetadata;
}

/**
 * Configuración del detector predeterminado.
 */
export interface IntentDetectorConfig {
  /**
   * Reglas adicionales.
   */
  readonly rules?: readonly AIIntentRule[];

  /**
   * Cuando es true, las reglas personalizadas reemplazan las
   * predeterminadas que tengan el mismo identificador.
   */
  readonly replaceRulesWithSameId?: boolean;

  /**
   * Patrones adicionales para entidades.
   */
  readonly entityPatterns?: readonly AIEntityPattern[];

  /**
   * Confianza mínima general.
   */
  readonly minimumConfidence?: AIConfidence;

  /**
   * Cantidad máxima de intenciones alternativas.
   */
  readonly maximumAlternatives?: number;

  /**
   * Intención utilizada cuando ninguna regla supera el mínimo.
   */
  readonly fallbackIntent?: AIIntentName;

  /**
   * Permite analizar el historial reciente.
   */
  readonly includeHistory?: boolean;

  /**
   * Máximo de mensajes históricos analizados.
   */
  readonly maximumHistoryMessages?: number;

  /**
   * Peso relativo del historial frente al mensaje actual.
   */
  readonly historyWeight?: number;

  /**
   * Permite usar el contexto empresarial para mejorar el resultado.
   */
  readonly includeContextSignals?: boolean;

  /**
   * Detector de idioma reemplazable.
   */
  readonly detectLanguage?: (
    text: string,
  ) => string | undefined;
}

/**
 * Detalle interno y público de una coincidencia.
 */
export interface AIIntentRuleMatch {
  readonly ruleId: AIIdentifier;
  readonly intent: AIIntentName;
  readonly score: number;
  readonly matchedPatterns: readonly string[];
  readonly reasons: readonly string[];
  readonly requiresBusinessData: boolean;
  readonly requiresKnowledgeRetrieval: boolean;
  readonly requiresTools: boolean;
}

/**
 * Resultado extendido de análisis.
 */
export interface AIIntentAnalysis {
  readonly detection: AIIntentDetection;
  readonly matches: readonly AIIntentRuleMatch[];
  readonly normalizedText: string;
}

/**
 * Handler utilizado por el detector funcional.
 */
export type FunctionalIntentDetectorHandler =
  (
    request: AIIntentDetectionRequest,
  ) => Promise<AIIntentDetection>;

/* ============================================================================
 * CONSTANTES
 * ========================================================================== */

export const INTENT_DETECTOR_VERSION =
  1 as const;

export const DEFAULT_INTENT_MINIMUM_CONFIDENCE =
  0.2;

export const DEFAULT_INTENT_MAXIMUM_ALTERNATIVES =
  3;

export const DEFAULT_INTENT_MAXIMUM_HISTORY_MESSAGES =
  6;

export const DEFAULT_INTENT_HISTORY_WEIGHT =
  0.2;

export const DEFAULT_INTENT_FALLBACK:
  AIIntentName = "unknown";

const MINIMUM_CONFIDENCE =
  0;

const MAXIMUM_CONFIDENCE =
  1;

/* ============================================================================
 * UTILIDADES INTERNAS
 * ========================================================================== */

function clamp(
  value: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }

  return Math.min(
    maximum,
    Math.max(minimum, value),
  );
}

function clampConfidence(
  value: number,
): AIConfidence {
  return clamp(
    value,
    MINIMUM_CONFIDENCE,
    MAXIMUM_CONFIDENCE,
  );
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

function normalizeText(
  value: string,
): string {
  return value
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      "",
    )
    .toLocaleLowerCase()
    .replace(/\r\n/g, "\n")
    .replace(/[^\p{L}\p{N}%$€.,+\-_/¿?¡!\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEntityValue(
  value: string,
): string {
  return value
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegularExpression(
  value: string,
): string {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
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

function getPatternDescription(
  pattern: string | RegExp,
): string {
  return typeof pattern === "string"
    ? pattern
    : pattern.toString();
}

function createPatternExpression(
  pattern: AIIntentPattern,
): RegExp {
  if (pattern.value instanceof RegExp) {
    const flags =
      pattern.value.flags.includes("i")
        ? pattern.value.flags
        : `${pattern.value.flags}i`;

    return new RegExp(
      pattern.value.source,
      flags,
    );
  }

  const escaped =
    escapeRegularExpression(
      normalizeText(pattern.value),
    );

  if (pattern.exact === true) {
    return new RegExp(
      `(?:^|\\s)${escaped}(?:$|\\s)`,
      "i",
    );
  }

  return new RegExp(
    escaped,
    "i",
  );
}

function patternMatches(
  text: string,
  pattern: AIIntentPattern,
): boolean {
  const expression =
    createPatternExpression(pattern);

  /*
   * Las expresiones globales conservan lastIndex.
   * Se restablece para garantizar resultados consistentes.
   */
  expression.lastIndex = 0;

  return expression.test(text);
}

function detectDefaultLanguage(
  text: string,
): string | undefined {
  const normalized =
    normalizeText(text);

  if (normalized.length === 0) {
    return undefined;
  }

  const spanishSignals = [
    "que",
    "como",
    "para",
    "quiero",
    "necesito",
    "cual",
    "cuanto",
    "rango",
    "ganancia",
    "producto",
    "pierna",
    "usuario",
    "ayuda",
    "hola",
    "gracias",
  ];

  const englishSignals = [
    "what",
    "how",
    "why",
    "which",
    "help",
    "rank",
    "income",
    "product",
    "user",
    "hello",
    "thanks",
    "please",
  ];

  let spanishScore = 0;
  let englishScore = 0;

  for (const signal of spanishSignals) {
    if (
      normalized.includes(
        signal,
      )
    ) {
      spanishScore += 1;
    }
  }

  for (const signal of englishSignals) {
    if (
      normalized.includes(
        signal,
      )
    ) {
      englishScore += 1;
    }
  }

  if (
    spanishScore === 0 &&
    englishScore === 0
  ) {
    return undefined;
  }

  return spanishScore >= englishScore
    ? "es"
    : "en";
}

function hasBusinessContext(
  context: AIContext | undefined,
): boolean {
  if (context?.business === undefined) {
    return false;
  }

  return (
    Object.keys(
      context.business,
    ).length > 0
  );
}

function hasContextDomain(
  context: AIContext | undefined,
  domains: readonly string[],
): boolean {
  if (context === undefined) {
    return false;
  }

  return context.sections.some(
    (section) =>
      domains.includes(
        section.domain,
      ),
  );
}

function validateMessage(
  message: AIMessage,
): void {
  if (
    message.content.trim().length ===
    0
  ) {
    throw new Error(
      "No se puede detectar una intención a partir de un mensaje vacío.",
    );
  }
}

function freezeEntity(
  entity: AIIntentEntity,
): AIIntentEntity {
  const frozen: AIIntentEntity = {
    name: entity.name,
    value: entity.value,
    confidence:
      clampConfidence(
        entity.confidence,
      ),
    ...(entity.normalizedValue !==
    undefined
      ? {
          normalizedValue:
            entity.normalizedValue,
        }
      : {}),
    ...(entity.metadata !== undefined
      ? {
          metadata:
            freezeMetadata(
              entity.metadata,
            ),
        }
      : {}),
  };

  return Object.freeze(frozen);
}

function freezeCandidate(
  candidate: AIIntentCandidate,
): AIIntentCandidate {
  const frozen: AIIntentCandidate = {
    name: candidate.name,
    confidence:
      clampConfidence(
        candidate.confidence,
      ),
    ...(candidate.reason !== undefined
      ? {
          reason:
            candidate.reason,
        }
      : {}),
  };

  return Object.freeze(frozen);
}

function freezeDetection(
  detection: AIIntentDetection,
): AIIntentDetection {
  const frozen: AIIntentDetection = {
    primary:
      freezeCandidate(
        detection.primary,
      ),
    alternatives:
      Object.freeze(
        detection.alternatives.map(
          freezeCandidate,
        ),
      ),
    entities:
      Object.freeze(
        detection.entities.map(
          freezeEntity,
        ),
      ),
    requiresBusinessData:
      detection.requiresBusinessData,
    requiresKnowledgeRetrieval:
      detection.requiresKnowledgeRetrieval,
    requiresTools:
      detection.requiresTools,
    ...(detection.language !== undefined
      ? {
          language:
            detection.language,
        }
      : {}),
    ...(detection.metadata !== undefined
      ? {
          metadata:
            freezeMetadata(
              detection.metadata,
            ),
        }
      : {}),
  };

  return Object.freeze(frozen);
}

/* ============================================================================
 * REGLAS PREDETERMINADAS
 * ========================================================================== */

export const DEFAULT_INTENT_RULES:
  readonly AIIntentRule[] =
  Object.freeze([
    {
      id: "greeting",
      intent: "greeting",
      baseWeight: 0.05,
      minimumConfidence: 0.25,
      patterns: [
        {
          value: "hola",
          weight: 0.8,
          exact: true,
          reason:
            "El usuario inició con un saludo.",
        },
        {
          value: "buenos dias",
          weight: 0.9,
        },
        {
          value: "buenas tardes",
          weight: 0.9,
        },
        {
          value: "buenas noches",
          weight: 0.9,
        },
        {
          value: "hey",
          weight: 0.7,
          exact: true,
        },
        {
          value: "hello",
          weight: 0.8,
          exact: true,
        },
      ],
    },

    {
      id: "help",
      intent: "help",
      baseWeight: 0.05,
      minimumConfidence: 0.25,
      patterns: [
        {
          value: "ayuda",
          weight: 0.8,
          reason:
            "El usuario solicitó ayuda.",
        },
        {
          value: "que puedes hacer",
          weight: 0.9,
        },
        {
          value: "como funciona",
          weight: 0.6,
        },
        {
          value: "help",
          weight: 0.8,
          exact: true,
        },
      ],
    },

    {
      id: "business-summary",
      intent: "business_summary",
      baseWeight: 0.05,
      requiresBusinessData: true,
      patterns: [
        {
          value: "resumen de mi negocio",
          weight: 1,
          reason:
            "Se solicitó un resumen empresarial.",
        },
        {
          value: "como va mi negocio",
          weight: 0.9,
        },
        {
          value: "estado de mi negocio",
          weight: 0.9,
        },
        {
          value: "resumen empresarial",
          weight: 0.9,
        },
        {
          value: "mis metricas",
          weight: 0.7,
        },
        {
          value: "mi rendimiento",
          weight: 0.7,
        },
      ],
    },

    {
      id: "rank-progress",
      intent: "rank_progress",
      baseWeight: 0.05,
      requiresBusinessData: true,
      requiresKnowledgeRetrieval: true,
      patterns: [
        {
          value: "que me falta para",
          weight: 0.9,
          reason:
            "La consulta solicita calcular progreso hacia un objetivo.",
        },
        {
          value: "cuanto me falta",
          weight: 0.8,
        },
        {
          value: "progreso de rango",
          weight: 1,
        },
        {
          value: "subir de rango",
          weight: 0.8,
        },
        {
          value: "alcanzar el rango",
          weight: 0.8,
        },
        {
          value:
            /\b(?:llegar|subir|avanzar|calificar)\b.*\b(?:rango|plata|oro|platino|diamante)\b/i,
          weight: 0.9,
        },
      ],
    },

    {
      id: "rank-requirements",
      intent: "rank_requirements",
      baseWeight: 0.05,
      requiresKnowledgeRetrieval: true,
      patterns: [
        {
          value: "requisitos de rango",
          weight: 1,
          reason:
            "La consulta solicita requisitos formales de rango.",
        },
        {
          value: "requisitos para ser",
          weight: 0.9,
        },
        {
          value: "como califico a",
          weight: 0.9,
        },
        {
          value: "cuantos puntos necesito",
          weight: 0.8,
        },
        {
          value:
            /\b(?:requisitos?|condiciones?|necesito)\b.*\b(?:plata|oro|platino|diamante|rango)\b/i,
          weight: 0.9,
        },
      ],
    },

    {
      id: "income-estimation",
      intent: "income_estimation",
      baseWeight: 0.05,
      requiresBusinessData: true,
      patterns: [
        {
          value: "cuanto voy a ganar",
          weight: 1,
          reason:
            "El usuario solicita una estimación de ingresos.",
        },
        {
          value: "cuanto ganaria",
          weight: 1,
        },
        {
          value: "simular ingresos",
          weight: 0.9,
        },
        {
          value: "simulador de ingresos",
          weight: 0.9,
        },
        {
          value: "ganancia estimada",
          weight: 0.9,
        },
        {
          value: "comision estimada",
          weight: 0.8,
        },
        {
          value:
            /\b(?:calcula|calcular|estima|estimar|simula|simular)\b.*\b(?:ingreso|ganancia|comision|pago)\b/i,
          weight: 0.95,
        },
      ],
    },

    {
      id: "binary-analysis",
      intent: "binary_analysis",
      baseWeight: 0.05,
      requiresBusinessData: true,
      requiresKnowledgeRetrieval: true,
      patterns: [
        {
          value: "analiza mi binario",
          weight: 1,
          reason:
            "La consulta solicita análisis del sistema binario.",
        },
        {
          value: "pierna debil",
          weight: 0.8,
        },
        {
          value: "pierna fuerte",
          weight: 0.7,
        },
        {
          value: "banco binario",
          weight: 0.9,
        },
        {
          value: "volumen binario",
          weight: 0.9,
        },
        {
          value: "bono binario",
          weight: 0.9,
        },
        {
          value:
            /\b(?:izquierda|derecha|pierna|rama)\b.*\b(?:volumen|banco|binario)\b/i,
          weight: 0.85,
        },
      ],
    },

    {
      id: "organization-analysis",
      intent: "organization_analysis",
      baseWeight: 0.05,
      requiresBusinessData: true,
      patterns: [
        {
          value: "analiza mi organizacion",
          weight: 1,
          reason:
            "La consulta solicita análisis organizacional.",
        },
        {
          value: "arbol organizacional",
          weight: 0.9,
        },
        {
          value: "mi red",
          weight: 0.6,
        },
        {
          value: "mi equipo",
          weight: 0.6,
        },
        {
          value: "estructura de mi red",
          weight: 0.9,
        },
        {
          value: "distribuidores de mi red",
          weight: 0.8,
        },
        {
          value:
            /\b(?:analiza|revisa|evalua)\b.*\b(?:organizacion|red|equipo|arbol)\b/i,
          weight: 0.9,
        },
      ],
    },

    {
      id: "qualification-status",
      intent: "qualification_status",
      baseWeight: 0.05,
      requiresBusinessData: true,
      requiresKnowledgeRetrieval: true,
      patterns: [
        {
          value: "estoy calificado",
          weight: 1,
          reason:
            "El usuario consulta su estado de calificación.",
        },
        {
          value: "estado de calificacion",
          weight: 1,
        },
        {
          value: "calificacion del ciclo",
          weight: 0.9,
        },
        {
          value: "sigo activo",
          weight: 0.7,
        },
        {
          value: "estoy activo",
          weight: 0.7,
        },
        {
          value:
            /\b(?:calificado|calificacion|activo|actividad)\b.*\b(?:ciclo|actual|semana)\b/i,
          weight: 0.85,
        },
      ],
    },

    {
      id: "product-information",
      intent: "product_information",
      baseWeight: 0.05,
      requiresKnowledgeRetrieval: true,
      patterns: [
        {
          value: "informacion del producto",
          weight: 0.9,
          reason:
            "La consulta solicita información de producto.",
        },
        {
          value: "ingredientes",
          weight: 0.7,
        },
        {
          value: "modo de uso",
          weight: 0.7,
        },
        {
          value: "como se toma",
          weight: 0.7,
        },
        {
          value: "presentacion",
          weight: 0.5,
        },
        {
          value: "registro sanitario",
          weight: 0.9,
        },
        {
          value: "precio del producto",
          weight: 0.7,
        },
        {
          value:
            /\b(?:producto|capsulas|cafe|ganoderma)\b.*\b(?:ingredientes|precio|uso|tomar|preparar|beneficio|presentacion)\b/i,
          weight: 0.85,
        },
      ],
    },

    {
      id: "wellness-information",
      intent: "wellness_information",
      baseWeight: 0.05,
      requiresKnowledgeRetrieval: true,
      patterns: [
        {
          value: "bienestar",
          weight: 0.5,
        },
        {
          value: "salud",
          weight: 0.5,
        },
        {
          value: "rutina de bienestar",
          weight: 0.9,
          reason:
            "La consulta solicita orientación de bienestar.",
        },
        {
          value: "contraindicaciones",
          weight: 0.8,
        },
        {
          value: "alergenos",
          weight: 0.7,
        },
        {
          value: "puedo tomar",
          weight: 0.7,
        },
        {
          value:
            /\b(?:enfermedad|patologia|sintoma|salud|bienestar)\b.*\b(?:producto|ganoderma|capsulas|cafe)\b/i,
          weight: 0.85,
        },
      ],
    },

    {
      id: "educational-content",
      intent: "educational_content",
      baseWeight: 0.05,
      requiresKnowledgeRetrieval: true,
      patterns: [
        {
          value: "quiero aprender",
          weight: 0.7,
          reason:
            "La consulta tiene un propósito educativo.",
        },
        {
          value: "explicame",
          weight: 0.5,
        },
        {
          value: "que es multinivel",
          weight: 0.9,
        },
        {
          value: "como funciona el multinivel",
          weight: 0.9,
        },
        {
          value: "capacitacion",
          weight: 0.7,
        },
        {
          value: "academia",
          weight: 0.6,
        },
      ],
    },

    {
      id: "legal-information",
      intent: "legal_information",
      baseWeight: 0.05,
      requiresKnowledgeRetrieval: true,
      patterns: [
        {
          value: "legalidad",
          weight: 0.8,
          reason:
            "La consulta solicita información legal.",
        },
        {
          value: "es legal",
          weight: 0.9,
        },
        {
          value: "normativa",
          weight: 0.8,
        },
        {
          value: "ley",
          weight: 0.6,
          exact: true,
        },
        {
          value: "regulacion",
          weight: 0.7,
        },
        {
          value: "politica de la empresa",
          weight: 0.8,
        },
        {
          value: "terminos y condiciones",
          weight: 0.9,
        },
      ],
    },

    {
      id: "mission-recommendation",
      intent: "mission_recommendation",
      baseWeight: 0.05,
      requiresBusinessData: true,
      patterns: [
        {
          value: "que mision debo hacer",
          weight: 1,
          reason:
            "El usuario solicita una misión recomendada.",
        },
        {
          value: "misiones recomendadas",
          weight: 0.9,
        },
        {
          value: "mi siguiente mision",
          weight: 0.9,
        },
        {
          value: "mision activa",
          weight: 0.7,
        },
      ],
    },

    {
      id: "next-best-action",
      intent: "next_best_action",
      baseWeight: 0.05,
      requiresBusinessData: true,
      patterns: [
        {
          value: "que debo hacer ahora",
          weight: 1,
          reason:
            "El usuario solicita una siguiente acción.",
        },
        {
          value: "cual es el siguiente paso",
          weight: 1,
        },
        {
          value: "que me recomiendas hacer",
          weight: 0.9,
        },
        {
          value: "siguiente mejor accion",
          weight: 1,
        },
        {
          value: "prioridad de hoy",
          weight: 0.8,
        },
      ],
    },

    {
      id: "document-search",
      intent: "document_search",
      baseWeight: 0.05,
      requiresKnowledgeRetrieval: true,
      patterns: [
        {
          value: "busca en los documentos",
          weight: 1,
          reason:
            "El usuario solicita búsqueda documental.",
        },
        {
          value: "revisa el documento",
          weight: 0.9,
        },
        {
          value: "segun el pdf",
          weight: 0.9,
        },
        {
          value: "segun el manual",
          weight: 0.8,
        },
        {
          value: "encuentra en el archivo",
          weight: 0.9,
        },
        {
          value:
            /\b(?:busca|revisa|encuentra|consulta)\b.*\b(?:documento|pdf|archivo|manual|base de conocimiento)\b/i,
          weight: 0.95,
        },
      ],
    },

    {
      id: "conversation-summary",
      intent: "conversation_summary",
      baseWeight: 0.05,
      patterns: [
        {
          value: "resume la conversacion",
          weight: 1,
          reason:
            "El usuario solicita resumir la conversación.",
        },
        {
          value: "resumen de lo hablado",
          weight: 0.9,
        },
        {
          value: "que hemos hecho",
          weight: 0.8,
        },
        {
          value: "recapitula",
          weight: 0.8,
        },
      ],
    },

    {
      id: "tool-request",
      intent: "tool_request",
      baseWeight: 0.05,
      requiresTools: true,
      patterns: [
        {
          value: "ejecuta",
          weight: 0.6,
        },
        {
          value: "crea el archivo",
          weight: 0.8,
        },
        {
          value: "genera el archivo",
          weight: 0.8,
        },
        {
          value: "guarda",
          weight: 0.5,
        },
        {
          value: "envia",
          weight: 0.5,
        },
        {
          value: "actualiza firebase",
          weight: 0.9,
        },
        {
          value: "consulta firestore",
          weight: 0.9,
        },
        {
          value:
            /\b(?:ejecuta|genera|crea|guarda|actualiza|elimina|envia)\b.*\b(?:archivo|firebase|firestore|correo|evento|registro)\b/i,
          weight: 0.9,
        },
      ],
    },

    {
      id: "general-question",
      intent: "general_question",
      baseWeight: 0.05,
      minimumConfidence: 0.1,
      patterns: [
        {
          value:
            /^(?:que|como|cuando|donde|por que|para que|cual|cuales|quien|quienes|puedes|podrias)\b/i,
          weight: 0.35,
          reason:
            "El mensaje tiene estructura de pregunta general.",
        },
        {
          value: "?",
          weight: 0.15,
        },
        {
          value: "explica",
          weight: 0.25,
        },
        {
          value: "dime",
          weight: 0.2,
        },
      ],
    },
  ]);

/* ============================================================================
 * PATRONES DE ENTIDADES PREDETERMINADOS
 * ========================================================================== */

export const DEFAULT_ENTITY_PATTERNS:
  readonly AIEntityPattern[] =
  Object.freeze([
    {
      name: "rank",
      pattern:
        /\b(plata|oro|platino|diamante|ejecutivo|master|presidencial)\b/gi,
      confidence: 0.9,
      normalize: (
        value,
      ) =>
        normalizeEntityValue(
          value,
        ).toLocaleLowerCase(),
    },
    {
      name: "package",
      pattern:
        /\b(esp\s*1|esp\s*2|esp\s*3|ci)\b/gi,
      confidence: 0.95,
      normalize: (
        value,
      ) =>
        normalizeEntityValue(
          value,
        )
          .replace(/\s+/g, "")
          .toLocaleUpperCase(),
    },
    {
      name: "volume",
      pattern:
        /\b(\d+(?:[.,]\d+)?)\s*(pv|cv|gcv)\b/gi,
      confidence: 0.95,
      normalize: (
        value,
      ) =>
        normalizeEntityValue(
          value,
        )
          .replace(",", ".")
          .toLocaleUpperCase(),
    },
    {
      name: "percentage",
      pattern:
        /\b(\d+(?:[.,]\d+)?)\s*%\b/g,
      confidence: 0.95,
      normalize: (
        value,
      ) =>
        normalizeEntityValue(
          value,
        ).replace(",", "."),
    },
    {
      name: "money",
      pattern:
        /(?:\$|€)\s*(\d+(?:[.,]\d+)?)/g,
      confidence: 0.9,
      normalize: (
        value,
      ) =>
        normalizeEntityValue(
          value,
        ).replace(",", "."),
    },
    {
      name: "cycle",
      pattern:
        /\b(?:ciclo)\s+([a-z0-9_-]+)\b/gi,
      confidence: 0.85,
      normalize:
        normalizeEntityValue,
    },
    {
      name: "leg",
      pattern:
        /\b(pierna|rama)\s+(izquierda|derecha|debil|fuerte)\b/gi,
      confidence: 0.9,
      normalize: (
        value,
      ) =>
        normalizeEntityValue(
          value,
        ).toLocaleLowerCase(),
    },
    {
      name: "document_type",
      pattern:
        /\b(pdf|manual|documento|archivo|etiqueta|plan de compensacion)\b/gi,
      confidence: 0.8,
      normalize: (
        value,
      ) =>
        normalizeEntityValue(
          value,
        ).toLocaleLowerCase(),
    },
  ]);

/* ============================================================================
 * EVALUACIÓN DE REGLAS
 * ========================================================================== */

function evaluateRule(
  rule: AIIntentRule,
  currentText: string,
  historyText: string,
  historyWeight: number,
): AIIntentRuleMatch | null {
  if (rule.enabled === false) {
    return null;
  }

  let score =
    rule.baseWeight ?? 0;

  const matchedPatterns:
    string[] = [];

  const reasons:
    string[] = [];

  for (const pattern of rule.patterns) {
    const weight =
      pattern.weight ?? 0.5;

    if (
      patternMatches(
        currentText,
        pattern,
      )
    ) {
      score += weight;

      matchedPatterns.push(
        getPatternDescription(
          pattern.value,
        ),
      );

      if (pattern.reason !== undefined) {
        reasons.push(
          pattern.reason,
        );
      }

      continue;
    }

    if (
      historyText.length > 0 &&
      patternMatches(
        historyText,
        pattern,
      )
    ) {
      score +=
        weight *
        historyWeight;

      matchedPatterns.push(
        `${getPatternDescription(
          pattern.value,
        )} [historial]`,
      );

      reasons.push(
        `La intención también aparece relacionada con el historial reciente.`,
      );
    }
  }

  for (
    const negativePattern of
    rule.negativePatterns ?? []
  ) {
    if (
      patternMatches(
        currentText,
        negativePattern,
      )
    ) {
      score -=
        negativePattern.weight ??
        0.5;
    }
  }

  if (matchedPatterns.length === 0) {
    return null;
  }

  const normalizedScore =
    clampConfidence(score);

  const minimumConfidence =
    rule.minimumConfidence ??
    0;

  if (
    normalizedScore <
    minimumConfidence
  ) {
    return null;
  }

  return Object.freeze({
    ruleId: rule.id,
    intent: rule.intent,
    score:
      normalizedScore,
    matchedPatterns:
      Object.freeze([
        ...matchedPatterns,
      ]),
    reasons:
      Object.freeze([
        ...new Set(reasons),
      ]),
    requiresBusinessData:
      rule.requiresBusinessData ??
      false,
    requiresKnowledgeRetrieval:
      rule.requiresKnowledgeRetrieval ??
      false,
    requiresTools:
      rule.requiresTools ??
      false,
  });
}

function mergeIntentMatches(
  matches:
    readonly AIIntentRuleMatch[],
): readonly AIIntentRuleMatch[] {
  const merged =
    new Map<
      AIIntentName,
      AIIntentRuleMatch
    >();

  for (const match of matches) {
    const existing =
      merged.get(match.intent);

    if (existing === undefined) {
      merged.set(
        match.intent,
        match,
      );

      continue;
    }

    const combinedScore =
      clampConfidence(
        existing.score +
          match.score * 0.5,
      );

    merged.set(
      match.intent,
      Object.freeze({
        ruleId:
          `${existing.ruleId}+${match.ruleId}`,
        intent:
          match.intent,
        score:
          combinedScore,
        matchedPatterns:
          Object.freeze([
            ...new Set([
              ...existing.matchedPatterns,
              ...match.matchedPatterns,
            ]),
          ]),
        reasons:
          Object.freeze([
            ...new Set([
              ...existing.reasons,
              ...match.reasons,
            ]),
          ]),
        requiresBusinessData:
          existing.requiresBusinessData ||
          match.requiresBusinessData,
        requiresKnowledgeRetrieval:
          existing.requiresKnowledgeRetrieval ||
          match.requiresKnowledgeRetrieval,
        requiresTools:
          existing.requiresTools ||
          match.requiresTools,
      }),
    );
  }

  return Object.freeze(
    [...merged.values()].sort(
      (
        left,
        right,
      ) =>
        right.score -
        left.score,
    ),
  );
}

function createCandidateFromMatch(
  match: AIIntentRuleMatch,
): AIIntentCandidate {
  const reason =
    match.reasons.length > 0
      ? match.reasons.join(" ")
      : `Se detectaron ${match.matchedPatterns.length} coincidencias para la intención "${match.intent}".`;

  return freezeCandidate({
    name: match.intent,
    confidence:
      match.score,
    reason,
  });
}

/* ============================================================================
 * EXTRACCIÓN DE ENTIDADES
 * ========================================================================== */

export function extractIntentEntities(
  text: string,
  patterns:
    readonly AIEntityPattern[] =
    DEFAULT_ENTITY_PATTERNS,
): readonly AIIntentEntity[] {
  const entities:
    AIIntentEntity[] = [];

  const seen =
    new Set<string>();

  for (const definition of patterns) {
    /*
     * Se crea una nueva expresión para evitar alterar lastIndex
     * en la expresión original.
     */
    const flags =
      definition.pattern.flags.includes(
        "g",
      )
        ? definition.pattern.flags
        : `${definition.pattern.flags}g`;

    const expression =
      new RegExp(
        definition.pattern.source,
        flags,
      );

    let match:
      RegExpExecArray | null;

    while (
      (
        match =
          expression.exec(text)
      ) !== null
    ) {
      const valueGroup =
        definition.valueGroup ??
        1;

      const rawValue =
        match[valueGroup] ??
        match[0];

      const value =
        normalizeEntityValue(
          rawValue,
        );

      if (value.length === 0) {
        if (match[0].length === 0) {
          expression.lastIndex += 1;
        }

        continue;
      }

      const normalizedValue =
        definition.normalize !==
        undefined
          ? definition.normalize(
              value,
            )
          : value;

      const key =
        `${definition.name}:${normalizedValue.toLocaleLowerCase()}`;

      if (!seen.has(key)) {
        seen.add(key);

        entities.push(
          freezeEntity({
            name:
              definition.name,
            value,
            normalizedValue,
            confidence:
              clampConfidence(
                definition.confidence ??
                  0.8,
              ),
            ...(definition.metadata !==
            undefined
              ? {
                  metadata:
                    definition.metadata,
                }
              : {}),
          }),
        );
      }

      if (match[0].length === 0) {
        expression.lastIndex += 1;
      }
    }
  }

  return Object.freeze(
    entities,
  );
}

/* ============================================================================
 * DETECTOR PRINCIPAL
 * ========================================================================== */

export class DefaultIntentDetector
  implements AIIntentDetector
{
  private readonly rules:
    readonly AIIntentRule[];

  private readonly entityPatterns:
    readonly AIEntityPattern[];

  private readonly minimumConfidence:
    AIConfidence;

  private readonly maximumAlternatives:
    number;

  private readonly fallbackIntent:
    AIIntentName;

  private readonly includeHistory:
    boolean;

  private readonly maximumHistoryMessages:
    number;

  private readonly historyWeight:
    number;

  private readonly includeContextSignals:
    boolean;

  private readonly languageDetector:
    (
      text: string,
    ) => string | undefined;

  public constructor(
    config: IntentDetectorConfig = {},
  ) {
    this.rules =
      this.mergeRules(
        config.rules ?? [],
        config.replaceRulesWithSameId ??
          true,
      );

    this.entityPatterns =
      Object.freeze([
        ...DEFAULT_ENTITY_PATTERNS,
        ...(config.entityPatterns ??
          []),
      ]);

    this.minimumConfidence =
      clampConfidence(
        config.minimumConfidence ??
          DEFAULT_INTENT_MINIMUM_CONFIDENCE,
      );

    this.maximumAlternatives =
      normalizePositiveInteger(
        config.maximumAlternatives,
        DEFAULT_INTENT_MAXIMUM_ALTERNATIVES,
      );

    this.fallbackIntent =
      config.fallbackIntent ??
      DEFAULT_INTENT_FALLBACK;

    this.includeHistory =
      config.includeHistory ??
      true;

    this.maximumHistoryMessages =
      normalizePositiveInteger(
        config.maximumHistoryMessages,
        DEFAULT_INTENT_MAXIMUM_HISTORY_MESSAGES,
      );

    this.historyWeight =
      clamp(
        config.historyWeight ??
          DEFAULT_INTENT_HISTORY_WEIGHT,
        0,
        1,
      );

    this.includeContextSignals =
      config.includeContextSignals ??
      true;

    this.languageDetector =
      config.detectLanguage ??
      detectDefaultLanguage;
  }

  public async detect(
    request: AIIntentDetectionRequest,
  ): Promise<AIIntentDetection> {
    const analysis =
      await this.analyze(request);

    return analysis.detection;
  }

  public async analyze(
    request: AIIntentDetectionRequest,
  ): Promise<AIIntentAnalysis> {
    if (
      request.signal?.aborted ===
      true
    ) {
      const error =
        new Error(
          "La detección de intención fue cancelada.",
        );

      error.name = "AbortError";

      throw error;
    }

    validateMessage(
      request.message,
    );

    const normalizedText =
      normalizeText(
        request.message.content,
      );

    const historyText =
      this.includeHistory
        ? this.buildHistoryText(
            request.history ?? [],
          )
        : "";

    const rawMatches =
      this.rules
        .map(
          (rule) =>
            evaluateRule(
              rule,
              normalizedText,
              historyText,
              this.historyWeight,
            ),
        )
        .filter(
          (
            match,
          ): match is AIIntentRuleMatch =>
            match !== null,
        );

    const matches =
      mergeIntentMatches(
        rawMatches,
      );

    const eligibleMatches =
      matches.filter(
        (match) =>
          match.score >=
          this.minimumConfidence,
      );

    const primaryMatch =
      eligibleMatches[0];

    const primary =
      primaryMatch !== undefined
        ? createCandidateFromMatch(
            primaryMatch,
          )
        : freezeCandidate({
            name:
              this.fallbackIntent,
            confidence:
              this.fallbackIntent ===
              "unknown"
                ? 0
                : this.minimumConfidence,
            reason:
              "No se encontraron coincidencias suficientes para determinar una intención específica.",
          });

    const alternatives =
      eligibleMatches
        .slice(
          1,
          1 +
            this.maximumAlternatives,
        )
        .map(
          createCandidateFromMatch,
        );

    const entities =
      extractIntentEntities(
        request.message.content,
        this.entityPatterns,
      );

    let requiresBusinessData =
      primaryMatch
        ?.requiresBusinessData ??
      false;

    let requiresKnowledgeRetrieval =
      primaryMatch
        ?.requiresKnowledgeRetrieval ??
      false;

    let requiresTools =
      primaryMatch
        ?.requiresTools ??
      false;

    if (
      this.includeContextSignals
    ) {
      const contextSignals =
        this.applyContextSignals(
          primary.name,
          request.context,
        );

      requiresBusinessData =
        requiresBusinessData ||
        contextSignals
          .requiresBusinessData;

      requiresKnowledgeRetrieval =
        requiresKnowledgeRetrieval ||
        contextSignals
          .requiresKnowledgeRetrieval;

      requiresTools =
        requiresTools ||
        contextSignals.requiresTools;
    }

    const language =
      this.languageDetector(
        request.message.content,
      );

    const detection =
      freezeDetection({
        primary,
        alternatives:
          Object.freeze(
            alternatives,
          ),
        entities,
        requiresBusinessData,
        requiresKnowledgeRetrieval,
        requiresTools,
        ...(language !== undefined
          ? {
              language,
            }
          : {}),
        metadata:
          Object.freeze({
            detector:
              "DefaultIntentDetector",
            detectorVersion:
              INTENT_DETECTOR_VERSION,
            matchedIntentCount:
              eligibleMatches.length,
            matchedRuleCount:
              rawMatches.length,
            analyzedHistoryMessages:
              this.includeHistory
                ? Math.min(
                    request.history
                      ?.length ?? 0,
                    this.maximumHistoryMessages,
                  )
                : 0,
            hasBusinessContext:
              hasBusinessContext(
                request.context,
              ),
          }),
      });

    return Object.freeze({
      detection,
      matches,
      normalizedText,
    });
  }

  private mergeRules(
    customRules:
      readonly AIIntentRule[],
    replaceRulesWithSameId:
      boolean,
  ): readonly AIIntentRule[] {
    if (customRules.length === 0) {
      return DEFAULT_INTENT_RULES;
    }

    if (!replaceRulesWithSameId) {
      return Object.freeze([
        ...DEFAULT_INTENT_RULES,
        ...customRules,
      ]);
    }

    const rules =
      new Map<
        AIIdentifier,
        AIIntentRule
      >();

    for (
      const rule of
      DEFAULT_INTENT_RULES
    ) {
      rules.set(
        rule.id,
        rule,
      );
    }

    for (
      const rule of
      customRules
    ) {
      rules.set(
        rule.id,
        rule,
      );
    }

    return Object.freeze([
      ...rules.values(),
    ]);
  }

  private buildHistoryText(
    history:
      readonly AIMessage[],
  ): string {
    return history
      .filter(
        (message) =>
          message.status ===
            "completed" &&
          message.content.trim().length >
            0 &&
          (
            message.role === "user" ||
            message.role ===
              "assistant"
          ),
      )
      .slice(
        -this.maximumHistoryMessages,
      )
      .map(
        (message) =>
          normalizeText(
            message.content,
          ),
      )
      .join(" ");
  }

  private applyContextSignals(
    intent: AIIntentName,
    context: AIContext | undefined,
  ): {
    readonly requiresBusinessData: boolean;
    readonly requiresKnowledgeRetrieval: boolean;
    readonly requiresTools: boolean;
  } {
    switch (intent) {
      case "business_summary":
      case "rank_progress":
      case "income_estimation":
      case "binary_analysis":
      case "organization_analysis":
      case "qualification_status":
      case "mission_recommendation":
      case "next_best_action":
        return {
          requiresBusinessData:
            !hasBusinessContext(
              context,
            ),
          requiresKnowledgeRetrieval:
            (
              intent ===
                "rank_progress" ||
              intent ===
                "binary_analysis" ||
              intent ===
                "qualification_status"
            ) &&
            !hasContextDomain(
              context,
              [
                "rank",
                "qualification",
                "business",
              ],
            ),
          requiresTools: false,
        };

      case "rank_requirements":
        return {
          requiresBusinessData: false,
          requiresKnowledgeRetrieval:
            !hasContextDomain(
              context,
              [
                "rank",
                "qualification",
              ],
            ),
          requiresTools: false,
        };

      case "product_information":
        return {
          requiresBusinessData: false,
          requiresKnowledgeRetrieval:
            !hasContextDomain(
              context,
              ["products"],
            ),
          requiresTools: false,
        };

      case "wellness_information":
        return {
          requiresBusinessData: false,
          requiresKnowledgeRetrieval:
            !hasContextDomain(
              context,
              ["wellness"],
            ),
          requiresTools: false,
        };

      case "educational_content":
        return {
          requiresBusinessData: false,
          requiresKnowledgeRetrieval:
            !hasContextDomain(
              context,
              ["education"],
            ),
          requiresTools: false,
        };

      case "legal_information":
        return {
          requiresBusinessData: false,
          requiresKnowledgeRetrieval:
            !hasContextDomain(
              context,
              ["legal"],
            ),
          requiresTools: false,
        };

      case "document_search":
        return {
          requiresBusinessData: false,
          requiresKnowledgeRetrieval:
            true,
          requiresTools: false,
        };

      case "tool_request":
        return {
          requiresBusinessData: false,
          requiresKnowledgeRetrieval:
            false,
          requiresTools: true,
        };

      default:
        return {
          requiresBusinessData: false,
          requiresKnowledgeRetrieval:
            false,
          requiresTools: false,
        };
    }
  }
}

/* ============================================================================
 * DETECTOR FUNCIONAL
 * ========================================================================== */

export class FunctionalIntentDetector
  implements AIIntentDetector
{
  private readonly handler:
    FunctionalIntentDetectorHandler;

  public constructor(
    handler:
      FunctionalIntentDetectorHandler,
  ) {
    this.handler = handler;
  }

  public async detect(
    request: AIIntentDetectionRequest,
  ): Promise<AIIntentDetection> {
    const detection =
      await this.handler(request);

    return freezeDetection(
      detection,
    );
  }
}

/* ============================================================================
 * UTILIDADES PÚBLICAS
 * ========================================================================== */

/**
 * Evalúa rápidamente un texto sin necesidad de construir manualmente
 * un AIMessage completo.
 */
export async function detectIntentFromText(
  text: string,
  options: {
    readonly detector?: AIIntentDetector;
    readonly context?: AIContext;
    readonly history?: readonly AIMessage[];
    readonly messageId?: AIIdentifier;
    readonly conversationId?: AIIdentifier;
  } = {},
): Promise<AIIntentDetection> {
  const timestamp =
    new Date().toISOString();

  const message: AIMessage = {
    id:
      options.messageId ??
      `intent_message_${Date.now().toString(36)}`,
    role: "user",
    content: text,
    contentType: "text",
    status: "completed",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(options.conversationId !==
    undefined
      ? {
          conversationId:
            options.conversationId,
        }
      : {}),
  };

  const detector =
    options.detector ??
    new DefaultIntentDetector();

  return detector.detect({
    message,
    ...(options.context !== undefined
      ? {
          context:
            options.context,
        }
      : {}),
    ...(options.history !== undefined
      ? {
          history:
            options.history,
        }
      : {}),
  });
}

/**
 * Devuelve true cuando una detección coincide con una intención.
 */
export function isDetectedIntent(
  detection: AIIntentDetection,
  intent: AIIntentName,
  minimumConfidence:
    AIConfidence = 0,
): boolean {
  return (
    detection.primary.name === intent &&
    detection.primary.confidence >=
      clampConfidence(
        minimumConfidence,
      )
  );
}

/**
 * Busca una entidad por nombre.
 */
export function findIntentEntity(
  detection: AIIntentDetection,
  entityName: string,
): AIIntentEntity | null {
  return (
    detection.entities.find(
      (entity) =>
        entity.name === entityName,
    ) ?? null
  );
}

/**
 * Busca todas las entidades de un tipo.
 */
export function findIntentEntities(
  detection: AIIntentDetection,
  entityName: string,
): readonly AIIntentEntity[] {
  return Object.freeze(
    detection.entities.filter(
      (entity) =>
        entity.name === entityName,
    ),
  );
}

/* ============================================================================
 * FACTORÍAS PÚBLICAS
 * ========================================================================== */

export function createDefaultIntentDetector(
  config: IntentDetectorConfig = {},
): DefaultIntentDetector {
  return new DefaultIntentDetector(
    config,
  );
}

export function createFunctionalIntentDetector(
  handler:
    FunctionalIntentDetectorHandler,
): FunctionalIntentDetector {
  return new FunctionalIntentDetector(
    handler,
  );
}