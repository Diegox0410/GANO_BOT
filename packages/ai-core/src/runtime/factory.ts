/** Validación, normalización y creación de AssistantRuntime. */
import { createRuntimeLifecycle } from "./lifecycle.js";
import {
  createConversationRuntimeEventListener,
  createRuntimePipeline,
  RuntimeExecutionContextStore,
} from "./pipeline.js";
import { AssistantRuntime } from "./runtime.js";
import { createRuntimeServices } from "./services.js";
import { RuntimeConfigurationError } from "./errors.js";

import type { AIMetadata } from "../types.js";
import type {
  AssistantCapabilities,
  AssistantDefinition,
  AssistantDescriptor,
  AssistantRuntimeConfig,
  RuntimeDependencies,
} from "./types.js";

export const DEFAULT_ASSISTANT_CAPABILITIES: AssistantCapabilities = Object.freeze({
  conversation: true,
  intentDetection: true,
  contextBuilding: true,
  promptBuilding: true,
  responseValidation: true,
  chatFallback: false,
  embeddings: false,
  memory: false,
  knowledge: false,
  tools: false,
  streaming: false,
});

function normalizeRequiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new RuntimeConfigurationError(`AssistantDefinition requiere un valor válido para "${field}".`);
  }
  return normalized;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized !== undefined && normalized.length > 0 ? normalized : undefined;
}

function freezeMetadata(metadata: AIMetadata | undefined): AIMetadata | undefined {
  return metadata === undefined ? undefined : Object.freeze({ ...metadata });
}

export function createAssistantDefinition(
  descriptor: AssistantDescriptor,
  configuration: AssistantDefinition["configuration"] = {},
): AssistantDefinition {
  const id = normalizeRequiredText(descriptor.id, "descriptor.id");
  const tenantId = normalizeRequiredText(descriptor.tenantId, "descriptor.tenantId");
  const name = normalizeRequiredText(descriptor.name, "descriptor.name");
  const version = normalizeRequiredText(descriptor.version, "descriptor.version");
  const locale = normalizeRequiredText(descriptor.locale, "descriptor.locale");
  const description = normalizeOptionalText(descriptor.description);
  const frozenDescriptor: AssistantDescriptor = Object.freeze({
    id,
    tenantId,
    name,
    ...(description !== undefined ? { description } : {}),
    version,
    locale,
    enabled: descriptor.enabled,
    capabilities: Object.freeze({ ...descriptor.capabilities }),
    ...(descriptor.metadata !== undefined ? { metadata: freezeMetadata(descriptor.metadata) } : {}),
  });
  const primaryChatProviderId = normalizeOptionalText(configuration.primaryChatProviderId);
  const embeddingServiceId = normalizeOptionalText(configuration.embeddingServiceId);
  const fallbackChatProviderIds = Object.freeze(
    (configuration.fallbackChatProviderIds ?? [])
      .map((idValue) => normalizeRequiredText(idValue, "fallbackChatProviderIds"))
      .filter((idValue, index, values) => values.indexOf(idValue) === index),
  );
  const frozenConfiguration = Object.freeze({
    ...configuration,
    ...(primaryChatProviderId !== undefined ? { primaryChatProviderId } : {}),
    fallbackChatProviderIds,
    ...(embeddingServiceId !== undefined ? { embeddingServiceId } : {}),
    ...(configuration.tools !== undefined ? { tools: Object.freeze([...configuration.tools]) } : {}),
    ...(configuration.metadata !== undefined ? { metadata: freezeMetadata(configuration.metadata) } : {}),
  });
  return Object.freeze({ descriptor: frozenDescriptor, configuration: frozenConfiguration });
}

function defaultGenerateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function defaultNow(): string {
  return new Date().toISOString();
}

export class AssistantFactory {
  public constructor(private readonly defaultDependencies?: RuntimeDependencies) {}

  public create(config: AssistantRuntimeConfig): AssistantRuntime {
    const definition = createAssistantDefinition(config.definition.descriptor, config.definition.configuration);
    const dependencies = config.dependencies ?? this.defaultDependencies;
    if (dependencies === undefined) {
      throw new RuntimeConfigurationError("AssistantFactory requiere RuntimeDependencies.", {
        tenantId: definition.descriptor.tenantId,
        assistantId: definition.descriptor.id,
      });
    }
    this.validateCapabilities(definition, dependencies);
    const generateId = dependencies.generateId ?? defaultGenerateId;
    const now = dependencies.now ?? defaultNow;
    const listeners = [
      ...(dependencies.eventListeners ?? []),
      ...(config.hooks?.onEvent === undefined ? [] : [config.hooks.onEvent]),
    ];
    const lifecycle = createRuntimeLifecycle(listeners);
    const contextStore = new RuntimeExecutionContextStore();
    const conversationEventListener = createConversationRuntimeEventListener({
      store: contextStore,
      lifecycle,
      generateId,
    });
    const services = createRuntimeServices({
      definition,
      dependencies,
      lifecycle,
      conversationEventListener,
    });
    const pipeline = createRuntimePipeline({
      definition,
      services,
      lifecycle,
      contextStore,
      hooks: config.hooks,
      generateId,
      now,
    });
    return new AssistantRuntime({ definition, services, pipeline });
  }

  private validateCapabilities(
    definition: AssistantDefinition,
    dependencies: RuntimeDependencies,
  ): void {
    const { capabilities } = definition.descriptor;
    const { configuration } = definition;
    const details = {
      tenantId: definition.descriptor.tenantId,
      assistantId: definition.descriptor.id,
    };
    if (capabilities.memory && dependencies.memory === undefined) {
      throw new RuntimeConfigurationError(
        "El asistente declara capacidad de memoria, pero no recibió ConversationMemoryAdapter.",
        details,
      );
    }
    if (capabilities.knowledge && dependencies.knowledge === undefined) {
      throw new RuntimeConfigurationError(
        "El asistente declara capacidad de conocimiento, pero no recibió ConversationKnowledgeRetriever.",
        details,
      );
    }
    if (capabilities.embeddings && configuration.embeddingServiceId === undefined) {
      throw new RuntimeConfigurationError(
        "El asistente declara capacidad de embeddings, pero no configuró embeddingServiceId.",
        details,
      );
    }
    if (capabilities.chatFallback && (configuration.fallbackChatProviderIds?.length ?? 0) === 0) {
      throw new RuntimeConfigurationError(
        "El asistente declara capacidad de fallback, pero no configuró proveedores alternativos.",
        details,
      );
    }
    if (capabilities.tools && (configuration.tools?.length ?? 0) === 0) {
      throw new RuntimeConfigurationError(
        "El asistente declara capacidad de herramientas, pero no configuró tools.",
        details,
      );
    }
  }
}

export function createAssistantFactory(
  defaultDependencies?: RuntimeDependencies,
): AssistantFactory {
  return new AssistantFactory(defaultDependencies);
}

export function createAssistantRuntime(config: AssistantRuntimeConfig): AssistantRuntime {
  return new AssistantFactory().create(config);
}
