    /**
 * @package @gano-bot/ai-core
 * @file types.ts
 * @version 0.2.0
 *
 * Contratos centrales del motor de inteligencia de GANO_BOT.
 *
 * Este archivo contiene únicamente:
 * - Tipos.
 * - Interfaces.
 * - Uniones discriminadas.
 * - Constantes tipadas.
 *
 * No contiene lógica de ejecución ni dependencias de:
 * - React.
 * - Firebase.
 * - OpenAI.
 * - Gemini.
 * - Firestore.
 *
 * Todos los módulos internos de ai-core deben utilizar estos contratos
 * para evitar duplicación de tipos e incompatibilidades.
 */

/* ============================================================================
 * TIPOS PRIMITIVOS
 * ========================================================================== */

export type AIIdentifier = string;

export type AIISODateString = string;

export type AILocale = string;

export type AITimezone = string;

export type AIConfidence = number;

export type AITokenCount = number;

export type AIDurationMilliseconds = number;

export type AIMetadataPrimitive =
  | string
  | number
  | boolean
  | null;

export type AIMetadataValue =
  | AIMetadataPrimitive
  | readonly AIMetadataPrimitive[];

export type AIMetadata =
  Readonly<Record<string, AIMetadataValue>>;

export type AIUnknownRecord =
  Readonly<Record<string, unknown>>;

export type AIMutableUnknownRecord =
  Record<string, unknown>;

/* ============================================================================
 * ESTADOS GENERALES
 * ========================================================================== */

export type AIExecutionStatus =
  | "idle"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type AIProcessingStage =
  | "initializing"
  | "detecting-intent"
  | "building-context"
  | "retrieving-knowledge"
  | "planning"
  | "building-prompt"
  | "generating"
  | "validating"
  | "summarizing"
  | "completed";

export type AIPriority =
  | "low"
  | "normal"
  | "high"
  | "critical";

export type AIEnvironment =
  | "development"
  | "test"
  | "staging"
  | "production";

/* ============================================================================
 * ERRORES
 * ========================================================================== */

export type AIErrorCode =
  | "INVALID_INPUT"
  | "INVALID_CONFIGURATION"
  | "EMPTY_MESSAGE"
  | "MESSAGE_TOO_LONG"
  | "CONTEXT_BUILD_FAILED"
  | "INTENT_DETECTION_FAILED"
  | "MEMORY_ERROR"
  | "PROMPT_BUILD_FAILED"
  | "LLM_ERROR"
  | "LLM_TIMEOUT"
  | "LLM_RATE_LIMIT"
  | "LLM_AUTHENTICATION_ERROR"
  | "LLM_INVALID_RESPONSE"
  | "EMBEDDING_ERROR"
  | "RAG_ERROR"
  | "DOCUMENT_NOT_FOUND"
  | "VECTOR_SEARCH_ERROR"
  | "VALIDATION_ERROR"
  | "PLANNING_ERROR"
  | "TOOL_ERROR"
  | "TOOL_NOT_FOUND"
  | "TOOL_EXECUTION_REJECTED"
  | "TOKEN_LIMIT_EXCEEDED"
  | "REQUEST_CANCELLED"
  | "UNSUPPORTED_OPERATION"
  | "UNKNOWN_ERROR";

export interface AIErrorDetails {
  readonly operation?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly statusCode?: number;
  readonly requestId?: AIIdentifier;
  readonly retryAfterMilliseconds?: number;
  readonly metadata?: AIMetadata;
}

export interface AIError {
  readonly code: AIErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly timestamp: AIISODateString;
  readonly details?: AIErrorDetails;
  readonly cause?: unknown;
}

export interface AIResultSuccess<TValue> {
  readonly ok: true;
  readonly value: TValue;
}

export interface AIResultFailure {
  readonly ok: false;
  readonly error: AIError;
}

export type AIResult<TValue> =
  | AIResultSuccess<TValue>
  | AIResultFailure;

/* ============================================================================
 * MENSAJES Y CONVERSACIONES
 * ========================================================================== */

export type AIMessageRole =
  | "system"
  | "developer"
  | "user"
  | "assistant"
  | "tool";

export type AIMessageStatus =
  | "pending"
  | "completed"
  | "failed"
  | "cancelled";

export type AIMessageContentType =
  | "text"
  | "markdown"
  | "json";

export interface AITextContent {
  readonly type: "text";
  readonly text: string;
}

export interface AIImageContent {
  readonly type: "image";
  readonly url: string;
  readonly mimeType?: string;
  readonly alt?: string;
}

export interface AIFileContent {
  readonly type: "file";
  readonly fileId?: AIIdentifier;
  readonly url?: string;
  readonly name: string;
  readonly mimeType?: string;
  readonly size?: number;
}

export interface AIToolResultContent {
  readonly type: "tool-result";
  readonly toolCallId: AIIdentifier;
  readonly toolName: string;
  readonly result: unknown;
  readonly isError: boolean;
}

export type AIMessageContentPart =
  | AITextContent
  | AIImageContent
  | AIFileContent
  | AIToolResultContent;

export interface AIMessage {
  readonly id: AIIdentifier;
  readonly conversationId?: AIIdentifier;
  readonly role: AIMessageRole;
  readonly content: string;
  readonly contentType: AIMessageContentType;
  readonly parts?: readonly AIMessageContentPart[];
  readonly status: AIMessageStatus;
  readonly createdAt: AIISODateString;
  readonly updatedAt: AIISODateString;
  readonly name?: string;
  readonly toolCallId?: AIIdentifier;
  readonly metadata?: AIMetadata;
}

export interface AIConversation {
  readonly id: AIIdentifier;
  readonly userId?: AIIdentifier;
  readonly sessionId?: AIIdentifier;
  readonly title?: string;
  readonly messages: readonly AIMessage[];
  readonly createdAt: AIISODateString;
  readonly updatedAt: AIISODateString;
  readonly metadata?: AIMetadata;
}

export interface AIConversationSnapshot {
  readonly version: number;
  readonly conversation: AIConversation;
  readonly memory?: AIMemorySnapshot;
  readonly summary?: AIConversationSummary;
  readonly savedAt: AIISODateString;
}

/* ============================================================================
 * CONTEXTO GENERAL
 * ========================================================================== */

export type AIContextDomain =
  | "user"
  | "business"
  | "organization"
  | "qualification"
  | "rank"
  | "income"
  | "products"
  | "wellness"
  | "education"
  | "legal"
  | "missions"
  | "history"
  | "conversation"
  | "application"
  | "custom";

export interface AIContextSection {
  readonly id: AIIdentifier;
  readonly domain: AIContextDomain;
  readonly title: string;
  readonly content: unknown;
  readonly priority: AIPriority;
  readonly source?: string;
  readonly updatedAt?: AIISODateString;
  readonly metadata?: AIMetadata;
}

export interface AIUserContext {
  readonly userId?: AIIdentifier;
  readonly distributorId?: AIIdentifier;
  readonly name?: string;
  readonly email?: string;
  readonly locale?: AILocale;
  readonly timezone?: AITimezone;
  readonly country?: string;
  readonly language?: string;
  readonly authenticated?: boolean;
  readonly metadata?: AIMetadata;
}

export interface AIApplicationContext {
  readonly applicationId?: AIIdentifier;
  readonly applicationName?: string;
  readonly environment?: AIEnvironment;
  readonly currentRoute?: string;
  readonly currentModule?: string;
  readonly currentView?: string;
  readonly sessionId?: AIIdentifier;
  readonly metadata?: AIMetadata;
}

export interface AIBusinessContext {
  readonly rank?: string;
  readonly targetRank?: string;
  readonly packageCode?: string;
  readonly status?: string;
  readonly personalVolume?: number;
  readonly commissionVolume?: number;
  readonly groupCommissionVolume?: number;
  readonly leftLegVolume?: number;
  readonly rightLegVolume?: number;
  readonly weakLegVolume?: number;
  readonly strongLegVolume?: number;
  readonly estimatedIncome?: number;
  readonly currency?: string;
  readonly currentCycleId?: AIIdentifier;
  readonly metadata?: AIMetadata;
}

export interface AIContext {
  readonly requestId: AIIdentifier;
  readonly conversationId?: AIIdentifier;
  readonly generatedAt: AIISODateString;
  readonly user: AIUserContext;
  readonly application: AIApplicationContext;
  readonly business?: AIBusinessContext;
  readonly sections: readonly AIContextSection[];
  readonly metadata?: AIMetadata;
}

export interface AIContextInput {
  readonly requestId?: AIIdentifier;
  readonly conversationId?: AIIdentifier;
  readonly user?: AIUserContext;
  readonly application?: AIApplicationContext;
  readonly business?: AIBusinessContext;
  readonly sections?: readonly AIContextSection[];
  readonly metadata?: AIMetadata;
}

export interface AIContextBuildRequest {
  readonly input: AIContextInput;
  readonly requiredDomains?: readonly AIContextDomain[];
  readonly maximumSections?: number;
  readonly signal?: AbortSignal;
}

export interface AIContextBuildResult {
  readonly context: AIContext;
  readonly warnings: readonly string[];
  readonly omittedDomains: readonly AIContextDomain[];
  readonly durationMilliseconds: AIDurationMilliseconds;
}

/* ============================================================================
 * MEMORIA
 * ========================================================================== */

export type AIMemoryScope =
  | "message"
  | "conversation"
  | "session"
  | "user"
  | "organization"
  | "global";

export type AIMemoryType =
  | "fact"
  | "preference"
  | "goal"
  | "decision"
  | "constraint"
  | "summary"
  | "observation"
  | "custom";

export interface AIMemoryEntry {
  readonly id: AIIdentifier;
  readonly type: AIMemoryType;
  readonly scope: AIMemoryScope;
  readonly content: string;
  readonly importance: number;
  readonly confidence: AIConfidence;
  readonly createdAt: AIISODateString;
  readonly updatedAt: AIISODateString;
  readonly expiresAt?: AIISODateString;
  readonly sourceMessageIds?: readonly AIIdentifier[];
  readonly metadata?: AIMetadata;
}

export interface AIMemoryQuery {
  readonly text?: string;
  readonly types?: readonly AIMemoryType[];
  readonly scopes?: readonly AIMemoryScope[];
  readonly minimumImportance?: number;
  readonly minimumConfidence?: AIConfidence;
  readonly limit?: number;
  readonly includeExpired?: boolean;
}

export interface AIMemorySearchResult {
  readonly entry: AIMemoryEntry;
  readonly score: number;
  readonly reasons?: readonly string[];
}

export interface AIMemorySnapshot {
  readonly version: number;
  readonly entries: readonly AIMemoryEntry[];
  readonly createdAt: AIISODateString;
  readonly updatedAt: AIISODateString;
  readonly metadata?: AIMetadata;
}

export interface AIMemoryStore {
  get(
    id: AIIdentifier,
  ): Promise<AIMemoryEntry | null>;

  list(): Promise<readonly AIMemoryEntry[]>;

  search(
    query: AIMemoryQuery,
  ): Promise<readonly AIMemorySearchResult[]>;

  save(
    entry: AIMemoryEntry,
  ): Promise<void>;

  saveMany(
    entries: readonly AIMemoryEntry[],
  ): Promise<void>;

  remove(
    id: AIIdentifier,
  ): Promise<boolean>;

  clear(
    scope?: AIMemoryScope,
  ): Promise<void>;

  exportSnapshot(): Promise<AIMemorySnapshot>;

  importSnapshot(
    snapshot: AIMemorySnapshot,
  ): Promise<void>;
}

/* ============================================================================
 * INTENCIONES
 * ========================================================================== */

export type AIIntentName =
  | "general_question"
  | "greeting"
  | "help"
  | "business_summary"
  | "rank_progress"
  | "rank_requirements"
  | "income_estimation"
  | "binary_analysis"
  | "organization_analysis"
  | "qualification_status"
  | "product_information"
  | "wellness_information"
  | "educational_content"
  | "legal_information"
  | "mission_recommendation"
  | "next_best_action"
  | "document_search"
  | "conversation_summary"
  | "tool_request"
  | "unknown";

export interface AIIntentEntity {
  readonly name: string;
  readonly value: string;
  readonly normalizedValue?: string;
  readonly confidence: AIConfidence;
  readonly metadata?: AIMetadata;
}

export interface AIIntentCandidate {
  readonly name: AIIntentName;
  readonly confidence: AIConfidence;
  readonly reason?: string;
}

export interface AIIntentDetection {
  readonly primary: AIIntentCandidate;
  readonly alternatives: readonly AIIntentCandidate[];
  readonly entities: readonly AIIntentEntity[];
  readonly requiresBusinessData: boolean;
  readonly requiresKnowledgeRetrieval: boolean;
  readonly requiresTools: boolean;
  readonly language?: string;
  readonly metadata?: AIMetadata;
}

export interface AIIntentDetectionRequest {
  readonly message: AIMessage;
  readonly history?: readonly AIMessage[];
  readonly context?: AIContext;
  readonly signal?: AbortSignal;
}

export interface AIIntentDetector {
  detect(
    request: AIIntentDetectionRequest,
  ): Promise<AIIntentDetection>;
}

/* ============================================================================
 * PROMPTS
 * ========================================================================== */

export type AIPromptSectionType =
  | "identity"
  | "instructions"
  | "safety"
  | "user"
  | "business"
  | "context"
  | "memory"
  | "knowledge"
  | "tools"
  | "output-format"
  | "custom";

export interface AIPromptSection {
  readonly id: AIIdentifier;
  readonly type: AIPromptSectionType;
  readonly title?: string;
  readonly content: string;
  readonly priority: AIPriority;
  readonly enabled: boolean;
  readonly metadata?: AIMetadata;
}

export interface AIPromptTemplateVariable {
  readonly key: string;
  readonly value: string;
  readonly required: boolean;
}

export interface AIPromptTemplate {
  readonly id: AIIdentifier;
  readonly name: string;
  readonly template: string;
  readonly variables: readonly string[];
  readonly version: number;
  readonly metadata?: AIMetadata;
}

export interface AIBuiltPrompt {
  readonly systemPrompt: string;
  readonly messages: readonly AIMessage[];
  readonly sections: readonly AIPromptSection[];
  readonly estimatedTokens: AITokenCount;
  readonly truncated: boolean;
  readonly warnings: readonly string[];
  readonly metadata?: AIMetadata;
}

export interface AIPromptBuildRequest {
  readonly userMessage: AIMessage;
  readonly history: readonly AIMessage[];
  readonly context: AIContext;
  readonly memory?: readonly AIMemoryEntry[];
  readonly documents?: readonly AIRetrievedDocument[];
  readonly plan?: AIExecutionPlan;
  readonly maximumTokens?: AITokenCount;
}

export interface AIPromptBuilder {
  build(
    request: AIPromptBuildRequest,
  ): Promise<AIBuiltPrompt>;
}

/* ============================================================================
 * MODELOS DE LENGUAJE
 * ========================================================================== */

export type AILLMProviderName =
  | "openai"
  | "azure-openai"
  | "google"
  | "anthropic"
  | "ollama"
  | "lm-studio"
  | "custom";

export type AILLMFinishReason =
  | "stop"
  | "length"
  | "tool_calls"
  | "content_filter"
  | "cancelled"
  | "error"
  | "unknown";

export interface AILLMModel {
  readonly provider: AILLMProviderName;
  readonly model: string;
  readonly displayName?: string;
  readonly contextWindow?: AITokenCount;
  readonly maximumOutputTokens?: AITokenCount;
  readonly supportsStreaming?: boolean;
  readonly supportsTools?: boolean;
  readonly supportsImages?: boolean;
  readonly supportsJson?: boolean;
  readonly metadata?: AIMetadata;
}

export interface AILLMGenerationOptions {
  readonly temperature?: number;
  readonly topP?: number;
  readonly topK?: number;
  readonly maximumOutputTokens?: AITokenCount;
  readonly stopSequences?: readonly string[];
  readonly seed?: number;
  readonly responseFormat?: "text" | "json";
}

export interface AILLMUsage {
  readonly inputTokens: AITokenCount;
  readonly outputTokens: AITokenCount;
  readonly totalTokens: AITokenCount;
  readonly cachedInputTokens?: AITokenCount;
  readonly reasoningTokens?: AITokenCount;
}

export interface AILLMRequest {
  readonly requestId: AIIdentifier;
  readonly model?: string;
  readonly systemPrompt?: string;
  readonly messages: readonly AIMessage[];
  readonly tools?: readonly AIToolDefinition[];
  readonly options?: AILLMGenerationOptions;
  readonly signal?: AbortSignal;
  readonly metadata?: AIMetadata;
}

export interface AILLMResponse {
  readonly id: AIIdentifier;
  readonly requestId: AIIdentifier;
  readonly provider: AILLMProviderName;
  readonly model: string;
  readonly content: string;
  readonly message: AIMessage;
  readonly toolCalls: readonly AIToolCall[];
  readonly finishReason: AILLMFinishReason;
  readonly usage?: AILLMUsage;
  readonly createdAt: AIISODateString;
  readonly durationMilliseconds?: AIDurationMilliseconds;
  readonly raw?: unknown;
  readonly metadata?: AIMetadata;
}

export interface AILLMStreamTextDelta {
  readonly type: "text-delta";
  readonly delta: string;
}

export interface AILLMStreamToolCallDelta {
  readonly type: "tool-call-delta";
  readonly toolCallId: AIIdentifier;
  readonly toolName?: string;
  readonly argumentsDelta?: string;
}

export interface AILLMStreamUsage {
  readonly type: "usage";
  readonly usage: AILLMUsage;
}

export interface AILLMStreamCompleted {
  readonly type: "completed";
  readonly finishReason: AILLMFinishReason;
}

export interface AILLMStreamError {
  readonly type: "error";
  readonly error: AIError;
}

export type AILLMStreamEvent =
  | AILLMStreamTextDelta
  | AILLMStreamToolCallDelta
  | AILLMStreamUsage
  | AILLMStreamCompleted
  | AILLMStreamError;

export interface AILLMProvider {
  readonly name: AILLMProviderName;

  listModels?(): Promise<readonly AILLMModel[]>;

  generate(
    request: AILLMRequest,
  ): Promise<AILLMResponse>;

  stream?(
    request: AILLMRequest,
  ): AsyncIterable<AILLMStreamEvent>;
}

/* ============================================================================
 * HERRAMIENTAS
 * ========================================================================== */

export type AIToolParameterType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "array"
  | "object";

export interface AIToolParameterSchema {
  readonly type: AIToolParameterType;
  readonly description?: string;
  readonly enum?: readonly AIMetadataPrimitive[];
  readonly items?: AIToolParameterSchema;
  readonly properties?: Readonly<
    Record<string, AIToolParameterSchema>
  >;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

export interface AIToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: AIToolParameterSchema;
  readonly requiresConfirmation?: boolean;
  readonly timeoutMilliseconds?: number;
  readonly metadata?: AIMetadata;
}

export interface AIToolCall {
  readonly id: AIIdentifier;
  readonly name: string;
  readonly arguments: AIUnknownRecord;
  readonly createdAt?: AIISODateString;
  readonly metadata?: AIMetadata;
}

export interface AIToolExecutionRequest {
  readonly call: AIToolCall;
  readonly context: AIContext;
  readonly signal?: AbortSignal;
}

export interface AIToolExecutionResult {
  readonly toolCallId: AIIdentifier;
  readonly toolName: string;
  readonly success: boolean;
  readonly output?: unknown;
  readonly error?: AIError;
  readonly durationMilliseconds: AIDurationMilliseconds;
  readonly metadata?: AIMetadata;
}

export interface AITool {
  readonly definition: AIToolDefinition;

  execute(
    request: AIToolExecutionRequest,
  ): Promise<AIToolExecutionResult>;
}

export interface AIToolRegistry {
  register(
    tool: AITool,
  ): void;

  unregister(
    name: string,
  ): boolean;

  get(
    name: string,
  ): AITool | null;

  list(): readonly AIToolDefinition[];

  execute(
    request: AIToolExecutionRequest,
  ): Promise<AIToolExecutionResult>;
}

/* ============================================================================
 * EMBEDDINGS
 * ========================================================================== */

export type AIEmbeddingVector =
  readonly number[];

export interface AIEmbeddingModel {
  readonly provider: string;
  readonly model: string;
  readonly dimensions?: number;
  readonly maximumInputTokens?: AITokenCount;
  readonly metadata?: AIMetadata;
}

export interface AIEmbeddingInput {
  readonly id: AIIdentifier;
  readonly text: string;
  readonly metadata?: AIMetadata;
}

export interface AIEmbedding {
  readonly id: AIIdentifier;
  readonly vector: AIEmbeddingVector;
  readonly dimensions: number;
  readonly model: string;
  readonly createdAt: AIISODateString;
  readonly metadata?: AIMetadata;
}

export interface AIEmbeddingRequest {
  readonly inputs: readonly AIEmbeddingInput[];
  readonly model?: string;
  readonly signal?: AbortSignal;
}

export interface AIEmbeddingResponse {
  readonly embeddings: readonly AIEmbedding[];
  readonly model: string;
  readonly usageTokens?: AITokenCount;
  readonly durationMilliseconds?: AIDurationMilliseconds;
}

export interface AIEmbeddingProvider {
  embed(
    request: AIEmbeddingRequest,
  ): Promise<AIEmbeddingResponse>;
}

/* ============================================================================
 * RAG Y DOCUMENTOS
 * ========================================================================== */

export type AIDocumentType =
  | "product"
  | "compensation-plan"
  | "business-rule"
  | "wellness"
  | "legal"
  | "education"
  | "faq"
  | "manual"
  | "policy"
  | "testimonial"
  | "conversation"
  | "custom";

export interface AIDocumentSource {
  readonly id: AIIdentifier;
  readonly title: string;
  readonly type: AIDocumentType;
  readonly uri?: string;
  readonly fileName?: string;
  readonly page?: number;
  readonly section?: string;
  readonly author?: string;
  readonly publishedAt?: AIISODateString;
  readonly metadata?: AIMetadata;
}

export interface AIDocumentChunk {
  readonly id: AIIdentifier;
  readonly documentId: AIIdentifier;
  readonly content: string;
  readonly index: number;
  readonly tokenCount?: AITokenCount;
  readonly source: AIDocumentSource;
  readonly embedding?: AIEmbeddingVector;
  readonly metadata?: AIMetadata;
}

export interface AIRetrievalFilter {
  readonly documentTypes?: readonly AIDocumentType[];
  readonly documentIds?: readonly AIIdentifier[];
  readonly tags?: readonly string[];
  readonly metadata?: AIMetadata;
}

export interface AIRetrievalRequest {
  readonly query: string;
  readonly embedding?: AIEmbeddingVector;
  readonly limit?: number;
  readonly minimumScore?: number;
  readonly filters?: AIRetrievalFilter;
  readonly signal?: AbortSignal;
}

export interface AIRetrievedDocument {
  readonly chunk: AIDocumentChunk;
  readonly score: number;
  readonly rank: number;
  readonly reasons?: readonly string[];
}

export interface AIRetrievalResponse {
  readonly query: string;
  readonly documents: readonly AIRetrievedDocument[];
  readonly totalCandidates?: number;
  readonly durationMilliseconds: AIDurationMilliseconds;
  readonly metadata?: AIMetadata;
}

export interface AIRetriever {
  retrieve(
    request: AIRetrievalRequest,
  ): Promise<AIRetrievalResponse>;
}

export interface AIRAGRequest {
  readonly query: string;
  readonly context?: AIContext;
  readonly intent?: AIIntentDetection;
  readonly limit?: number;
  readonly minimumScore?: number;
  readonly filters?: AIRetrievalFilter;
  readonly signal?: AbortSignal;
}

export interface AIRAGResult {
  readonly documents: readonly AIRetrievedDocument[];
  readonly citations: readonly AICitation[];
  readonly contextText: string;
  readonly warnings: readonly string[];
  readonly durationMilliseconds: AIDurationMilliseconds;
}

/* ============================================================================
 * CITAS Y REFERENCIAS
 * ========================================================================== */

export type AICitationType =
  | "document"
  | "web"
  | "database"
  | "business-engine"
  | "user-data"
  | "conversation"
  | "custom";

export interface AICitationLocation {
  readonly page?: number;
  readonly section?: string;
  readonly paragraph?: number;
  readonly startOffset?: number;
  readonly endOffset?: number;
}

export interface AICitation {
  readonly id: AIIdentifier;
  readonly type: AICitationType;
  readonly title: string;
  readonly sourceId: AIIdentifier;
  readonly uri?: string;
  readonly excerpt?: string;
  readonly location?: AICitationLocation;
  readonly score?: number;
  readonly metadata?: AIMetadata;
}

export interface AICitationReference {
  readonly citationId: AIIdentifier;
  readonly startOffset?: number;
  readonly endOffset?: number;
}

export interface AICitedResponse {
  readonly content: string;
  readonly citations: readonly AICitation[];
  readonly references: readonly AICitationReference[];
}

/* ============================================================================
 * TOKENIZACIÓN
 * ========================================================================== */

export interface AITokenEstimate {
  readonly textLength: number;
  readonly estimatedTokens: AITokenCount;
  readonly model?: string;
}

export interface AITokenBudget {
  readonly maximumContextTokens: AITokenCount;
  readonly reservedOutputTokens: AITokenCount;
  readonly availableInputTokens: AITokenCount;
  readonly usedInputTokens: AITokenCount;
  readonly remainingInputTokens: AITokenCount;
  readonly exceeded: boolean;
}

export interface AITruncationResult<TValue> {
  readonly value: TValue;
  readonly originalTokens: AITokenCount;
  readonly finalTokens: AITokenCount;
  readonly truncated: boolean;
  readonly removedItems: number;
  readonly warnings: readonly string[];
}

export interface AITokenizer {
  estimateText(
    text: string,
    model?: string,
  ): AITokenEstimate;

  estimateMessages(
    messages: readonly AIMessage[],
    model?: string,
  ): AITokenEstimate;

  createBudget(
    maximumContextTokens: AITokenCount,
    reservedOutputTokens: AITokenCount,
    usedInputTokens: AITokenCount,
  ): AITokenBudget;
}

/* ============================================================================
 * RESÚMENES
 * ========================================================================== */

export interface AIConversationSummary {
  readonly id: AIIdentifier;
  readonly conversationId: AIIdentifier;
  readonly content: string;
  readonly coveredMessageIds: readonly AIIdentifier[];
  readonly keyFacts: readonly string[];
  readonly decisions: readonly string[];
  readonly goals: readonly string[];
  readonly unresolvedQuestions: readonly string[];
  readonly createdAt: AIISODateString;
  readonly updatedAt: AIISODateString;
  readonly estimatedTokens?: AITokenCount;
  readonly metadata?: AIMetadata;
}

export interface AISummarizationRequest {
  readonly conversationId: AIIdentifier;
  readonly messages: readonly AIMessage[];
  readonly previousSummary?: AIConversationSummary;
  readonly maximumTokens?: AITokenCount;
  readonly signal?: AbortSignal;
}

export interface AISummarizer {
  summarize(
    request: AISummarizationRequest,
  ): Promise<AIConversationSummary>;
}

/* ============================================================================
 * VALIDACIÓN DE RESPUESTAS
 * ========================================================================== */

export type AIValidationSeverity =
  | "info"
  | "warning"
  | "error";

export interface AIValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly severity: AIValidationSeverity;
  readonly path?: string;
  readonly metadata?: AIMetadata;
}

export interface AIResponseValidationRules {
  readonly requireContent?: boolean;
  readonly requireCitations?: boolean;
  readonly minimumLength?: number;
  readonly maximumLength?: number;
  readonly allowedContentTypes?: readonly AIMessageContentType[];
  readonly forbiddenTerms?: readonly string[];
}

export interface AIResponseValidationRequest {
  readonly response: AILLMResponse;
  readonly context?: AIContext;
  readonly intent?: AIIntentDetection;
  readonly citations?: readonly AICitation[];
  readonly rules?: AIResponseValidationRules;
}

export interface AIResponseValidationResult {
  readonly valid: boolean;
  readonly issues: readonly AIValidationIssue[];
  readonly sanitizedContent: string;
  readonly citations: readonly AICitation[];
  readonly metadata?: AIMetadata;
}

export interface AIResponseValidator {
  validate(
    request: AIResponseValidationRequest,
  ): Promise<AIResponseValidationResult>;
}

/* ============================================================================
 * PLANIFICACIÓN
 * ========================================================================== */

export type AIPlanStepType =
  | "detect-intent"
  | "build-context"
  | "search-memory"
  | "retrieve-knowledge"
  | "execute-tool"
  | "build-prompt"
  | "generate-response"
  | "validate-response"
  | "summarize"
  | "custom";

export interface AIPlanStepBase {
  readonly id: AIIdentifier;
  readonly type: AIPlanStepType;
  readonly name: string;
  readonly description?: string;
  readonly priority: AIPriority;
  readonly dependsOn: readonly AIIdentifier[];
  readonly optional: boolean;
  readonly metadata?: AIMetadata;
}

export interface AIPlanStandardStep
  extends AIPlanStepBase {
  readonly type:
    | "detect-intent"
    | "build-context"
    | "search-memory"
    | "retrieve-knowledge"
    | "build-prompt"
    | "generate-response"
    | "validate-response"
    | "summarize"
    | "custom";
}

export interface AIPlanToolStep
  extends AIPlanStepBase {
  readonly type: "execute-tool";
  readonly toolName: string;
  readonly arguments: AIUnknownRecord;
  readonly requiresConfirmation: boolean;
}

export type AIPlanStep =
  | AIPlanStandardStep
  | AIPlanToolStep;

export interface AIExecutionPlan {
  readonly id: AIIdentifier;
  readonly requestId: AIIdentifier;
  readonly intent: AIIntentDetection;
  readonly steps: readonly AIPlanStep[];
  readonly requiresKnowledgeRetrieval: boolean;
  readonly requiresBusinessData: boolean;
  readonly requiresTools: boolean;
  readonly estimatedComplexity:
    | "low"
    | "medium"
    | "high";
  readonly createdAt: AIISODateString;
  readonly metadata?: AIMetadata;
}

export interface AIPlanningRequest {
  readonly requestId: AIIdentifier;
  readonly message: AIMessage;
  readonly intent: AIIntentDetection;
  readonly context?: AIContext;
  readonly availableTools?: readonly AIToolDefinition[];
  readonly metadata?: AIMetadata;
}

export interface AIPlanner {
  createPlan(
    request: AIPlanningRequest,
  ): Promise<AIExecutionPlan>;
}

/* ============================================================================
 * EJECUCIÓN DEL MOTOR DE CONVERSACIÓN
 * ========================================================================== */

export interface AIConversationRequest {
  readonly requestId?: AIIdentifier;
  readonly conversationId?: AIIdentifier;
  readonly userId?: AIIdentifier;
  readonly sessionId?: AIIdentifier;
  readonly message: string;
  readonly history?: readonly AIMessage[];
  readonly context?: AIContextInput;
  readonly metadata?: AIMetadata;
  readonly signal?: AbortSignal;
}

export interface AIExecutionTraceEvent {
  readonly id: AIIdentifier;
  readonly requestId: AIIdentifier;
  readonly stage: AIProcessingStage;
  readonly status: AIExecutionStatus;
  readonly startedAt: AIISODateString;
  readonly completedAt?: AIISODateString;
  readonly durationMilliseconds?: AIDurationMilliseconds;
  readonly message?: string;
  readonly error?: AIError;
  readonly metadata?: AIMetadata;
}

export interface AIConversationResponse {
  readonly requestId: AIIdentifier;
  readonly conversationId: AIIdentifier;
  readonly message: AIMessage;
  readonly intent: AIIntentDetection;
  readonly context: AIContext;
  readonly plan: AIExecutionPlan;
  readonly citations: readonly AICitation[];
  readonly usage?: AILLMUsage;
  readonly trace: readonly AIExecutionTraceEvent[];
  readonly durationMilliseconds: AIDurationMilliseconds;
  readonly metadata?: AIMetadata;
}

export interface AIConversationEngine {
  process(
    request: AIConversationRequest,
  ): Promise<AIConversationResponse>;
}

/* ============================================================================
 * EVENTOS
 * ========================================================================== */

export type AIEngineEventType =
  | "request-started"
  | "stage-started"
  | "stage-completed"
  | "intent-detected"
  | "context-built"
  | "knowledge-retrieved"
  | "plan-created"
  | "tool-started"
  | "tool-completed"
  | "generation-started"
  | "generation-completed"
  | "validation-completed"
  | "request-completed"
  | "request-failed"
  | "request-cancelled";

export interface AIEngineEvent {
  readonly id: AIIdentifier;
  readonly type: AIEngineEventType;
  readonly requestId: AIIdentifier;
  readonly timestamp: AIISODateString;
  readonly payload?: unknown;
  readonly metadata?: AIMetadata;
}

export type AIEngineEventListener = (
  event: AIEngineEvent,
) => void;

export type AIEngineEventUnsubscribe =
  () => void;

/* ============================================================================
 * CONFIGURACIÓN DEL NÚCLEO
 * ========================================================================== */

export interface AICoreLimits {
  readonly maximumMessageLength: number;
  readonly maximumHistoryMessages: number;
  readonly maximumContextSections: number;
  readonly maximumContextTokens: AITokenCount;
  readonly reservedOutputTokens: AITokenCount;
  readonly maximumRetrievedDocuments: number;
  readonly minimumRetrievalScore: number;
  readonly requestTimeoutMilliseconds: number;
}

export interface AICoreFeatures {
  readonly memory: boolean;
  readonly rag: boolean;
  readonly citations: boolean;
  readonly tools: boolean;
  readonly planning: boolean;
  readonly responseValidation: boolean;
  readonly automaticSummarization: boolean;
  readonly executionTrace: boolean;
}

export interface AICoreConfig {
  readonly environment: AIEnvironment;
  readonly defaultLocale: AILocale;
  readonly defaultTimezone: AITimezone;
  readonly defaultModel?: string;
  readonly limits: AICoreLimits;
  readonly features: AICoreFeatures;
  readonly metadata?: AIMetadata;
}

/* ============================================================================
 * CONSTANTES PREDETERMINADAS
 * ========================================================================== */

export const AI_CORE_TYPES_VERSION =
  1 as const;

export const DEFAULT_AI_CORE_LIMITS:
  AICoreLimits = Object.freeze({
    maximumMessageLength: 8_000,
    maximumHistoryMessages: 30,
    maximumContextSections: 50,
    maximumContextTokens: 32_000,
    reservedOutputTokens: 4_000,
    maximumRetrievedDocuments: 8,
    minimumRetrievalScore: 0.65,
    requestTimeoutMilliseconds: 60_000,
  });

export const DEFAULT_AI_CORE_FEATURES:
  AICoreFeatures = Object.freeze({
    memory: true,
    rag: true,
    citations: true,
    tools: true,
    planning: true,
    responseValidation: true,
    automaticSummarization: true,
    executionTrace: true,
  });

export const EMPTY_AI_METADATA:
  AIMetadata = Object.freeze({});

export const EMPTY_AI_USER_CONTEXT:
  AIUserContext = Object.freeze({});

export const EMPTY_AI_APPLICATION_CONTEXT:
  AIApplicationContext = Object.freeze({});

export const EMPTY_AI_BUSINESS_CONTEXT:
  AIBusinessContext = Object.freeze({});