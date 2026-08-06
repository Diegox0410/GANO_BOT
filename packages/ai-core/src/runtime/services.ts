/** Resolución de servicios concretos y adaptadores del runtime. */
import { createDefaultContextBuilder } from "../contextBuilder.js";
import { createDefaultConversationEngine } from "../conversationEngine.js";
import { createDefaultIntentDetector } from "../intentDetector.js";
import { createDefaultPromptBuilder } from "../promptBuilder.js";
import { createDefaultResponseValidator } from "../responseValidator.js";
import { createFallbackAIChatProvider } from "../chat/fallback.js";
import { RuntimeConfigurationError } from "./errors.js";

import type {
  ConversationEventListener,
  ConversationLLMClient,
  ConversationLLMRequest,
} from "../conversationEngine.js";
import type { AIChatProvider } from "../chat/types.js";
import type {
  AssistantDefinition,
  RuntimeDependencies,
  RuntimeLifecycle,
  RuntimeServices,
} from "./types.js";

function resolveChatProvider(
  definition: AssistantDefinition,
  dependencies: RuntimeDependencies,
): AIChatProvider {
  const configuration = definition.configuration;
  const primary = dependencies.chatProviders.require(configuration.primaryChatProviderId);
  const providerIds = [
    primary.descriptor.id,
    ...(configuration.fallbackChatProviderIds ?? []),
  ];
  const uniqueIds = providerIds.filter((id, index) => providerIds.indexOf(id) === index);
  if (uniqueIds.length === 1) return primary;
  const providers = uniqueIds.map((id) => dependencies.chatProviders.require(id));
  return createFallbackAIChatProvider({
    id: `${definition.descriptor.id}-fallback`,
    displayName: `${definition.descriptor.name} fallback`,
    providers,
  });
}

export interface CreateRuntimeServicesInput {
  readonly definition: AssistantDefinition;
  readonly dependencies: RuntimeDependencies;
  readonly lifecycle: RuntimeLifecycle;
  readonly conversationEventListener?: ConversationEventListener;
}

export function createRuntimeServices(input: CreateRuntimeServicesInput): RuntimeServices {
  const { definition, dependencies, lifecycle } = input;
  const configuration = definition.configuration;
  const chatProvider = resolveChatProvider(definition, dependencies);
  const contextBuilder = dependencies.contextBuilder ?? createDefaultContextBuilder(configuration.context);
  const intentDetector = dependencies.intentDetector ?? createDefaultIntentDetector(configuration.intent);
  const promptConfig = configuration.prompt;
  const promptBuilder = dependencies.promptBuilder ?? createDefaultPromptBuilder({
    ...promptConfig,
    identity: {
      assistantName: definition.descriptor.name,
      description: definition.descriptor.description,
      language: definition.descriptor.locale,
      ...promptConfig?.identity,
    },
    includeKnowledge:
  definition.descriptor.capabilities.knowledge,
  });
  const responseValidator = dependencies.responseValidator ?? createDefaultResponseValidator(configuration.validation);
  const llmClient: ConversationLLMClient = Object.freeze({
    generate: async (request: ConversationLLMRequest) => chatProvider.generate({
      requestId: request.requestId,
      systemPrompt: request.systemPrompt,
      messages: request.messages,
      tools: configuration.tools,
      signal: request.signal,
      metadata: request.metadata,
    }),
  });
  const engineConfig = {
    contextBuilder,
    intentDetector,
    promptBuilder,
    llmClient,
    responseValidator,
    maximumHistoryMessages: configuration.maximumHistoryMessages,
    maximumMemoryEntries: configuration.maximumMemoryEntries,
    persistUserMessage: configuration.persistMessages,
    persistAssistantMessage: configuration.persistMessages,
    rejectInvalidResponse: configuration.rejectInvalidResponse,
    memory: dependencies.memory,
    retriever: dependencies.knowledge,
    conversationStore: dependencies.conversationStore,
    eventListener: input.conversationEventListener,
    generateId: dependencies.generateId === undefined ? undefined : () => dependencies.generateId?.("conversation") ?? "conversation",
    now: dependencies.now,
  };
  const conversationEngine = createDefaultConversationEngine(engineConfig);
  const embeddingServiceId = configuration.embeddingServiceId;
  const embeddingService = embeddingServiceId === undefined
    ? undefined
    : dependencies.embeddings?.require(embeddingServiceId);
  if (embeddingServiceId !== undefined && embeddingService === undefined) {
    throw new RuntimeConfigurationError(
      `El asistente requiere el servicio de embeddings "${embeddingServiceId}", pero no existe un registro de embeddings.`,
      { tenantId: definition.descriptor.tenantId, assistantId: definition.descriptor.id, serviceId: embeddingServiceId },
    );
  }
  return Object.freeze({
    chatProvider,
    ...(embeddingService !== undefined ? { embeddingService } : {}),
    contextBuilder,
    intentDetector,
    promptBuilder,
    responseValidator,
    ...(dependencies.memory !== undefined ? { memory: dependencies.memory } : {}),
    ...(dependencies.knowledge !== undefined ? { knowledge: dependencies.knowledge } : {}),
    ...(dependencies.conversationStore !== undefined ? { conversationStore: dependencies.conversationStore } : {}),
    conversationEngine,
    lifecycle,
  });
}
