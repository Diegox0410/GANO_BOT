/**
 * @package @gano-bot/ai-core
 * @file contextBuilder.ts
 * @version 0.2.0
 *
 * Constructor central de contexto para GANO_BOT.
 *
 * Responsabilidades:
 * - Normalizar el contexto recibido por el motor de IA.
 * - Integrar datos de usuario, aplicación y negocio.
 * - Incorporar secciones producidas por proveedores externos.
 * - Resolver dominios de contexto de forma modular.
 * - Priorizar, deduplicar y limitar secciones.
 * - Detectar dominios requeridos que no pudieron resolverse.
 * - Generar advertencias sin inventar información.
 * - Respetar cancelaciones mediante AbortSignal.
 *
 * Este módulo no depende directamente de:
 * - React.
 * - Zustand.
 * - Firebase.
 * - Firestore.
 * - OpenAI.
 * - Gemini.
 *
 * Los datos externos se incorporan mediante proveedores configurables.
 */

import type {
  AIApplicationContext,
  AIBusinessContext,
  AIContext,
  AIContextBuildRequest,
  AIContextBuildResult,
  AIContextDomain,
  AIContextInput,
  AIContextSection,
  AIDurationMilliseconds,
  AIIdentifier,
  AIISODateString,
  AIMetadata,
  AIPriority,
  AIUserContext,
} from "./types.js";

import {
  EMPTY_AI_APPLICATION_CONTEXT,
  EMPTY_AI_METADATA,
  EMPTY_AI_USER_CONTEXT,
} from "./types.js";

/* ============================================================================
 * TIPOS PÚBLICOS
 * ========================================================================== */

/**
 * Información entregada a cada proveedor de contexto registrado.
 */
export interface AIContextProviderRequest {
  readonly requestId: AIIdentifier;
  readonly conversationId?: AIIdentifier;
  readonly domain: AIContextDomain;
  readonly input: AIContextInput;
  readonly currentSections: readonly AIContextSection[];
  readonly signal?: AbortSignal;
}

/**
 * Resultado producido por un proveedor de contexto.
 */
export interface AIContextProviderResult {
  readonly sections?: readonly AIContextSection[];
  readonly user?: AIUserContext;
  readonly application?: AIApplicationContext;
  readonly business?: AIBusinessContext;
  readonly warnings?: readonly string[];
  readonly metadata?: AIMetadata;
}

/**
 * Proveedor encargado de resolver uno o varios dominios.
 *
 * Ejemplos futuros:
 * - FirebaseUserContextProvider
 * - OrganizationContextProvider
 * - QualificationContextProvider
 * - ProductContextProvider
 * - WellnessContextProvider
 */
export interface AIContextProvider {
  readonly id: AIIdentifier;
  readonly domains: readonly AIContextDomain[];
  readonly priority?: AIPriority;
  readonly enabled?: boolean;

  provide(
    request: AIContextProviderRequest,
  ): Promise<AIContextProviderResult>;
}

/**
 * Configuración general del constructor.
 */
export interface ContextBuilderConfig {
  /**
   * Máximo de secciones conservadas en el contexto final.
   */
  readonly maximumSections?: number;

  /**
   * Dominios que deben intentarse resolver siempre.
   */
  readonly defaultRequiredDomains?: readonly AIContextDomain[];

  /**
   * Proveedores de contexto iniciales.
   */
  readonly providers?: readonly AIContextProvider[];

  /**
   * Permite ejecutar proveedores de forma paralela.
   */
  readonly parallelProviders?: boolean;

  /**
   * Permite continuar si falla un proveedor.
   *
   * Cuando es true, el error se transforma en advertencia.
   */
  readonly tolerateProviderErrors?: boolean;

  /**
   * Permite deduplicar secciones con el mismo identificador.
   */
  readonly deduplicateSections?: boolean;

  /**
   * Permite eliminar secciones cuyo contenido está vacío.
   */
  readonly removeEmptySections?: boolean;

  /**
   * Permite ordenar las secciones según su prioridad.
   */
  readonly sortSectionsByPriority?: boolean;

  /**
   * Generador de identificadores reemplazable.
   */
  readonly generateId?: () => AIIdentifier;

  /**
   * Reloj reemplazable para pruebas.
   */
  readonly now?: () => AIISODateString;
}

/**
 * Entrada simplificada para crear una sección.
 */
export interface CreateContextSectionInput {
  readonly id?: AIIdentifier;
  readonly domain: AIContextDomain;
  readonly title: string;
  readonly content: unknown;
  readonly priority?: AIPriority;
  readonly source?: string;
  readonly updatedAt?: AIISODateString;
  readonly metadata?: AIMetadata;
}

/**
 * Opciones para registrar proveedores dinámicamente.
 */
export interface RegisterContextProviderOptions {
  readonly replaceExisting?: boolean;
}

/**
 * Estadísticas generadas durante la construcción.
 */
export interface ContextBuildStatistics {
  readonly requestedDomains: readonly AIContextDomain[];
  readonly resolvedDomains: readonly AIContextDomain[];
  readonly omittedDomains: readonly AIContextDomain[];
  readonly providerCount: number;
  readonly successfulProviderCount: number;
  readonly failedProviderCount: number;
  readonly initialSectionCount: number;
  readonly providerSectionCount: number;
  readonly finalSectionCount: number;
  readonly duplicateSectionCount: number;
  readonly removedEmptySectionCount: number;
  readonly limitedSectionCount: number;
}

/**
 * Resultado interno de la ejecución de un proveedor.
 */
interface ProviderExecutionSuccess {
  readonly ok: true;
  readonly provider: AIContextProvider;
  readonly result: AIContextProviderResult;
}

interface ProviderExecutionFailure {
  readonly ok: false;
  readonly provider: AIContextProvider;
  readonly error: unknown;
}

type ProviderExecutionResult =
  | ProviderExecutionSuccess
  | ProviderExecutionFailure;

/**
 * Resultado interno del procesamiento de secciones.
 */
interface ProcessSectionsResult {
  readonly sections: readonly AIContextSection[];
  readonly duplicateSectionCount: number;
  readonly removedEmptySectionCount: number;
  readonly limitedSectionCount: number;
}

/* ============================================================================
 * CONSTANTES
 * ========================================================================== */

export const DEFAULT_CONTEXT_MAXIMUM_SECTIONS =
  50;

export const DEFAULT_CONTEXT_PROVIDER_PRIORITY:
  AIPriority = "normal";

export const CONTEXT_BUILDER_VERSION =
  1 as const;

const PRIORITY_WEIGHT:
  Readonly<Record<AIPriority, number>> =
  Object.freeze({
    critical: 4,
    high: 3,
    normal: 2,
    low: 1,
  });

const CONTEXT_DOMAINS:
  readonly AIContextDomain[] =
  Object.freeze([
    "user",
    "business",
    "organization",
    "qualification",
    "rank",
    "income",
    "products",
    "wellness",
    "education",
    "legal",
    "missions",
    "history",
    "conversation",
    "application",
    "custom",
  ]);

/* ============================================================================
 * UTILIDADES INTERNAS
 * ========================================================================== */

function defaultNow(): AIISODateString {
  return new Date().toISOString();
}

function defaultGenerateId(): AIIdentifier {
  const timestamp =
    Date.now().toString(36);

  const randomPart =
    Math.random()
      .toString(36)
      .slice(2, 12);

  return `context_${timestamp}_${randomPart}`;
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
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeOptionalText(
  value: string | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized =
    normalizeText(value);

  return normalized.length > 0
    ? normalized
    : undefined;
}

function normalizeStringArray(
  values: readonly string[] | undefined,
): readonly string[] {
  if (values === undefined) {
    return Object.freeze([]);
  }

  const normalized =
    values
      .map(normalizeText)
      .filter(
        (value) =>
          value.length > 0,
      );

  return Object.freeze([
    ...new Set(normalized),
  ]);
}

function normalizeDomains(
  domains:
    readonly AIContextDomain[] | undefined,
): readonly AIContextDomain[] {
  if (domains === undefined) {
    return Object.freeze([]);
  }

  return Object.freeze([
    ...new Set(
      domains.filter(
        (domain) =>
          CONTEXT_DOMAINS.includes(
            domain,
          ),
      ),
    ),
  ]);
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

function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object"
  ) {
    return false;
  }

  const prototype =
    Object.getPrototypeOf(value);

  return (
    prototype ===
      Object.prototype ||
    prototype === null
  );
}

function isEmptyContent(
  content: unknown,
): boolean {
  if (
    content === null ||
    content === undefined
  ) {
    return true;
  }

  if (typeof content === "string") {
    return (
      normalizeText(content).length ===
      0
    );
  }

  if (Array.isArray(content)) {
    return content.length === 0;
  }

  if (isPlainObject(content)) {
    return (
      Object.keys(content).length === 0
    );
  }

  return false;
}

function throwIfAborted(
  signal?: AbortSignal,
): void {
  if (signal?.aborted !== true) {
    return;
  }

  const error =
    new Error(
      "La construcción del contexto fue cancelada.",
    );

  error.name = "AbortError";

  throw error;
}

function getErrorMessage(
  error: unknown,
): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Error desconocido.";
}

function mergeMetadata(
  base: AIMetadata | undefined,
  incoming: AIMetadata | undefined,
): AIMetadata | undefined {
  if (
    base === undefined &&
    incoming === undefined
  ) {
    return undefined;
  }

  return Object.freeze({
    ...(base ?? EMPTY_AI_METADATA),
    ...(incoming ??
      EMPTY_AI_METADATA),
  });
}

function freezeUserContext(
  context: AIUserContext,
): AIUserContext {
  const frozen: AIUserContext = {
    ...(context.userId !== undefined
      ? {
          userId: context.userId,
        }
      : {}),
    ...(context.distributorId !==
    undefined
      ? {
          distributorId:
            context.distributorId,
        }
      : {}),
    ...(context.name !== undefined
      ? {
          name:
            normalizeText(
              context.name,
            ),
        }
      : {}),
    ...(context.email !== undefined
      ? {
          email:
            normalizeText(
              context.email,
            ),
        }
      : {}),
    ...(context.locale !== undefined
      ? {
          locale:
            normalizeText(
              context.locale,
            ),
        }
      : {}),
    ...(context.timezone !== undefined
      ? {
          timezone:
            normalizeText(
              context.timezone,
            ),
        }
      : {}),
    ...(context.country !== undefined
      ? {
          country:
            normalizeText(
              context.country,
            ),
        }
      : {}),
    ...(context.language !== undefined
      ? {
          language:
            normalizeText(
              context.language,
            ),
        }
      : {}),
    ...(context.authenticated !==
    undefined
      ? {
          authenticated:
            context.authenticated,
        }
      : {}),
    ...(context.metadata !== undefined
      ? {
          metadata:
            freezeMetadata(
              context.metadata,
            ),
        }
      : {}),
  };

  return Object.freeze(frozen);
}

function mergeUserContext(
  base: AIUserContext,
  incoming: AIUserContext,
): AIUserContext {
  const metadata =
    mergeMetadata(
      base.metadata,
      incoming.metadata,
    );

  return freezeUserContext({
    ...(base.userId !== undefined
      ? {
          userId: base.userId,
        }
      : {}),
    ...(base.distributorId !== undefined
      ? {
          distributorId:
            base.distributorId,
        }
      : {}),
    ...(base.name !== undefined
      ? {
          name: base.name,
        }
      : {}),
    ...(base.email !== undefined
      ? {
          email: base.email,
        }
      : {}),
    ...(base.locale !== undefined
      ? {
          locale: base.locale,
        }
      : {}),
    ...(base.timezone !== undefined
      ? {
          timezone:
            base.timezone,
        }
      : {}),
    ...(base.country !== undefined
      ? {
          country: base.country,
        }
      : {}),
    ...(base.language !== undefined
      ? {
          language:
            base.language,
        }
      : {}),
    ...(base.authenticated !== undefined
      ? {
          authenticated:
            base.authenticated,
        }
      : {}),
    ...(incoming.userId !== undefined
      ? {
          userId: incoming.userId,
        }
      : {}),
    ...(incoming.distributorId !==
    undefined
      ? {
          distributorId:
            incoming.distributorId,
        }
      : {}),
    ...(incoming.name !== undefined
      ? {
          name: incoming.name,
        }
      : {}),
    ...(incoming.email !== undefined
      ? {
          email: incoming.email,
        }
      : {}),
    ...(incoming.locale !== undefined
      ? {
          locale: incoming.locale,
        }
      : {}),
    ...(incoming.timezone !== undefined
      ? {
          timezone:
            incoming.timezone,
        }
      : {}),
    ...(incoming.country !== undefined
      ? {
          country: incoming.country,
        }
      : {}),
    ...(incoming.language !== undefined
      ? {
          language:
            incoming.language,
        }
      : {}),
    ...(incoming.authenticated !==
    undefined
      ? {
          authenticated:
            incoming.authenticated,
        }
      : {}),
    ...(metadata !== undefined
      ? {
          metadata,
        }
      : {}),
  });
}

function freezeApplicationContext(
  context: AIApplicationContext,
): AIApplicationContext {
  const frozen:
    AIApplicationContext = {
    ...(context.applicationId !==
    undefined
      ? {
          applicationId:
            context.applicationId,
        }
      : {}),
    ...(context.applicationName !==
    undefined
      ? {
          applicationName:
            normalizeText(
              context.applicationName,
            ),
        }
      : {}),
    ...(context.environment !==
    undefined
      ? {
          environment:
            context.environment,
        }
      : {}),
    ...(context.currentRoute !==
    undefined
      ? {
          currentRoute:
            normalizeText(
              context.currentRoute,
            ),
        }
      : {}),
    ...(context.currentModule !==
    undefined
      ? {
          currentModule:
            normalizeText(
              context.currentModule,
            ),
        }
      : {}),
    ...(context.currentView !==
    undefined
      ? {
          currentView:
            normalizeText(
              context.currentView,
            ),
        }
      : {}),
    ...(context.sessionId !== undefined
      ? {
          sessionId:
            context.sessionId,
        }
      : {}),
    ...(context.metadata !== undefined
      ? {
          metadata:
            freezeMetadata(
              context.metadata,
            ),
        }
      : {}),
  };

  return Object.freeze(frozen);
}

function mergeApplicationContext(
  base: AIApplicationContext,
  incoming: AIApplicationContext,
): AIApplicationContext {
  const metadata =
    mergeMetadata(
      base.metadata,
      incoming.metadata,
    );

  return freezeApplicationContext({
    ...(base.applicationId !==
    undefined
      ? {
          applicationId:
            base.applicationId,
        }
      : {}),
    ...(base.applicationName !==
    undefined
      ? {
          applicationName:
            base.applicationName,
        }
      : {}),
    ...(base.environment !== undefined
      ? {
          environment:
            base.environment,
        }
      : {}),
    ...(base.currentRoute !== undefined
      ? {
          currentRoute:
            base.currentRoute,
        }
      : {}),
    ...(base.currentModule !== undefined
      ? {
          currentModule:
            base.currentModule,
        }
      : {}),
    ...(base.currentView !== undefined
      ? {
          currentView:
            base.currentView,
        }
      : {}),
    ...(base.sessionId !== undefined
      ? {
          sessionId:
            base.sessionId,
        }
      : {}),
    ...(incoming.applicationId !==
    undefined
      ? {
          applicationId:
            incoming.applicationId,
        }
      : {}),
    ...(incoming.applicationName !==
    undefined
      ? {
          applicationName:
            incoming.applicationName,
        }
      : {}),
    ...(incoming.environment !==
    undefined
      ? {
          environment:
            incoming.environment,
        }
      : {}),
    ...(incoming.currentRoute !==
    undefined
      ? {
          currentRoute:
            incoming.currentRoute,
        }
      : {}),
    ...(incoming.currentModule !==
    undefined
      ? {
          currentModule:
            incoming.currentModule,
        }
      : {}),
    ...(incoming.currentView !==
    undefined
      ? {
          currentView:
            incoming.currentView,
        }
      : {}),
    ...(incoming.sessionId !== undefined
      ? {
          sessionId:
            incoming.sessionId,
        }
      : {}),
    ...(metadata !== undefined
      ? {
          metadata,
        }
      : {}),
  });
}

function freezeBusinessContext(
  context: AIBusinessContext,
): AIBusinessContext {
  const frozen: AIBusinessContext = {
    ...(context.rank !== undefined
      ? {
          rank:
            normalizeText(
              context.rank,
            ),
        }
      : {}),
    ...(context.targetRank !== undefined
      ? {
          targetRank:
            normalizeText(
              context.targetRank,
            ),
        }
      : {}),
    ...(context.packageCode !== undefined
      ? {
          packageCode:
            normalizeText(
              context.packageCode,
            ),
        }
      : {}),
    ...(context.status !== undefined
      ? {
          status:
            normalizeText(
              context.status,
            ),
        }
      : {}),
    ...(context.personalVolume !==
    undefined
      ? {
          personalVolume:
            context.personalVolume,
        }
      : {}),
    ...(context.commissionVolume !==
    undefined
      ? {
          commissionVolume:
            context.commissionVolume,
        }
      : {}),
    ...(context.groupCommissionVolume !==
    undefined
      ? {
          groupCommissionVolume:
            context.groupCommissionVolume,
        }
      : {}),
    ...(context.leftLegVolume !==
    undefined
      ? {
          leftLegVolume:
            context.leftLegVolume,
        }
      : {}),
    ...(context.rightLegVolume !==
    undefined
      ? {
          rightLegVolume:
            context.rightLegVolume,
        }
      : {}),
    ...(context.weakLegVolume !==
    undefined
      ? {
          weakLegVolume:
            context.weakLegVolume,
        }
      : {}),
    ...(context.strongLegVolume !==
    undefined
      ? {
          strongLegVolume:
            context.strongLegVolume,
        }
      : {}),
    ...(context.estimatedIncome !==
    undefined
      ? {
          estimatedIncome:
            context.estimatedIncome,
        }
      : {}),
    ...(context.currency !== undefined
      ? {
          currency:
            normalizeText(
              context.currency,
            ),
        }
      : {}),
    ...(context.currentCycleId !==
    undefined
      ? {
          currentCycleId:
            context.currentCycleId,
        }
      : {}),
    ...(context.metadata !== undefined
      ? {
          metadata:
            freezeMetadata(
              context.metadata,
            ),
        }
      : {}),
  };

  return Object.freeze(frozen);
}

function mergeBusinessContext(
  base: AIBusinessContext | undefined,
  incoming: AIBusinessContext,
): AIBusinessContext {
  const current =
    base ?? {};

  const metadata =
    mergeMetadata(
      current.metadata,
      incoming.metadata,
    );

  return freezeBusinessContext({
    ...(current.rank !== undefined
      ? {
          rank: current.rank,
        }
      : {}),
    ...(current.targetRank !== undefined
      ? {
          targetRank:
            current.targetRank,
        }
      : {}),
    ...(current.packageCode !== undefined
      ? {
          packageCode:
            current.packageCode,
        }
      : {}),
    ...(current.status !== undefined
      ? {
          status: current.status,
        }
      : {}),
    ...(current.personalVolume !==
    undefined
      ? {
          personalVolume:
            current.personalVolume,
        }
      : {}),
    ...(current.commissionVolume !==
    undefined
      ? {
          commissionVolume:
            current.commissionVolume,
        }
      : {}),
    ...(current.groupCommissionVolume !==
    undefined
      ? {
          groupCommissionVolume:
            current.groupCommissionVolume,
        }
      : {}),
    ...(current.leftLegVolume !==
    undefined
      ? {
          leftLegVolume:
            current.leftLegVolume,
        }
      : {}),
    ...(current.rightLegVolume !==
    undefined
      ? {
          rightLegVolume:
            current.rightLegVolume,
        }
      : {}),
    ...(current.weakLegVolume !==
    undefined
      ? {
          weakLegVolume:
            current.weakLegVolume,
        }
      : {}),
    ...(current.strongLegVolume !==
    undefined
      ? {
          strongLegVolume:
            current.strongLegVolume,
        }
      : {}),
    ...(current.estimatedIncome !==
    undefined
      ? {
          estimatedIncome:
            current.estimatedIncome,
        }
      : {}),
    ...(current.currency !== undefined
      ? {
          currency:
            current.currency,
        }
      : {}),
    ...(current.currentCycleId !==
    undefined
      ? {
          currentCycleId:
            current.currentCycleId,
        }
      : {}),
    ...(incoming.rank !== undefined
      ? {
          rank: incoming.rank,
        }
      : {}),
    ...(incoming.targetRank !== undefined
      ? {
          targetRank:
            incoming.targetRank,
        }
      : {}),
    ...(incoming.packageCode !== undefined
      ? {
          packageCode:
            incoming.packageCode,
        }
      : {}),
    ...(incoming.status !== undefined
      ? {
          status: incoming.status,
        }
      : {}),
    ...(incoming.personalVolume !==
    undefined
      ? {
          personalVolume:
            incoming.personalVolume,
        }
      : {}),
    ...(incoming.commissionVolume !==
    undefined
      ? {
          commissionVolume:
            incoming.commissionVolume,
        }
      : {}),
    ...(incoming.groupCommissionVolume !==
    undefined
      ? {
          groupCommissionVolume:
            incoming.groupCommissionVolume,
        }
      : {}),
    ...(incoming.leftLegVolume !==
    undefined
      ? {
          leftLegVolume:
            incoming.leftLegVolume,
        }
      : {}),
    ...(incoming.rightLegVolume !==
    undefined
      ? {
          rightLegVolume:
            incoming.rightLegVolume,
        }
      : {}),
    ...(incoming.weakLegVolume !==
    undefined
      ? {
          weakLegVolume:
            incoming.weakLegVolume,
        }
      : {}),
    ...(incoming.strongLegVolume !==
    undefined
      ? {
          strongLegVolume:
            incoming.strongLegVolume,
        }
      : {}),
    ...(incoming.estimatedIncome !==
    undefined
      ? {
          estimatedIncome:
            incoming.estimatedIncome,
        }
      : {}),
    ...(incoming.currency !== undefined
      ? {
          currency:
            incoming.currency,
        }
      : {}),
    ...(incoming.currentCycleId !==
    undefined
      ? {
          currentCycleId:
            incoming.currentCycleId,
        }
      : {}),
    ...(metadata !== undefined
      ? {
          metadata,
        }
      : {}),
  });
}

function freezeContextSection(
  section: AIContextSection,
): AIContextSection {
  const title =
    normalizeText(section.title);

  if (title.length === 0) {
    throw new Error(
      `La sección de contexto "${section.id}" no tiene un título válido.`,
    );
  }

  const frozen: AIContextSection = {
    id: section.id,
    domain: section.domain,
    title,
    content: section.content,
    priority: section.priority,
    ...(section.source !== undefined
      ? {
          source:
            normalizeText(
              section.source,
            ),
        }
      : {}),
    ...(section.updatedAt !== undefined
      ? {
          updatedAt:
            section.updatedAt,
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

  return Object.freeze(frozen);
}

function freezeContextSections(
  sections: readonly AIContextSection[],
): readonly AIContextSection[] {
  return Object.freeze(
    sections.map(
      freezeContextSection,
    ),
  );
}

function sortProviders(
  providers: readonly AIContextProvider[],
): readonly AIContextProvider[] {
  return [...providers].sort(
    (
      left,
      right,
    ) => {
      const leftPriority =
        left.priority ??
        DEFAULT_CONTEXT_PROVIDER_PRIORITY;

      const rightPriority =
        right.priority ??
        DEFAULT_CONTEXT_PROVIDER_PRIORITY;

      const priorityDifference =
        PRIORITY_WEIGHT[
          rightPriority
        ] -
        PRIORITY_WEIGHT[
          leftPriority
        ];

      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      return left.id.localeCompare(
        right.id,
      );
    },
  );
}

function sortContextSections(
  sections: readonly AIContextSection[],
): readonly AIContextSection[] {
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

      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      const leftTimestamp =
        left.updatedAt !== undefined
          ? Date.parse(
              left.updatedAt,
            )
          : 0;

      const rightTimestamp =
        right.updatedAt !== undefined
          ? Date.parse(
              right.updatedAt,
            )
          : 0;

      if (
        leftTimestamp !==
        rightTimestamp
      ) {
        return (
          rightTimestamp -
          leftTimestamp
        );
      }

      return left.id.localeCompare(
        right.id,
      );
    },
  );
}

function getResolvedDomains(
  user: AIUserContext,
  application: AIApplicationContext,
  business: AIBusinessContext | undefined,
  sections: readonly AIContextSection[],
): readonly AIContextDomain[] {
  const domains =
    new Set<AIContextDomain>();

  if (
    Object.keys(user).length > 0
  ) {
    domains.add("user");
  }

  if (
    Object.keys(application).length >
    0
  ) {
    domains.add("application");
  }

  if (
    business !== undefined &&
    Object.keys(business).length > 0
  ) {
    domains.add("business");
  }

  for (const section of sections) {
    domains.add(section.domain);
  }

  return Object.freeze([
    ...domains,
  ]);
}

function getOmittedDomains(
  requiredDomains:
    readonly AIContextDomain[],
  resolvedDomains:
    readonly AIContextDomain[],
): readonly AIContextDomain[] {
  const resolvedSet =
    new Set(resolvedDomains);

  return Object.freeze(
    requiredDomains.filter(
      (domain) =>
        !resolvedSet.has(domain),
    ),
  );
}

function processSections(
  sections: readonly AIContextSection[],
  options: {
    readonly maximumSections: number;
    readonly deduplicate: boolean;
    readonly removeEmpty: boolean;
    readonly sortByPriority: boolean;
  },
): ProcessSectionsResult {
  let duplicateSectionCount = 0;
  let removedEmptySectionCount = 0;
  let limitedSectionCount = 0;

  const filtered:
    AIContextSection[] = [];

  const sectionIndexes =
    new Map<
      AIIdentifier,
      number
    >();

  for (const section of sections) {
    if (
      options.removeEmpty &&
      isEmptyContent(
        section.content,
      )
    ) {
      removedEmptySectionCount += 1;
      continue;
    }

    const normalized =
      freezeContextSection(
        section,
      );

    if (!options.deduplicate) {
      filtered.push(normalized);
      continue;
    }

    const existingIndex =
      sectionIndexes.get(
        normalized.id,
      );

    if (
      existingIndex === undefined
    ) {
      sectionIndexes.set(
        normalized.id,
        filtered.length,
      );

      filtered.push(normalized);
      continue;
    }

    duplicateSectionCount += 1;

    /*
     * La última versión reemplaza la anterior.
     * Esto permite que un proveedor especializado actualice
     * una sección inicial con información más reciente.
     */
    filtered[existingIndex] =
      normalized;
  }

  const ordered =
    options.sortByPriority
      ? sortContextSections(filtered)
      : filtered;

  const limited =
    ordered.slice(
      0,
      options.maximumSections,
    );

  limitedSectionCount =
    Math.max(
      0,
      ordered.length -
        limited.length,
    );

  return Object.freeze({
    sections:
      freezeContextSections(
        limited,
      ),
    duplicateSectionCount,
    removedEmptySectionCount,
    limitedSectionCount,
  });
}

/* ============================================================================
 * CREACIÓN DE SECCIONES
 * ========================================================================== */

export function createContextSection(
  input: CreateContextSectionInput,
  options: {
    readonly generateId?: () => AIIdentifier;
    readonly now?: () => AIISODateString;
  } = {},
): AIContextSection {
  const generateId =
    options.generateId ??
    defaultGenerateId;

  const now =
    options.now ??
    defaultNow;

  const title =
    normalizeText(input.title);

  if (title.length === 0) {
    throw new Error(
      "Una sección de contexto no puede tener un título vacío.",
    );
  }

  if (
    !CONTEXT_DOMAINS.includes(
      input.domain,
    )
  ) {
    throw new Error(
      `Dominio de contexto inválido: "${input.domain}".`,
    );
  }

  const source =
    normalizeOptionalText(
      input.source,
    );

  const section: AIContextSection = {
    id:
      input.id ??
      generateId(),
    domain: input.domain,
    title,
    content: input.content,
    priority:
      input.priority ??
      "normal",
    ...(source !== undefined
      ? {
          source,
        }
      : {}),
    updatedAt:
      input.updatedAt ??
      now(),
    ...(input.metadata !== undefined
      ? {
          metadata:
            freezeMetadata(
              input.metadata,
            ),
        }
      : {}),
  };

  return freezeContextSection(
    section,
  );
}

/* ============================================================================
 * PROVEEDOR FUNCIONAL
 * ========================================================================== */

export type FunctionalContextProviderHandler =
  (
    request: AIContextProviderRequest,
  ) => Promise<AIContextProviderResult>;

export interface FunctionalContextProviderConfig {
  readonly id: AIIdentifier;
  readonly domains: readonly AIContextDomain[];
  readonly handler: FunctionalContextProviderHandler;
  readonly priority?: AIPriority;
  readonly enabled?: boolean;
}

export class FunctionalContextProvider
  implements AIContextProvider
{
  public readonly id:
    AIIdentifier;

  public readonly domains:
    readonly AIContextDomain[];

  public readonly priority?:
    AIPriority;

  public readonly enabled?:
    boolean;

  private readonly handler:
    FunctionalContextProviderHandler;

  public constructor(
    config:
      FunctionalContextProviderConfig,
  ) {
    const normalizedId =
      normalizeText(config.id);

    if (normalizedId.length === 0) {
      throw new Error(
        "El proveedor de contexto necesita un identificador.",
      );
    }

    this.id = normalizedId;

    this.domains =
      normalizeDomains(
        config.domains,
      );

    this.handler =
      config.handler;

    if (
      config.priority !== undefined
    ) {
      this.priority =
        config.priority;
    }

    if (
      config.enabled !== undefined
    ) {
      this.enabled =
        config.enabled;
    }
  }

  public provide(
    request: AIContextProviderRequest,
  ): Promise<AIContextProviderResult> {
    return this.handler(request);
  }
}

/* ============================================================================
 * CONSTRUCTOR PRINCIPAL
 * ========================================================================== */

export class DefaultContextBuilder {
  private readonly providers =
    new Map<
      AIIdentifier,
      AIContextProvider
    >();

  private readonly maximumSections:
    number;

  private readonly defaultRequiredDomains:
    readonly AIContextDomain[];

  private readonly parallelProviders:
    boolean;

  private readonly tolerateProviderErrors:
    boolean;

  private readonly deduplicateSections:
    boolean;

  private readonly removeEmptySections:
    boolean;

  private readonly sortSectionsByPriority:
    boolean;

  private readonly generateId:
    () => AIIdentifier;

  private readonly now:
    () => AIISODateString;

  public constructor(
    config: ContextBuilderConfig = {},
  ) {
    this.maximumSections =
      normalizePositiveInteger(
        config.maximumSections,
        DEFAULT_CONTEXT_MAXIMUM_SECTIONS,
      );

    this.defaultRequiredDomains =
      normalizeDomains(
        config.defaultRequiredDomains,
      );

    this.parallelProviders =
      config.parallelProviders ??
      true;

    this.tolerateProviderErrors =
      config.tolerateProviderErrors ??
      true;

    this.deduplicateSections =
      config.deduplicateSections ??
      true;

    this.removeEmptySections =
      config.removeEmptySections ??
      true;

    this.sortSectionsByPriority =
      config.sortSectionsByPriority ??
      true;

    this.generateId =
      config.generateId ??
      defaultGenerateId;

    this.now =
      config.now ??
      defaultNow;

    for (
      const provider of
      config.providers ?? []
    ) {
      this.registerProvider(
        provider,
      );
    }
  }

  /**
   * Registra un proveedor de contexto.
   */
  public registerProvider(
    provider: AIContextProvider,
    options:
      RegisterContextProviderOptions = {},
  ): void {
    const id =
      normalizeText(
        provider.id,
      );

    if (id.length === 0) {
      throw new Error(
        "El proveedor de contexto necesita un identificador válido.",
      );
    }

    if (
      this.providers.has(id) &&
      options.replaceExisting !==
        true
    ) {
      throw new Error(
        `Ya existe un proveedor de contexto con el identificador "${id}".`,
      );
    }

    this.providers.set(
      id,
      provider,
    );
  }

  /**
   * Elimina un proveedor registrado.
   */
  public unregisterProvider(
    providerId: AIIdentifier,
  ): boolean {
    return this.providers.delete(
      providerId,
    );
  }

  /**
   * Devuelve un proveedor registrado.
   */
  public getProvider(
    providerId: AIIdentifier,
  ): AIContextProvider | null {
    return (
      this.providers.get(
        providerId,
      ) ?? null
    );
  }

  /**
   * Lista los proveedores registrados en orden de prioridad.
   */
  public listProviders():
    readonly AIContextProvider[] {
    return Object.freeze(
      sortProviders([
        ...this.providers.values(),
      ]),
    );
  }

  /**
   * Construye el contexto completo.
   */
  public async build(
    request: AIContextBuildRequest,
  ): Promise<AIContextBuildResult> {
    const startedAt =
      Date.now();

    throwIfAborted(
      request.signal,
    );

    const requestId =
      request.input.requestId ??
      this.generateId();

    const requiredDomains =
      normalizeDomains([
        ...this.defaultRequiredDomains,
        ...(request.requiredDomains ??
          []),
      ]);

    const maximumSections =
      normalizePositiveInteger(
        request.maximumSections,
        this.maximumSections,
      );

    let user =
      freezeUserContext(
        request.input.user ??
          EMPTY_AI_USER_CONTEXT,
      );

    let application =
      freezeApplicationContext(
        request.input.application ??
          EMPTY_AI_APPLICATION_CONTEXT,
      );

    let business =
      request.input.business !==
      undefined
        ? freezeBusinessContext(
            request.input.business,
          )
        : undefined;

    const initialSections =
      freezeContextSections(
        request.input.sections ??
          [],
      );

    const warnings:
      string[] = [];

    const providerSections:
      AIContextSection[] = [];

    let successfulProviderCount = 0;
    let failedProviderCount = 0;

    const providers =
      this.selectProviders(
        requiredDomains,
      );

    const providerResults =
      this.parallelProviders
        ? await this.executeProvidersParallel(
            providers,
            {
              requestId,
              input:
                request.input,
              currentSections:
                initialSections,
              ...(request.input
                .conversationId !==
              undefined
                ? {
                    conversationId:
                      request.input
                        .conversationId,
                  }
                : {}),
              ...(request.signal !==
              undefined
                ? {
                    signal:
                      request.signal,
                  }
                : {}),
            },
          )
        : await this.executeProvidersSequential(
            providers,
            {
              requestId,
              input:
                request.input,
              currentSections:
                initialSections,
              ...(request.input
                .conversationId !==
              undefined
                ? {
                    conversationId:
                      request.input
                        .conversationId,
                  }
                : {}),
              ...(request.signal !==
              undefined
                ? {
                    signal:
                      request.signal,
                  }
                : {}),
            },
          );

    throwIfAborted(
      request.signal,
    );

    for (
      const execution of
      providerResults
    ) {
      if (!execution.ok) {
        failedProviderCount += 1;

        const message =
          `El proveedor de contexto "${execution.provider.id}" falló: ${getErrorMessage(
            execution.error,
          )}`;

        if (
          !this.tolerateProviderErrors
        ) {
          throw new Error(message);
        }

        warnings.push(message);
        continue;
      }

      successfulProviderCount += 1;

      const result =
        execution.result;

      if (result.user !== undefined) {
        user =
          mergeUserContext(
            user,
            result.user,
          );
      }

      if (
        result.application !==
        undefined
      ) {
        application =
          mergeApplicationContext(
            application,
            result.application,
          );
      }

      if (
        result.business !== undefined
      ) {
        business =
          mergeBusinessContext(
            business,
            result.business,
          );
      }

      if (
        result.sections !== undefined
      ) {
        providerSections.push(
          ...result.sections,
        );
      }

      warnings.push(
        ...normalizeStringArray(
          result.warnings,
        ),
      );
    }

    const processedSections =
      processSections(
        [
          ...initialSections,
          ...providerSections,
        ],
        {
          maximumSections,
          deduplicate:
            this.deduplicateSections,
          removeEmpty:
            this.removeEmptySections,
          sortByPriority:
            this.sortSectionsByPriority,
        },
      );

    if (
      processedSections
        .duplicateSectionCount > 0
    ) {
      warnings.push(
        `${processedSections.duplicateSectionCount} sección o secciones duplicadas fueron reemplazadas por su versión más reciente.`,
      );
    }

    if (
      processedSections
        .removedEmptySectionCount > 0
    ) {
      warnings.push(
        `${processedSections.removedEmptySectionCount} sección o secciones vacías fueron eliminadas.`,
      );
    }

    if (
      processedSections
        .limitedSectionCount > 0
    ) {
      warnings.push(
        `${processedSections.limitedSectionCount} sección o secciones fueron omitidas por el límite máximo configurado.`,
      );
    }

    const resolvedDomains =
      getResolvedDomains(
        user,
        application,
        business,
        processedSections.sections,
      );

    const omittedDomains =
      getOmittedDomains(
        requiredDomains,
        resolvedDomains,
      );

    if (omittedDomains.length > 0) {
      warnings.push(
        `No se pudieron resolver los siguientes dominios requeridos: ${omittedDomains.join(
          ", ",
        )}.`,
      );
    }

    const statistics:
      ContextBuildStatistics =
      Object.freeze({
        requestedDomains:
          requiredDomains,
        resolvedDomains,
        omittedDomains,
        providerCount:
          providers.length,
        successfulProviderCount,
        failedProviderCount,
        initialSectionCount:
          initialSections.length,
        providerSectionCount:
          providerSections.length,
        finalSectionCount:
          processedSections
            .sections.length,
        duplicateSectionCount:
          processedSections
            .duplicateSectionCount,
        removedEmptySectionCount:
          processedSections
            .removedEmptySectionCount,
        limitedSectionCount:
          processedSections
            .limitedSectionCount,
      });

    const contextMetadata =
      mergeMetadata(
        request.input.metadata,
        {
          contextBuilderVersion:
            CONTEXT_BUILDER_VERSION,
          providerCount:
            providers.length,
          successfulProviderCount,
          failedProviderCount,
          sectionCount:
            processedSections
              .sections.length,
          omittedDomainCount:
            omittedDomains.length,
        },
      );

    const context: AIContext = {
      requestId,
      generatedAt:
        this.now(),
      user,
      application,
      sections:
        processedSections.sections,
      ...(request.input
        .conversationId !== undefined
        ? {
            conversationId:
              request.input
                .conversationId,
          }
        : {}),
      ...(business !== undefined
        ? {
            business,
          }
        : {}),
      ...(contextMetadata !== undefined
        ? {
            metadata:
              contextMetadata,
          }
        : {}),
    };

    const durationMilliseconds:
      AIDurationMilliseconds =
      Math.max(
        0,
        Date.now() - startedAt,
      );

    /*
     * Las estadísticas se incluyen como metadatos serializables
     * sin modificar el contrato AIContextBuildResult definido
     * previamente en types.ts.
     */
    void statistics;

    return Object.freeze({
      context:
        Object.freeze(context),
      warnings:
        Object.freeze([
          ...new Set(warnings),
        ]),
      omittedDomains,
      durationMilliseconds,
    });
  }

  /**
   * Selecciona proveedores habilitados.
   *
   * Cuando no se solicitan dominios específicos, ejecuta todos.
   */
  private selectProviders(
    requiredDomains:
      readonly AIContextDomain[],
  ): readonly AIContextProvider[] {
    const enabledProviders =
      [...this.providers.values()]
        .filter(
          (provider) =>
            provider.enabled !== false,
        );

    if (
      requiredDomains.length === 0
    ) {
      return sortProviders(
        enabledProviders,
      );
    }

    const requiredSet =
      new Set(requiredDomains);

    return sortProviders(
      enabledProviders.filter(
        (provider) =>
          provider.domains.length ===
            0 ||
          provider.domains.some(
            (domain) =>
              requiredSet.has(domain),
          ),
      ),
    );
  }

  private async executeProvidersParallel(
    providers:
      readonly AIContextProvider[],
    baseRequest: Omit<
      AIContextProviderRequest,
      "domain"
    >,
  ): Promise<
    readonly ProviderExecutionResult[]
  > {
    return Promise.all(
      providers.map(
        async (
          provider,
        ): Promise<ProviderExecutionResult> => {
          throwIfAborted(
            baseRequest.signal,
          );

          try {
            const domain =
              provider.domains[0] ??
              "custom";

            const result =
              await provider.provide({
                ...baseRequest,
                domain,
              });

            throwIfAborted(
              baseRequest.signal,
            );

            return Object.freeze({
              ok: true,
              provider,
              result:
                Object.freeze({
                  ...(result.sections !==
                  undefined
                    ? {
                        sections:
                          freezeContextSections(
                            result.sections,
                          ),
                      }
                    : {}),
                  ...(result.user !==
                  undefined
                    ? {
                        user:
                          freezeUserContext(
                            result.user,
                          ),
                      }
                    : {}),
                  ...(result.application !==
                  undefined
                    ? {
                        application:
                          freezeApplicationContext(
                            result.application,
                          ),
                      }
                    : {}),
                  ...(result.business !==
                  undefined
                    ? {
                        business:
                          freezeBusinessContext(
                            result.business,
                          ),
                      }
                    : {}),
                  ...(result.warnings !==
                  undefined
                    ? {
                        warnings:
                          normalizeStringArray(
                            result.warnings,
                          ),
                      }
                    : {}),
                  ...(result.metadata !==
                  undefined
                    ? {
                        metadata:
                          freezeMetadata(
                            result.metadata,
                          ),
                      }
                    : {}),
                }),
            });
          } catch (error) {
            return Object.freeze({
              ok: false,
              provider,
              error,
            });
          }
        },
      ),
    );
  }

  private async executeProvidersSequential(
    providers:
      readonly AIContextProvider[],
    baseRequest: Omit<
      AIContextProviderRequest,
      "domain"
    >,
  ): Promise<
    readonly ProviderExecutionResult[]
  > {
    const executions:
      ProviderExecutionResult[] = [];

    for (const provider of providers) {
      throwIfAborted(
        baseRequest.signal,
      );

      try {
        const domain =
          provider.domains[0] ??
          "custom";

        const result =
          await provider.provide({
            ...baseRequest,
            domain,
          });

        throwIfAborted(
          baseRequest.signal,
        );

        executions.push(
          Object.freeze({
            ok: true,
            provider,
            result:
              Object.freeze({
                ...(result.sections !==
                undefined
                  ? {
                      sections:
                        freezeContextSections(
                          result.sections,
                        ),
                    }
                  : {}),
                ...(result.user !== undefined
                  ? {
                      user:
                        freezeUserContext(
                          result.user,
                        ),
                    }
                  : {}),
                ...(result.application !==
                undefined
                  ? {
                      application:
                        freezeApplicationContext(
                          result.application,
                        ),
                    }
                  : {}),
                ...(result.business !==
                undefined
                  ? {
                      business:
                        freezeBusinessContext(
                          result.business,
                        ),
                    }
                  : {}),
                ...(result.warnings !==
                undefined
                  ? {
                      warnings:
                        normalizeStringArray(
                          result.warnings,
                        ),
                    }
                  : {}),
                ...(result.metadata !==
                undefined
                  ? {
                      metadata:
                        freezeMetadata(
                          result.metadata,
                        ),
                    }
                  : {}),
              }),
          }),
        );
      } catch (error) {
        executions.push(
          Object.freeze({
            ok: false,
            provider,
            error,
          }),
        );

        if (
          !this.tolerateProviderErrors
        ) {
          break;
        }
      }
    }

    return Object.freeze(
      executions,
    );
  }
}

/* ============================================================================
 * CONSTRUCTOR FUNCIONAL
 * ========================================================================== */

export type FunctionalContextBuilderHandler =
  (
    request: AIContextBuildRequest,
  ) => Promise<AIContextBuildResult>;

export class FunctionalContextBuilder {
  private readonly handler:
    FunctionalContextBuilderHandler;

  public constructor(
    handler:
      FunctionalContextBuilderHandler,
  ) {
    this.handler = handler;
  }

  public build(
    request: AIContextBuildRequest,
  ): Promise<AIContextBuildResult> {
    return this.handler(request);
  }
}

/* ============================================================================
 * PROVEEDORES PREDETERMINADOS
 * ========================================================================== */

/**
 * Proveedor que convierte los datos de usuario en una sección textual
 * estructurada. No busca datos externos.
 */
export function createUserContextProvider(
  options: {
    readonly id?: AIIdentifier;
    readonly priority?: AIPriority;
  } = {},
): FunctionalContextProvider {
  return new FunctionalContextProvider({
    id:
      options.id ??
      "input-user-context-provider",
    domains: ["user"],
    ...(options.priority !== undefined
      ? {
          priority:
            options.priority,
        }
      : {}),
    handler: async (
      request,
    ) => {
      const user =
        request.input.user;

      if (user === undefined) {
        return Object.freeze({
          warnings:
            Object.freeze([
              "No se recibió contexto de usuario.",
            ]),
        });
      }

      return Object.freeze({
        user:
          freezeUserContext(user),
      });
    },
  });
}

/**
 * Proveedor que normaliza el contexto de la aplicación.
 */
export function createApplicationContextProvider(
  options: {
    readonly id?: AIIdentifier;
    readonly priority?: AIPriority;
  } = {},
): FunctionalContextProvider {
  return new FunctionalContextProvider({
    id:
      options.id ??
      "input-application-context-provider",
    domains: ["application"],
    ...(options.priority !== undefined
      ? {
          priority:
            options.priority,
        }
      : {}),
    handler: async (
      request,
    ) => {
      const application =
        request.input.application;

      if (application === undefined) {
        return Object.freeze({
          warnings:
            Object.freeze([
              "No se recibió contexto de la aplicación.",
            ]),
        });
      }

      return Object.freeze({
        application:
          freezeApplicationContext(
            application,
          ),
      });
    },
  });
}

/**
 * Proveedor que normaliza el contexto empresarial recibido.
 */
export function createBusinessContextProvider(
  options: {
    readonly id?: AIIdentifier;
    readonly priority?: AIPriority;
  } = {},
): FunctionalContextProvider {
  return new FunctionalContextProvider({
    id:
      options.id ??
      "input-business-context-provider",
    domains: [
      "business",
      "qualification",
      "rank",
      "income",
    ],
    ...(options.priority !== undefined
      ? {
          priority:
            options.priority,
        }
      : {}),
    handler: async (
      request,
    ) => {
      const business =
        request.input.business;

      if (business === undefined) {
        return Object.freeze({
          warnings:
            Object.freeze([
              "No se recibió contexto empresarial.",
            ]),
        });
      }

      return Object.freeze({
        business:
          freezeBusinessContext(
            business,
          ),
      });
    },
  });
}

/* ============================================================================
 * FACTORÍAS PÚBLICAS
 * ========================================================================== */

export function createDefaultContextBuilder(
  config: ContextBuilderConfig = {},
): DefaultContextBuilder {
  return new DefaultContextBuilder(
    config,
  );
}

export function createFunctionalContextBuilder(
  handler:
    FunctionalContextBuilderHandler,
): FunctionalContextBuilder {
  return new FunctionalContextBuilder(
    handler,
  );
}

export function createFunctionalContextProvider(
  config:
    FunctionalContextProviderConfig,
): FunctionalContextProvider {
  return new FunctionalContextProvider(
    config,
  );
}