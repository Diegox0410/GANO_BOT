/**
 * @package @gano-bot/ai-core
 * @file conversationEngine.ts
 * @version 0.2.0
 *
 * Motor principal de conversación de GANO_BOT.
 *
 * Responsabilidades:
 * - Recibir el mensaje actual del usuario.
 * - Recuperar el historial de conversación.
 * - Construir el contexto operativo.
 * - Detectar la intención.
 * - Recuperar memoria relevante.
 * - Recuperar documentos mediante un adaptador RAG.
 * - Crear un plan de ejecución opcional.
 * - Construir el prompt final.
 * - Solicitar una respuesta al proveedor LLM.
 * - Validar y sanear la respuesta.
 * - Persistir mensajes y recuerdos.
 * - Emitir eventos de ejecución.
 * - Gestionar errores, cancelaciones y tiempos.
 *
 * Este módulo funciona como orquestador.
 *
 * No depende directamente de:
 * - React;
 * - Zustand;
 * - Firebase;
 * - Firestore;
 * - OpenAI;
 * - Gemini.
 *
 * Las implementaciones concretas se conectan mediante adaptadores.
 */

import type {
  AIBuiltPrompt,
  AICitation,
  AIContext,
  AIContextBuildRequest,
  AIContextBuildResult,
  AIContextDomain,
  AIContextInput,
  AIExecutionPlan,
  AIIdentifier,
  AIIntentDetection,
  AIIntentDetectionRequest,
  AILLMResponse,
  AIMemoryEntry,
  AIMemoryQuery,
  AIMemorySearchResult,
  AIMetadata,
  AIMessage,
  AIMessageContentType,
  AIMessageRole,
  AIPromptBuildRequest,
  AIResponseValidationRequest,
  AIResponseValidationResult,
  AIResponseValidationRules,
  AIRetrievedDocument,
  AITokenCount,
} from "./types.js";

import {
  EMPTY_AI_METADATA,
} from "./types.js";

import type {
  DefaultContextBuilder,
} from "./contextBuilder.js";

import type {
  DefaultIntentDetector,
} from "./intentDetector.js";

import type {
  DefaultPromptBuilder,
} from "./promptBuilder.js";

import type {
  DefaultResponseValidator,
} from "./responseValidator.js";

import type {
  MemoryManager,
} from "./memory.js";

/* ============================================================================
 * TIPOS PÚBLICOS
 * ========================================================================== */

/**
 * Estado general de una ejecución conversacional.
 */
export type ConversationExecutionStatus =
  | "created"
  | "loading-history"
  | "building-context"
  | "detecting-intent"
  | "recalling-memory"
  | "retrieving-knowledge"
  | "planning"
  | "building-prompt"
  | "generating-response"
  | "validating-response"
  | "persisting"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Etapa concreta del pipeline.
 */
export type ConversationExecutionStage =
  | "history"
  | "context"
  | "intent"
  | "memory"
  | "knowledge"
  | "planning"
  | "prompt"
  | "llm"
  | "validation"
  | "persistence"
  | "engine";

/**
 * Entrada principal del motor.
 */
export interface ConversationEngineRequest {
  /**
   * Identificador opcional de la ejecución.
   */
  readonly requestId?: AIIdentifier;

  /**
   * Conversación a la que pertenece el mensaje.
   */
  readonly conversationId: AIIdentifier;

  /**
   * Mensaje actual del usuario.
   */
  readonly message: AIMessage;

  /**
   * Contexto inicial entregado por la aplicación.
   */
  readonly contextInput?: AIContextInput;

  /**
   * Historial entregado directamente.
   *
   * Cuando no se envía, puede recuperarse mediante conversationStore.
   */
  readonly history?: readonly AIMessage[];

  /**
   * Dominios que deben intentarse resolver.
   */
  readonly requiredContextDomains?: readonly AIContextDomain[];

  /**
   * Máximo de secciones del contexto.
   */
  readonly maximumContextSections?: number;

  /**
   * Consulta de memoria personalizada.
   */
  readonly memoryQuery?: AIMemoryQuery;

  /**
   * Permite deshabilitar la memoria para esta solicitud.
   */
  readonly useMemory?: boolean;

  /**
   * Permite deshabilitar RAG para esta solicitud.
   */
  readonly useKnowledgeRetrieval?: boolean;

  /**
   * Permite deshabilitar planificación.
   */
  readonly usePlanner?: boolean;

  /**
   * Plan previamente calculado.
   */
  readonly plan?: AIExecutionPlan;

  /**
   * Documentos previamente recuperados.
   */
  readonly documents?: readonly AIRetrievedDocument[];

  /**
   * Reglas específicas de validación.
   */
  readonly validationRules?: AIResponseValidationRules;

  /**
   * Máximo de tokens para el prompt.
   */
  readonly maximumPromptTokens?: AITokenCount;

  /**
   * Metadatos enviados al proveedor LLM.
   */
  readonly llmMetadata?: AIMetadata;

  /**
   * Metadatos generales de la ejecución.
   */
  readonly metadata?: AIMetadata;

  /**
   * Señal de cancelación.
   */
  readonly signal?: AbortSignal;
}

/**
 * Resultado final del motor.
 */
export interface ConversationEngineResult {
  readonly requestId: AIIdentifier;
  readonly conversationId: AIIdentifier;
  readonly status: ConversationExecutionStatus;

  readonly userMessage: AIMessage;
  readonly assistantMessage: AIMessage;

  readonly context: AIContext;
  readonly intent: AIIntentDetection;
  readonly memories: readonly AIMemoryEntry[];
  readonly documents: readonly AIRetrievedDocument[];
  readonly citations: readonly AICitation[];

  readonly plan?: AIExecutionPlan;
  readonly prompt: AIBuiltPrompt;
  readonly llmResponse: AILLMResponse;
  readonly validation: AIResponseValidationResult;

  readonly warnings: readonly string[];
  readonly timings: ConversationEngineTimings;
  readonly metadata?: AIMetadata;
}

/**
 * Medición temporal de las etapas.
 */
export interface ConversationEngineTimings {
  readonly totalMilliseconds: number;
  readonly historyMilliseconds: number;
  readonly contextMilliseconds: number;
  readonly intentMilliseconds: number;
  readonly memoryMilliseconds: number;
  readonly knowledgeMilliseconds: number;
  readonly planningMilliseconds: number;
  readonly promptMilliseconds: number;
  readonly llmMilliseconds: number;
  readonly validationMilliseconds: number;
  readonly persistenceMilliseconds: number;
}
/**
 * Versión mutable usada únicamente durante la ejecución interna.
 *
 * El resultado público continúa exponiendo ConversationEngineTimings
 * como un objeto de solo lectura.
 */
type MutableConversationEngineTimings = {
  -readonly [Property in keyof ConversationEngineTimings]:
    ConversationEngineTimings[Property];
};
/**
 * Configuración del motor.
 */
export interface ConversationEngineConfig {
  readonly contextBuilder: ConversationContextBuilder;
  readonly intentDetector: ConversationIntentDetector;
  readonly promptBuilder: ConversationPromptBuilder;
  readonly llmClient: ConversationLLMClient;
  readonly responseValidator: ConversationResponseValidator;

  readonly memory?: ConversationMemoryAdapter;
  readonly retriever?: ConversationKnowledgeRetriever;
  readonly planner?: ConversationPlanner;
  readonly citationBuilder?: ConversationCitationBuilder;
  readonly conversationStore?: ConversationStore;
  readonly eventListener?: ConversationEventListener;

  readonly maximumHistoryMessages?: number;
  readonly maximumMemoryEntries?: number;
  readonly maximumRetrievedDocuments?: number;

  readonly persistUserMessage?: boolean;
  readonly persistAssistantMessage?: boolean;
  readonly continueOnMemoryError?: boolean;
  readonly continueOnRetrievalError?: boolean;
  readonly continueOnPlanningError?: boolean;
  readonly continueOnPersistenceError?: boolean;
  readonly rejectInvalidResponse?: boolean;

  readonly assistantMessageContentType?: AIMessageContentType;
  readonly generateId?: () => AIIdentifier;
  readonly now?: () => string;
}

/* ============================================================================
 * ADAPTADORES
 * ========================================================================== */

export interface ConversationContextBuilder {
  build(
    request: AIContextBuildRequest,
  ): Promise<AIContextBuildResult>;
}

export interface ConversationIntentDetector {
  detect(
    request: AIIntentDetectionRequest,
  ): Promise<AIIntentDetection>;
}

export interface ConversationPromptBuilder {
  build(
    request: AIPromptBuildRequest,
  ): Promise<AIBuiltPrompt>;
}

export interface ConversationResponseValidator {
  validate(
    request: AIResponseValidationRequest,
  ): Promise<AIResponseValidationResult>;
}

/**
 * Solicitud normalizada enviada al adaptador LLM.
 *
 * El futuro archivo llm.ts podrá implementar este contrato.
 */
export interface ConversationLLMRequest {
  readonly requestId: AIIdentifier;
  readonly conversationId: AIIdentifier;
  readonly systemPrompt: string;
  readonly messages: readonly AIMessage[];
  readonly prompt: AIBuiltPrompt;
  readonly context: AIContext;
  readonly intent: AIIntentDetection;
  readonly plan?: AIExecutionPlan;
  readonly metadata?: AIMetadata;
  readonly signal?: AbortSignal;
}

export interface ConversationLLMClient {
  generate(
    request: ConversationLLMRequest,
  ): Promise<AILLMResponse>;
}

/**
 * Adaptador de memoria.
 */
export interface ConversationMemoryAdapter {
  recall(
    query: AIMemoryQuery,
  ): Promise<readonly AIMemorySearchResult[]>;

  remember?(
    input: ConversationRememberInput,
  ): Promise<AIMemoryEntry>;

  rememberMany?(
    inputs: readonly ConversationRememberInput[],
  ): Promise<unknown>;
}

export interface ConversationRememberInput {
  readonly type:
    | "fact"
    | "preference"
    | "goal"
    | "decision"
    | "constraint"
    | "summary"
    | "observation"
    | "custom";

  readonly scope:
    | "message"
    | "conversation"
    | "session"
    | "user"
    | "organization"
    | "global";

  readonly content: string;
  readonly importance?: number;
  readonly confidence?: number;
  readonly sourceMessageIds?: readonly AIIdentifier[];
  readonly metadata?: AIMetadata;
}

/**
 * Recuperador de conocimiento.
 */
export interface ConversationKnowledgeRequest {
  readonly requestId: AIIdentifier;
  readonly conversationId: AIIdentifier;
  readonly query: string;
  readonly context: AIContext;
  readonly intent: AIIntentDetection;
  readonly limit: number;
  readonly signal?: AbortSignal;
}

export interface ConversationKnowledgeResult {
  readonly documents: readonly AIRetrievedDocument[];
  readonly warnings?: readonly string[];
  readonly metadata?: AIMetadata;
}

export interface ConversationKnowledgeRetriever {
  retrieve(
    request: ConversationKnowledgeRequest,
  ): Promise<ConversationKnowledgeResult>;
}

/**
 * Planificador.
 */
export interface ConversationPlannerRequest {
  readonly requestId: AIIdentifier;
  readonly conversationId: AIIdentifier;
  readonly message: AIMessage;
  readonly history: readonly AIMessage[];
  readonly context: AIContext;
  readonly intent: AIIntentDetection;
  readonly memories: readonly AIMemoryEntry[];
  readonly documents: readonly AIRetrievedDocument[];
  readonly signal?: AbortSignal;
}

export interface ConversationPlanner {
  createPlan(
    request: ConversationPlannerRequest,
  ): Promise<AIExecutionPlan>;
}

/**
 * Constructor de citas.
 */
export interface ConversationCitationBuilderRequest {
  readonly requestId: AIIdentifier;
  readonly conversationId: AIIdentifier;
  readonly response: AILLMResponse;
  readonly documents: readonly AIRetrievedDocument[];
  readonly context: AIContext;
  readonly intent: AIIntentDetection;
}

export interface ConversationCitationBuilder {
  build(
    request: ConversationCitationBuilderRequest,
  ): Promise<readonly AICitation[]>;
}

/**
 * Persistencia de conversaciones.
 */
export interface ConversationStore {
  getHistory(
    conversationId: AIIdentifier,
    options?: {
      readonly limit?: number;
      readonly signal?: AbortSignal;
    },
  ): Promise<readonly AIMessage[]>;

  saveMessage(
    message: AIMessage,
    options?: {
      readonly signal?: AbortSignal;
    },
  ): Promise<void>;

  saveMessages?(
    messages: readonly AIMessage[],
    options?: {
      readonly signal?: AbortSignal;
    },
  ): Promise<void>;
}

/**
 * Eventos.
 */
export interface ConversationEvent {
  readonly requestId: AIIdentifier;
  readonly conversationId: AIIdentifier;
  readonly status: ConversationExecutionStatus;
  readonly stage: ConversationExecutionStage;
  readonly timestamp: string;
  readonly message?: string;
  readonly metadata?: AIMetadata;
}

export type ConversationEventListener =
  (
    event: ConversationEvent,
  ) => void | Promise<void>;

/**
 * Error estructurado del motor.
 */
export class ConversationEngineError
  extends Error
{
  public readonly requestId:
    AIIdentifier;

  public readonly conversationId:
    AIIdentifier;

  public readonly stage:
    ConversationExecutionStage;

  public readonly causeValue:
    unknown;

  public readonly metadata?:
    AIMetadata;

  public constructor(
    input: {
      readonly message: string;
      readonly requestId: AIIdentifier;
      readonly conversationId: AIIdentifier;
      readonly stage: ConversationExecutionStage;
      readonly cause?: unknown;
      readonly metadata?: AIMetadata;
    },
  ) {
    super(input.message);

    this.name =
      "ConversationEngineError";

    this.requestId =
      input.requestId;

    this.conversationId =
      input.conversationId;

    this.stage =
      input.stage;

    this.causeValue =
      input.cause;

    if (
      input.metadata !== undefined
    ) {
      this.metadata =
        freezeMetadata(
          input.metadata,
        );
    }
  }
}

/* ============================================================================
 * CONSTANTES
 * ========================================================================== */

export const CONVERSATION_ENGINE_VERSION =
  1 as const;

export const DEFAULT_CONVERSATION_HISTORY_LIMIT =
  30;

export const DEFAULT_CONVERSATION_MEMORY_LIMIT =
  12;

export const DEFAULT_CONVERSATION_DOCUMENT_LIMIT =
  8;

export const DEFAULT_ASSISTANT_CONTENT_TYPE:
  AIMessageContentType = "markdown";

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

  return `conversation_${timestamp}_${randomPart}`;
}

function defaultNow(): string {
  return new Date().toISOString();
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

function mergeMetadata(
  ...values:
    readonly (
      AIMetadata | undefined
    )[]
): AIMetadata | undefined {
  const validValues =
    values.filter(
      (
        value,
      ): value is AIMetadata =>
        value !== undefined,
    );

  if (validValues.length === 0) {
    return undefined;
  }

  return Object.freeze(
    Object.assign(
      {},
      ...validValues,
    ),
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

function normalizeNonNegativeInteger(
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

function throwIfAborted(
  signal?: AbortSignal,
): void {
  if (signal?.aborted !== true) {
    return;
  }

  const error =
    new Error(
      "La ejecución de la conversación fue cancelada.",
    );

  error.name = "AbortError";

  throw error;
}

function isAbortError(
  error: unknown,
): boolean {
  return (
    error instanceof Error &&
    error.name === "AbortError"
  );
}

function freezeMessage(
  message: AIMessage,
): AIMessage {
  const frozen: AIMessage = {
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

  return Object.freeze(frozen);
}

function freezeMessages(
  messages: readonly AIMessage[],
): readonly AIMessage[] {
  return Object.freeze(
    messages.map(freezeMessage),
  );
}

function freezeMemoryEntries(
  memories: readonly AIMemoryEntry[],
): readonly AIMemoryEntry[] {
  return Object.freeze([
    ...memories,
  ]);
}

function freezeDocuments(
  documents:
    readonly AIRetrievedDocument[],
): readonly AIRetrievedDocument[] {
  return Object.freeze([
    ...documents,
  ]);
}

function freezeCitations(
  citations: readonly AICitation[],
): readonly AICitation[] {
  return Object.freeze([
    ...citations,
  ]);
}

function deduplicateMessages(
  messages: readonly AIMessage[],
): readonly AIMessage[] {
  const unique =
    new Map<
      AIIdentifier,
      AIMessage
    >();

  for (const message of messages) {
    unique.set(
      message.id,
      message,
    );
  }

  return freezeMessages([
    ...unique.values(),
  ]);
}

function sortMessages(
  messages: readonly AIMessage[],
): readonly AIMessage[] {
  return freezeMessages(
    [...messages].sort(
      (
        left,
        right,
      ) => {
        const leftTime =
          Date.parse(
            left.createdAt,
          );

        const rightTime =
          Date.parse(
            right.createdAt,
          );

        if (
          leftTime !== rightTime
        ) {
          return (
            leftTime -
            rightTime
          );
        }

        return left.id.localeCompare(
          right.id,
        );
      },
    ),
  );
}

function createEmptyTimings():
  MutableConversationEngineTimings {
  return {
    totalMilliseconds: 0,
    historyMilliseconds: 0,
    contextMilliseconds: 0,
    intentMilliseconds: 0,
    memoryMilliseconds: 0,
    knowledgeMilliseconds: 0,
    planningMilliseconds: 0,
    promptMilliseconds: 0,
    llmMilliseconds: 0,
    validationMilliseconds: 0,
    persistenceMilliseconds: 0,
  };
}

function createAssistantMessage(
  input: {
    readonly id: AIIdentifier;
    readonly conversationId: AIIdentifier;
    readonly content: string;
    readonly contentType: AIMessageContentType;
    readonly createdAt: string;
    readonly metadata?: AIMetadata;
  },
): AIMessage {
  const message: AIMessage = {
    id: input.id,
    conversationId:
      input.conversationId,
    role:
      "assistant" satisfies AIMessageRole,
    content:
      normalizeText(
        input.content,
      ),
    contentType:
      input.contentType,
    status: "completed",
    createdAt:
      input.createdAt,
    updatedAt:
      input.createdAt,
    ...(input.metadata !== undefined
      ? {
          metadata:
            freezeMetadata(
              input.metadata,
            ),
        }
      : {}),
  };

  return freezeMessage(message);
}

function buildDefaultMemoryQuery(
  message: AIMessage,
  maximumMemoryEntries: number,
): AIMemoryQuery {
  return {
    text: message.content,
    scopes: [
      "conversation",
      "session",
      "user",
      "organization",
      "global",
    ],
    includeExpired: false,
    minimumImportance: 0,
    minimumConfidence: 0,
    limit:
      maximumMemoryEntries,
  };
}

/* ============================================================================
 * MOTOR PRINCIPAL
 * ========================================================================== */

export class DefaultConversationEngine {
  private readonly contextBuilder:
    ConversationContextBuilder;

  private readonly intentDetector:
    ConversationIntentDetector;

  private readonly promptBuilder:
    ConversationPromptBuilder;

  private readonly llmClient:
    ConversationLLMClient;

  private readonly responseValidator:
    ConversationResponseValidator;

  private readonly memory?:
    ConversationMemoryAdapter;

  private readonly retriever?:
    ConversationKnowledgeRetriever;

  private readonly planner?:
    ConversationPlanner;

  private readonly citationBuilder?:
    ConversationCitationBuilder;

  private readonly conversationStore?:
    ConversationStore;

  private readonly eventListener?:
    ConversationEventListener;

  private readonly maximumHistoryMessages:
    number;

  private readonly maximumMemoryEntries:
    number;

  private readonly maximumRetrievedDocuments:
    number;

  private readonly persistUserMessage:
    boolean;

  private readonly persistAssistantMessage:
    boolean;

  private readonly continueOnMemoryError:
    boolean;

  private readonly continueOnRetrievalError:
    boolean;

  private readonly continueOnPlanningError:
    boolean;

  private readonly continueOnPersistenceError:
    boolean;

  private readonly rejectInvalidResponse:
    boolean;

  private readonly assistantMessageContentType:
    AIMessageContentType;

  private readonly generateId:
    () => AIIdentifier;

  private readonly now:
    () => string;

  public constructor(
    config: ConversationEngineConfig,
  ) {
    this.contextBuilder =
      config.contextBuilder;

    this.intentDetector =
      config.intentDetector;

    this.promptBuilder =
      config.promptBuilder;

    this.llmClient =
      config.llmClient;

    this.responseValidator =
      config.responseValidator;

    this.memory =
      config.memory;

    this.retriever =
      config.retriever;

    this.planner =
      config.planner;

    this.citationBuilder =
      config.citationBuilder;

    this.conversationStore =
      config.conversationStore;

    this.eventListener =
      config.eventListener;

    this.maximumHistoryMessages =
      normalizeNonNegativeInteger(
        config.maximumHistoryMessages,
        DEFAULT_CONVERSATION_HISTORY_LIMIT,
      );

    this.maximumMemoryEntries =
      normalizeNonNegativeInteger(
        config.maximumMemoryEntries,
        DEFAULT_CONVERSATION_MEMORY_LIMIT,
      );

    this.maximumRetrievedDocuments =
      normalizeNonNegativeInteger(
        config.maximumRetrievedDocuments,
        DEFAULT_CONVERSATION_DOCUMENT_LIMIT,
      );

    this.persistUserMessage =
      config.persistUserMessage ??
      true;

    this.persistAssistantMessage =
      config.persistAssistantMessage ??
      true;

    this.continueOnMemoryError =
      config.continueOnMemoryError ??
      true;

    this.continueOnRetrievalError =
      config.continueOnRetrievalError ??
      true;

    this.continueOnPlanningError =
      config.continueOnPlanningError ??
      true;

    this.continueOnPersistenceError =
      config.continueOnPersistenceError ??
      true;

    this.rejectInvalidResponse =
      config.rejectInvalidResponse ??
      true;

    this.assistantMessageContentType =
      config.assistantMessageContentType ??
      DEFAULT_ASSISTANT_CONTENT_TYPE;

    this.generateId =
      config.generateId ??
      defaultGenerateId;

    this.now =
      config.now ??
      defaultNow;
  }

  /**
   * Ejecuta el pipeline conversacional completo.
   */
  public async run(
    request: ConversationEngineRequest,
  ): Promise<ConversationEngineResult> {
    const totalStartedAt =
      Date.now();

    const requestId =
      request.requestId ??
      this.generateId();

    const conversationId =
      request.conversationId;

    const warnings:
      string[] = [];

    const timings =
      createEmptyTimings();

    throwIfAborted(
      request.signal,
    );

    this.validateRequest(
      request,
    );

    await this.emit({
      requestId,
      conversationId,
      status: "created",
      stage: "engine",
      timestamp:
        this.now(),
      message:
        "Ejecución conversacional creada.",
    });

    try {
      const historyStartedAt =
        Date.now();

      await this.emit({
        requestId,
        conversationId,
        status: "loading-history",
        stage: "history",
        timestamp:
          this.now(),
      });

      const history =
        await this.loadHistory(
          request,
        );

      timings.historyMilliseconds =
        Date.now() -
        historyStartedAt;

      throwIfAborted(
        request.signal,
      );

      const contextStartedAt =
        Date.now();

      await this.emit({
        requestId,
        conversationId,
        status: "building-context",
        stage: "context",
        timestamp:
          this.now(),
      });

      const contextResult =
        await this.buildContext(
          request,
          requestId,
          conversationId,
        );

      warnings.push(
        ...contextResult.warnings,
      );

      timings.contextMilliseconds =
        Date.now() -
        contextStartedAt;

      throwIfAborted(
        request.signal,
      );

      const intentStartedAt =
        Date.now();

      await this.emit({
        requestId,
        conversationId,
        status: "detecting-intent",
        stage: "intent",
        timestamp:
          this.now(),
      });

      const intent =
        await this.intentDetector.detect(
          this.createIntentRequest(
            request,
            history,
            contextResult.context,
          ),
        );

      timings.intentMilliseconds =
        Date.now() -
        intentStartedAt;

      throwIfAborted(
        request.signal,
      );

      const memoryStartedAt =
        Date.now();

      await this.emit({
        requestId,
        conversationId,
        status: "recalling-memory",
        stage: "memory",
        timestamp:
          this.now(),
      });

      const memories =
        await this.recallMemory(
          request,
          warnings,
        );

      timings.memoryMilliseconds =
        Date.now() -
        memoryStartedAt;

      throwIfAborted(
        request.signal,
      );

      const knowledgeStartedAt =
        Date.now();

      await this.emit({
        requestId,
        conversationId,
        status: "retrieving-knowledge",
        stage: "knowledge",
        timestamp:
          this.now(),
      });

      const documents =
        await this.retrieveKnowledge(
          request,
          requestId,
          contextResult.context,
          intent,
          warnings,
        );

      timings.knowledgeMilliseconds =
        Date.now() -
        knowledgeStartedAt;

      throwIfAborted(
        request.signal,
      );

      const planningStartedAt =
        Date.now();

      await this.emit({
        requestId,
        conversationId,
        status: "planning",
        stage: "planning",
        timestamp:
          this.now(),
      });

      const plan =
        await this.resolvePlan(
          request,
          requestId,
          history,
          contextResult.context,
          intent,
          memories,
          documents,
          warnings,
        );

      timings.planningMilliseconds =
        Date.now() -
        planningStartedAt;

      throwIfAborted(
        request.signal,
      );

      const promptStartedAt =
        Date.now();

      await this.emit({
        requestId,
        conversationId,
        status: "building-prompt",
        stage: "prompt",
        timestamp:
          this.now(),
      });

      const prompt =
        await this.promptBuilder.build(
          this.createPromptRequest(
            request,
            history,
            contextResult.context,
            memories,
            documents,
            plan,
          ),
        );

      warnings.push(
        ...prompt.warnings,
      );

      timings.promptMilliseconds =
        Date.now() -
        promptStartedAt;

      throwIfAborted(
        request.signal,
      );

      const llmStartedAt =
        Date.now();

      await this.emit({
        requestId,
        conversationId,
        status: "generating-response",
        stage: "llm",
        timestamp:
          this.now(),
      });

      const llmResponse =
        await this.llmClient.generate({
          requestId,
          conversationId,
          systemPrompt:
            prompt.systemPrompt,
          messages:
            prompt.messages,
          prompt,
          context:
            contextResult.context,
          intent,
          ...(plan !== undefined
            ? {
                plan,
              }
            : {}),
          ...(request.llmMetadata !==
          undefined
            ? {
                metadata:
                  request.llmMetadata,
              }
            : {}),
          ...(request.signal !==
          undefined
            ? {
                signal:
                  request.signal,
              }
            : {}),
        });

      timings.llmMilliseconds =
        Date.now() -
        llmStartedAt;

      throwIfAborted(
        request.signal,
      );

      const citations =
        await this.buildCitations(
          requestId,
          conversationId,
          llmResponse,
          documents,
          contextResult.context,
          intent,
          warnings,
        );

      const validationStartedAt =
        Date.now();

      await this.emit({
        requestId,
        conversationId,
        status: "validating-response",
        stage: "validation",
        timestamp:
          this.now(),
      });

      const validation =
        await this.responseValidator.validate(
          this.createValidationRequest(
            request,
            llmResponse,
            citations,
            contextResult.context,
            intent,
          ),
        );

      timings.validationMilliseconds =
        Date.now() -
        validationStartedAt;

      if (
        !validation.valid &&
        this.rejectInvalidResponse
      ) {
        throw new ConversationEngineError({
          message:
            "La respuesta generada no superó la validación.",
          requestId,
          conversationId,
          stage: "validation",
          metadata: {
            validationIssueCount:
              validation.issues.length,
            validationCodes:
              validation.issues.map(
                (issue) =>
                  issue.code,
              ),
          },
        });
      }

      const assistantMessage =
        createAssistantMessage({
          id:
            this.generateId(),
          conversationId,
          content:
            validation.sanitizedContent,
          contentType:
            llmResponse.message
              .contentType ??
            this.assistantMessageContentType,
          createdAt:
            this.now(),
          metadata:
            mergeMetadata(
              llmResponse.message
                .metadata,
              {
                requestId,
                intent:
                  intent.primary.name,
                intentConfidence:
                  intent.primary
                    .confidence,
                validationPassed:
                  validation.valid,
                citationCount:
                  validation.citations
                    .length,
              },
            ),
        });

      const persistenceStartedAt =
        Date.now();

      await this.emit({
        requestId,
        conversationId,
        status: "persisting",
        stage: "persistence",
        timestamp:
          this.now(),
      });

      await this.persistExecution(
        request,
        assistantMessage,
        intent,
        warnings,
      );

      timings.persistenceMilliseconds =
        Date.now() -
        persistenceStartedAt;

      timings.totalMilliseconds =
        Date.now() -
        totalStartedAt;

      await this.emit({
        requestId,
        conversationId,
        status: "completed",
        stage: "engine",
        timestamp:
          this.now(),
        message:
          "Ejecución conversacional completada.",
        metadata: {
          totalMilliseconds:
            timings.totalMilliseconds,
          intent:
            intent.primary.name,
          responseValid:
            validation.valid,
        },
      });

      const resultMetadata =
        mergeMetadata(
          request.metadata,
          {
            engine:
              "DefaultConversationEngine",
            engineVersion:
              CONVERSATION_ENGINE_VERSION,
            historyMessageCount:
              history.length,
            memoryCount:
              memories.length,
            documentCount:
              documents.length,
            citationCount:
              validation.citations
                .length,
            warningCount:
              warnings.length,
          },
        );

      return Object.freeze({
        requestId,
        conversationId,
        status:
          "completed",
        userMessage:
          freezeMessage(
            request.message,
          ),
        assistantMessage,
        context:
          contextResult.context,
        intent,
        memories:
          freezeMemoryEntries(
            memories,
          ),
        documents:
          freezeDocuments(
            documents,
          ),
        citations:
          freezeCitations(
            validation.citations,
          ),
        ...(plan !== undefined
          ? {
              plan,
            }
          : {}),
        prompt,
        llmResponse,
        validation,
        warnings:
          Object.freeze([
            ...new Set(warnings),
          ]),
        timings:
          Object.freeze({
            ...timings,
          }),
        ...(resultMetadata !==
        undefined
          ? {
              metadata:
                resultMetadata,
            }
          : {}),
      });
    } catch (error) {
      timings.totalMilliseconds =
        Date.now() -
        totalStartedAt;

      const cancelled =
        isAbortError(error) ||
        request.signal?.aborted ===
          true;

      await this.emit({
        requestId,
        conversationId,
        status:
          cancelled
            ? "cancelled"
            : "failed",
        stage:
          error instanceof
          ConversationEngineError
            ? error.stage
            : "engine",
        timestamp:
          this.now(),
        message:
          cancelled
            ? "La ejecución fue cancelada."
            : getErrorMessage(error),
        metadata: {
          totalMilliseconds:
            timings.totalMilliseconds,
        },
      });

      if (
        error instanceof
        ConversationEngineError
      ) {
        throw error;
      }

      throw new ConversationEngineError({
        message:
          cancelled
            ? "La ejecución de la conversación fue cancelada."
            : `No se pudo completar la conversación: ${getErrorMessage(
                error,
              )}`,
        requestId,
        conversationId,
        stage:
          cancelled
            ? "engine"
            : "engine",
        cause: error,
        metadata: {
          cancelled,
          totalMilliseconds:
            timings.totalMilliseconds,
        },
      });
    }
  }

  /**
   * Alias semántico de run().
   */
  public process(
    request: ConversationEngineRequest,
  ): Promise<ConversationEngineResult> {
    return this.run(request);
  }

  /**
   * Alias orientado a interfaces de chat.
   */
  public respond(
    request: ConversationEngineRequest,
  ): Promise<ConversationEngineResult> {
    return this.run(request);
  }

  private validateRequest(
    request: ConversationEngineRequest,
  ): void {
    if (
      request.conversationId
        .trim().length === 0
    ) {
      throw new Error(
        "La conversación necesita un identificador.",
      );
    }

    if (
      request.message.role !==
      "user"
    ) {
      throw new Error(
        "El mensaje principal debe pertenecer al rol user.",
      );
    }

    if (
      request.message.content
        .trim().length === 0
    ) {
      throw new Error(
        "El mensaje del usuario no puede estar vacío.",
      );
    }

    if (
      request.message
        .conversationId !==
        undefined &&
      request.message
        .conversationId !==
        request.conversationId
    ) {
      throw new Error(
        "El identificador de conversación del mensaje no coincide con la solicitud.",
      );
    }
  }

  private async loadHistory(
    request: ConversationEngineRequest,
  ): Promise<readonly AIMessage[]> {
    let history:
      readonly AIMessage[];

    if (
      request.history !== undefined
    ) {
      history =
        request.history;
    } else if (
      this.conversationStore !==
      undefined
    ) {
      history =
        await this.conversationStore.getHistory(
          request.conversationId,
          {
            limit:
              this.maximumHistoryMessages,
            ...(request.signal !==
            undefined
              ? {
                  signal:
                    request.signal,
                }
              : {}),
          },
        );
    } else {
      history =
        Object.freeze([]);
    }

    const normalizedHistory =
      sortMessages(
        deduplicateMessages(
          history.filter(
            (message) =>
              message.content
                .trim().length > 0 &&
              message.role !==
                "system" &&
              message.role !==
                "developer",
          ),
        ),
      );

    return Object.freeze(
      normalizedHistory.slice(
        -this.maximumHistoryMessages,
      ),
    );
  }

  private async buildContext(
    request: ConversationEngineRequest,
    requestId: AIIdentifier,
    conversationId: AIIdentifier,
  ): Promise<AIContextBuildResult> {
    const input:
      AIContextInput = {
      ...(request.contextInput ??
        {}),
      requestId,
      conversationId,
      metadata:
        mergeMetadata(
          request.contextInput
            ?.metadata,
          request.metadata,
          {
            conversationEngineVersion:
              CONVERSATION_ENGINE_VERSION,
          },
        ) ??
        EMPTY_AI_METADATA,
    };

    const contextRequest:
      AIContextBuildRequest = {
      input,
      requiredDomains:
        request.requiredContextDomains ??
        [],
      ...(request.maximumContextSections !==
      undefined
        ? {
            maximumSections:
              request.maximumContextSections,
          }
        : {}),
      ...(request.signal !== undefined
        ? {
            signal:
              request.signal,
          }
        : {}),
    };

    return this.contextBuilder.build(
      contextRequest,
    );
  }

  private createIntentRequest(
    request: ConversationEngineRequest,
    history: readonly AIMessage[],
    context: AIContext,
  ): AIIntentDetectionRequest {
    return {
      message:
        request.message,
      history,
      context,
      ...(request.signal !== undefined
        ? {
            signal:
              request.signal,
          }
        : {}),
    };
  }

  private async recallMemory(
    request: ConversationEngineRequest,
    warnings: string[],
  ): Promise<readonly AIMemoryEntry[]> {
    if (
      request.useMemory === false ||
      this.memory === undefined ||
      this.maximumMemoryEntries ===
        0
    ) {
      return Object.freeze([]);
    }

    try {
      const query =
        request.memoryQuery ??
        buildDefaultMemoryQuery(
          request.message,
          this.maximumMemoryEntries,
        );

      const results =
        await this.memory.recall({
          ...query,
          limit:
            query.limit ??
            this.maximumMemoryEntries,
        });

      return freezeMemoryEntries(
        results
          .slice(
            0,
            this.maximumMemoryEntries,
          )
          .map(
            (result) =>
              result.entry,
          ),
      );
    } catch (error) {
      if (
        !this.continueOnMemoryError
      ) {
        throw new ConversationEngineError({
          message:
            `No se pudo recuperar la memoria: ${getErrorMessage(
              error,
            )}`,
          requestId:
            request.requestId ??
            "unknown",
          conversationId:
            request.conversationId,
          stage: "memory",
          cause: error,
        });
      }

      warnings.push(
        `La memoria no pudo recuperarse: ${getErrorMessage(
          error,
        )}`,
      );

      return Object.freeze([]);
    }
  }

  private async retrieveKnowledge(
    request: ConversationEngineRequest,
    requestId: AIIdentifier,
    context: AIContext,
    intent: AIIntentDetection,
    warnings: string[],
  ): Promise<
    readonly AIRetrievedDocument[]
  > {
    if (
      request.documents !== undefined
    ) {
      return freezeDocuments(
        request.documents.slice(
          0,
          this.maximumRetrievedDocuments,
        ),
      );
    }

    if (
      request.useKnowledgeRetrieval ===
        false ||
      this.retriever === undefined ||
      this.maximumRetrievedDocuments ===
        0
    ) {
      return Object.freeze([]);
    }
  try {
      const result =
        await this.retriever.retrieve({
          requestId,
          conversationId:
            request.conversationId,
          query:
            request.message.content,
          context,
          intent,
          limit:
            this.maximumRetrievedDocuments,
          ...(request.signal !==
          undefined
            ? {
                signal:
                  request.signal,
              }
            : {}),
        });

      warnings.push(
        ...(result.warnings ?? []),
      );

      return freezeDocuments(
        result.documents.slice(
          0,
          this.maximumRetrievedDocuments,
        ),
      );
    } catch (error) {
      if (
        !this.continueOnRetrievalError
      ) {
        throw new ConversationEngineError({
          message:
            `No se pudo recuperar conocimiento: ${getErrorMessage(
              error,
            )}`,
          requestId,
          conversationId:
            request.conversationId,
          stage: "knowledge",
          cause: error,
        });
      }

      warnings.push(
        `La recuperación documental falló: ${getErrorMessage(
          error,
        )}`,
      );

      return Object.freeze([]);
    }
  }

  private async resolvePlan(
    request: ConversationEngineRequest,
    requestId: AIIdentifier,
    history: readonly AIMessage[],
    context: AIContext,
    intent: AIIntentDetection,
    memories: readonly AIMemoryEntry[],
    documents:
      readonly AIRetrievedDocument[],
    warnings: string[],
  ): Promise<
    AIExecutionPlan | undefined
  > {
    if (request.plan !== undefined) {
      return request.plan;
    }

    if (
      request.usePlanner === false ||
      this.planner === undefined
    ) {
      return undefined;
    }

    try {
      return await this.planner.createPlan({
        requestId,
        conversationId:
          request.conversationId,
        message:
          request.message,
        history,
        context,
        intent,
        memories,
        documents,
        ...(request.signal !==
        undefined
          ? {
              signal:
                request.signal,
            }
          : {}),
      });
    } catch (error) {
      if (
        !this.continueOnPlanningError
      ) {
        throw new ConversationEngineError({
          message:
            `No se pudo crear el plan: ${getErrorMessage(
              error,
            )}`,
          requestId,
          conversationId:
            request.conversationId,
          stage: "planning",
          cause: error,
        });
      }

      warnings.push(
        `El planificador no pudo generar un plan: ${getErrorMessage(
          error,
        )}`,
      );

      return undefined;
    }
  }

  private createPromptRequest(
    request: ConversationEngineRequest,
    history: readonly AIMessage[],
    context: AIContext,
    memories: readonly AIMemoryEntry[],
    documents:
      readonly AIRetrievedDocument[],
    plan: AIExecutionPlan | undefined,
  ): AIPromptBuildRequest {
    return {
      userMessage:
        request.message,
      history,
      context,
      memory:
        memories,
      documents,
      ...(plan !== undefined
        ? {
            plan,
          }
        : {}),
      ...(request.maximumPromptTokens !==
      undefined
        ? {
            maximumTokens:
              request.maximumPromptTokens,
          }
        : {}),
    };
  }

  private async buildCitations(
    requestId: AIIdentifier,
    conversationId: AIIdentifier,
    response: AILLMResponse,
    documents:
      readonly AIRetrievedDocument[],
    context: AIContext,
    intent: AIIntentDetection,
    warnings: string[],
  ): Promise<readonly AICitation[]> {
    if (
      this.citationBuilder === undefined
    ) {
      return Object.freeze([]);
    }

    try {
      return freezeCitations(
        await this.citationBuilder.build({
          requestId,
          conversationId,
          response,
          documents,
          context,
          intent,
        }),
      );
    } catch (error) {
      warnings.push(
        `No se pudieron construir las citas: ${getErrorMessage(
          error,
        )}`,
      );

      return Object.freeze([]);
    }
  }

  private createValidationRequest(
    request: ConversationEngineRequest,
    response: AILLMResponse,
    citations: readonly AICitation[],
    context: AIContext,
    intent: AIIntentDetection,
  ): AIResponseValidationRequest {
    return {
      response,
      citations,
      context,
      intent,
      ...(request.validationRules !==
      undefined
        ? {
            rules:
              request.validationRules,
          }
        : {}),
    };
  }

  private async persistExecution(
    request: ConversationEngineRequest,
    assistantMessage: AIMessage,
    intent: AIIntentDetection,
    warnings: string[],
  ): Promise<void> {
    const operations:
      Promise<unknown>[] = [];

    if (
      this.conversationStore !==
      undefined
    ) {
      if (
        this.persistUserMessage &&
        this.persistAssistantMessage &&
        this.conversationStore
          .saveMessages !==
          undefined
      ) {
        operations.push(
          this.conversationStore.saveMessages(
            [
              request.message,
              assistantMessage,
            ],
            {
              ...(request.signal !==
              undefined
                ? {
                    signal:
                      request.signal,
                  }
                : {}),
            },
          ),
        );
      } else {
        if (
          this.persistUserMessage
        ) {
          operations.push(
            this.conversationStore.saveMessage(
              request.message,
              {
                ...(request.signal !==
                undefined
                  ? {
                      signal:
                        request.signal,
                    }
                  : {}),
              },
            ),
          );
        }

        if (
          this.persistAssistantMessage
        ) {
          operations.push(
            this.conversationStore.saveMessage(
              assistantMessage,
              {
                ...(request.signal !==
                undefined
                  ? {
                      signal:
                        request.signal,
                    }
                  : {}),
              },
            ),
          );
        }
      }
    }

    if (
      this.memory?.remember !==
      undefined
    ) {
      operations.push(
        this.memory.remember({
          type:
            "observation",
          scope:
            "conversation",
          content:
            `El usuario realizó una consulta con intención "${intent.primary.name}".`,
          importance:
            0.25,
          confidence:
            intent.primary
              .confidence,
          sourceMessageIds: [
            request.message.id,
            assistantMessage.id,
          ],
          metadata: {
            conversationId:
              request.conversationId,
            userMessageId:
              request.message.id,
            assistantMessageId:
              assistantMessage.id,
          },
        }),
      );
    }

    if (operations.length === 0) {
      return;
    }

    const results =
      await Promise.allSettled(
        operations,
      );

    const failures =
      results.filter(
        (result) =>
          result.status ===
          "rejected",
      );

    if (failures.length === 0) {
      return;
    }

    const failureMessages =
      failures.map(
        (failure) =>
          failure.status ===
          "rejected"
            ? getErrorMessage(
                failure.reason,
              )
            : "Error desconocido.",
      );

    if (
      !this.continueOnPersistenceError
    ) {
      throw new ConversationEngineError({
        message:
          `No se pudo persistir completamente la conversación: ${failureMessages.join(
            " | ",
          )}`,
        requestId:
          request.requestId ??
          "unknown",
        conversationId:
          request.conversationId,
        stage:
          "persistence",
        metadata: {
          failureCount:
            failures.length,
        },
      });
    }

    warnings.push(
      `La conversación se generó, pero ${failures.length} operación u operaciones de persistencia fallaron: ${failureMessages.join(
        " | ",
      )}`,
    );
  }

  private async emit(
    input: ConversationEvent,
  ): Promise<void> {
    if (
      this.eventListener === undefined
    ) {
      return;
    }

    try {
      await this.eventListener(
        Object.freeze({
          ...input,
          ...(input.metadata !==
          undefined
            ? {
                metadata:
                  freezeMetadata(
                    input.metadata,
                  ),
              }
            : {}),
        }),
      );
    } catch {
      /*
       * Los errores del listener no deben detener el pipeline.
       */
    }
  }
}

/* ============================================================================
 * MOTOR FUNCIONAL
 * ========================================================================== */

export type FunctionalConversationEngineHandler =
  (
    request: ConversationEngineRequest,
  ) => Promise<ConversationEngineResult>;

export class FunctionalConversationEngine {
  private readonly handler:
    FunctionalConversationEngineHandler;

  public constructor(
    handler:
      FunctionalConversationEngineHandler,
  ) {
    this.handler = handler;
  }

  public run(
    request: ConversationEngineRequest,
  ): Promise<ConversationEngineResult> {
    return this.handler(request);
  }

  public process(
    request: ConversationEngineRequest,
  ): Promise<ConversationEngineResult> {
    return this.handler(request);
  }

  public respond(
    request: ConversationEngineRequest,
  ): Promise<ConversationEngineResult> {
    return this.handler(request);
  }
}

/* ============================================================================
 * ADAPTADORES PARA LOS MÓDULOS EXISTENTES
 * ========================================================================== */

/**
 * Convierte DefaultContextBuilder al contrato del motor.
 */
export function asConversationContextBuilder(
  builder: DefaultContextBuilder,
): ConversationContextBuilder {
  return builder;
}

/**
 * Convierte DefaultIntentDetector al contrato del motor.
 */
export function asConversationIntentDetector(
  detector: DefaultIntentDetector,
): ConversationIntentDetector {
  return detector;
}

/**
 * Convierte DefaultPromptBuilder al contrato del motor.
 */
export function asConversationPromptBuilder(
  builder: DefaultPromptBuilder,
): ConversationPromptBuilder {
  return builder;
}

/**
 * Convierte DefaultResponseValidator al contrato del motor.
 */
export function asConversationResponseValidator(
  validator: DefaultResponseValidator,
): ConversationResponseValidator {
  return validator;
}

/**
 * Convierte MemoryManager al contrato de memoria.
 */
export function asConversationMemoryAdapter(
  memory: MemoryManager,
): ConversationMemoryAdapter {
  return memory;
}

/* ============================================================================
 * FACTORÍAS PÚBLICAS
 * ========================================================================== */

export function createDefaultConversationEngine(
  config: ConversationEngineConfig,
): DefaultConversationEngine {
  return new DefaultConversationEngine(
    config,
  );
}

export function createFunctionalConversationEngine(
  handler:
    FunctionalConversationEngineHandler,
): FunctionalConversationEngine {
  return new FunctionalConversationEngine(
    handler,
  );
}