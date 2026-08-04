/** Contratos públicos del Assistant Runtime. */
import type {
  AIContextInput,
  AIIdentifier,
  AIMetadata,
  AIMessage,
  AIResponseValidationRules,
  AIToolDefinition,
} from "../types.js";
import type {
  ConversationContextBuilder,
  ConversationEngineRequest,
  ConversationEngineResult,
  ConversationIntentDetector,
  ConversationKnowledgeRetriever,
  ConversationMemoryAdapter,
  ConversationPromptBuilder,
  ConversationResponseValidator,
  ConversationStore,
  DefaultConversationEngine,
} from "../conversationEngine.js";
import type { ContextBuilderConfig } from "../contextBuilder.js";
import type { IntentDetectorConfig } from "../intentDetector.js";
import type { PromptBuilderConfig } from "../promptBuilder.js";
import type { ResponseValidatorConfig } from "../responseValidator.js";
import type { AIEmbeddingService } from "../embeddings.js";
import type { AIChatProvider, AIChatResponse } from "../chat/types.js";
import type { AIChatProviderRegistry } from "../chat/registry.js";

export interface AssistantCapabilities {
  readonly conversation: boolean;
  readonly intentDetection: boolean;
  readonly contextBuilding: boolean;
  readonly promptBuilding: boolean;
  readonly responseValidation: boolean;
  readonly chatFallback: boolean;
  readonly embeddings: boolean;
  readonly memory: boolean;
  readonly knowledge: boolean;
  readonly tools: boolean;
  readonly streaming: boolean;
}

export interface AssistantDescriptor {
  readonly id: AIIdentifier;
  readonly tenantId: AIIdentifier;
  readonly name: string;
  readonly description?: string;
  readonly version: string;
  readonly locale: string;
  readonly enabled: boolean;
  readonly capabilities: AssistantCapabilities;
  readonly metadata?: AIMetadata;
}

export interface AssistantConfiguration {
  readonly primaryChatProviderId?: string;
  readonly fallbackChatProviderIds?: readonly string[];
  readonly embeddingServiceId?: string;
  readonly context?: ContextBuilderConfig;
  readonly intent?: IntentDetectorConfig;
  readonly prompt?: PromptBuilderConfig;
  readonly validation?: ResponseValidatorConfig;
  readonly tools?: readonly AIToolDefinition[];
  readonly maximumHistoryMessages?: number;
  readonly maximumMemoryEntries?: number;
  readonly persistMessages?: boolean;
  readonly rejectInvalidResponse?: boolean;
  readonly metadata?: AIMetadata;
}

export interface AssistantDefinition {
  readonly descriptor: AssistantDescriptor;
  readonly configuration: AssistantConfiguration;
}

export interface RuntimeContext {
  readonly tenantId: AIIdentifier;
  readonly assistantId: AIIdentifier;
  readonly requestId: AIIdentifier;
  readonly correlationId: AIIdentifier;
  readonly conversationId: AIIdentifier;
  readonly actorId?: AIIdentifier;
  readonly sessionId?: AIIdentifier;
  readonly locale?: string;
  readonly contextInput?: AIContextInput;
  readonly metadata?: AIMetadata;
}

export interface RuntimeExecution {
  readonly context: RuntimeContext;
  readonly message: string | AIMessage;
  readonly history?: readonly AIMessage[];
  readonly validationRules?: AIResponseValidationRules;
  readonly useMemory?: boolean;
  readonly useKnowledge?: boolean;
  readonly signal?: AbortSignal;
  readonly metadata?: AIMetadata;
}

export interface RuntimeResult {
  readonly context: RuntimeContext;
  readonly assistant: AssistantDescriptor;
  readonly response: AIChatResponse;
  readonly conversation: ConversationEngineResult;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMilliseconds: number;
  readonly metadata?: AIMetadata;
}

export type RuntimeEventType =
  | "execution-started"
  | "stage-started"
  | "stage-completed"
  | "execution-completed"
  | "execution-failed"
  | "execution-cancelled";

export interface RuntimeEvent {
  readonly id: AIIdentifier;
  readonly type: RuntimeEventType;
  readonly timestamp: string;
  readonly context: RuntimeContext;
  readonly stage?: string;
  readonly message?: string;
  readonly durationMilliseconds?: number;
  readonly error?: unknown;
  readonly metadata?: AIMetadata;
}

export type RuntimeEventListener = (
  event: RuntimeEvent,
) => void | Promise<void>;

export interface RuntimeHooks {
  readonly beforeExecution?: (
    execution: RuntimeExecution,
  ) => RuntimeExecution | Promise<RuntimeExecution>;
  readonly afterExecution?: (
    result: RuntimeResult,
  ) => RuntimeResult | Promise<RuntimeResult>;
  readonly onError?: (
    error: unknown,
    execution: RuntimeExecution,
  ) => void | Promise<void>;
  readonly onEvent?: RuntimeEventListener;
}

export interface RuntimeLifecycle {
  emit(event: RuntimeEvent): Promise<void>;
  subscribe(listener: RuntimeEventListener): () => void;
}

export interface EmbeddingServiceRegistry {
  register(id: string, service: AIEmbeddingService, replace?: boolean): void;
  has(id: string): boolean;
  get(id: string): AIEmbeddingService | undefined;
  require(id: string): AIEmbeddingService;
  list(): readonly string[];
}

export interface RuntimeDependencies {
  readonly chatProviders: AIChatProviderRegistry;
  readonly embeddings?: EmbeddingServiceRegistry;
  readonly contextBuilder?: ConversationContextBuilder;
  readonly intentDetector?: ConversationIntentDetector;
  readonly promptBuilder?: ConversationPromptBuilder;
  readonly responseValidator?: ConversationResponseValidator;
  readonly memory?: ConversationMemoryAdapter;
  readonly knowledge?: ConversationKnowledgeRetriever;
  readonly conversationStore?: ConversationStore;
  readonly eventListeners?: readonly RuntimeEventListener[];
  readonly generateId?: (prefix: string) => AIIdentifier;
  readonly now?: () => string;
}

export interface RuntimeServices {
  readonly chatProvider: AIChatProvider;
  readonly embeddingService?: AIEmbeddingService;
  readonly contextBuilder: ConversationContextBuilder;
  readonly intentDetector: ConversationIntentDetector;
  readonly promptBuilder: ConversationPromptBuilder;
  readonly responseValidator: ConversationResponseValidator;
  readonly memory?: ConversationMemoryAdapter;
  readonly knowledge?: ConversationKnowledgeRetriever;
  readonly conversationStore?: ConversationStore;
  readonly conversationEngine: DefaultConversationEngine;
  readonly lifecycle: RuntimeLifecycle;
}

export interface AssistantRuntimeConfig {
  readonly definition: AssistantDefinition;
  readonly dependencies?: RuntimeDependencies;
  readonly hooks?: RuntimeHooks;
}

export interface RuntimePipeline {
  execute(execution: RuntimeExecution): Promise<RuntimeResult>;
}

export interface RuntimeRegistryEntry {
  readonly tenantId: AIIdentifier;
  readonly assistantId: AIIdentifier;
  readonly descriptor: AssistantDescriptor;
}

export interface RuntimeConversationAdapter {
  run(request: ConversationEngineRequest): Promise<ConversationEngineResult>;
}
