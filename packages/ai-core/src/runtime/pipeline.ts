/** Pipeline ejecutable que adapta RuntimeExecution al Conversation Engine. */
import { RuntimeError, RuntimeExecutionError } from "./errors.js";

import type {
  ConversationEngineRequest,
  ConversationEvent,
  ConversationEventListener,
} from "../conversationEngine.js";
import type { AIIdentifier, AIMetadata, AIMessage } from "../types.js";
import type {
  AssistantDefinition,
  RuntimeContext,
  RuntimeExecution,
  RuntimeHooks,
  RuntimeLifecycle,
  RuntimePipeline,
  RuntimeResult,
  RuntimeServices,
} from "./types.js";

function freezeMetadata(metadata: AIMetadata | undefined): AIMetadata | undefined {
  return metadata === undefined ? undefined : Object.freeze({ ...metadata });
}

function isCancellation(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted === true) return true;
  if (error instanceof RuntimeError) return error.code === "EXECUTION_CANCELLED";
  if (error instanceof Error && error.name === "AbortError") return true;
  if (typeof error !== "object" || error === null) return false;
  const value = error as Readonly<Record<string, unknown>>;
  return value["code"] === "REQUEST_CANCELLED";
}

export class RuntimeExecutionContextStore {
  private readonly contexts = new Map<AIIdentifier, RuntimeContext>();

  public set(context: RuntimeContext): void {
    this.contexts.set(context.requestId, context);
  }

  public get(requestId: AIIdentifier): RuntimeContext | undefined {
    return this.contexts.get(requestId);
  }

  public remove(requestId: AIIdentifier): void {
    this.contexts.delete(requestId);
  }
}

export interface CreateConversationRuntimeEventListenerInput {
  readonly store: RuntimeExecutionContextStore;
  readonly lifecycle: RuntimeLifecycle;
  readonly generateId: (prefix: string) => AIIdentifier;
}

export function createConversationRuntimeEventListener(
  input: CreateConversationRuntimeEventListenerInput,
): ConversationEventListener {
  return async (event: ConversationEvent): Promise<void> => {
    const context = input.store.get(event.requestId);
    if (context === undefined) return;
    const terminal = event.status === "completed" || event.status === "failed" || event.status === "cancelled";
    await input.lifecycle.emit(Object.freeze({
      id: input.generateId("runtime-event"),
      type: terminal ? "stage-completed" : "stage-started",
      timestamp: event.timestamp,
      context,
      stage: event.stage,
      ...(event.message !== undefined ? { message: event.message } : {}),
      ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
    }));
  };
}

export interface DefaultRuntimePipelineConfig {
  readonly definition: AssistantDefinition;
  readonly services: RuntimeServices;
  readonly lifecycle: RuntimeLifecycle;
  readonly contextStore: RuntimeExecutionContextStore;
  readonly hooks?: RuntimeHooks;
  readonly generateId: (prefix: string) => AIIdentifier;
  readonly now: () => string;
}

export class DefaultRuntimePipeline implements RuntimePipeline {
  public constructor(private readonly config: DefaultRuntimePipelineConfig) {}

  public async execute(input: RuntimeExecution): Promise<RuntimeResult> {
    const execution = this.config.hooks?.beforeExecution === undefined
      ? input
      : await this.config.hooks.beforeExecution(input);
    this.validateExecution(execution);
    const startedAt = this.config.now();
    const startedAtMilliseconds = Date.now();
    this.config.contextStore.set(execution.context);
    await this.emit("execution-started", execution.context, startedAt);
    try {
      const request = this.createConversationRequest(execution);
      const conversation = await this.config.services.conversationEngine.run(request);
      const completedAt = this.config.now();
      const result: RuntimeResult = Object.freeze({
        context: execution.context,
        assistant: this.config.definition.descriptor,
        response: conversation.llmResponse,
        conversation,
        startedAt,
        completedAt,
        durationMilliseconds: Date.now() - startedAtMilliseconds,
        ...(execution.metadata !== undefined ? { metadata: freezeMetadata(execution.metadata) } : {}),
      });
      const transformed = this.config.hooks?.afterExecution === undefined
        ? result
        : await this.config.hooks.afterExecution(result);
      await this.emit(
        "execution-completed",
        execution.context,
        completedAt,
        transformed.durationMilliseconds,
      );
      return transformed;
    } catch (error) {
      await this.config.hooks?.onError?.(error, execution);
      const cancelled = isCancellation(error, execution.signal);
      await this.emit(
        cancelled ? "execution-cancelled" : "execution-failed",
        execution.context,
        this.config.now(),
        Date.now() - startedAtMilliseconds,
        error,
      );
      if (cancelled) {
        throw new RuntimeError(
          "EXECUTION_CANCELLED",
          "La ejecución del asistente fue cancelada.",
          this.createErrorDetails(execution.context, "pipeline"),
          error,
        );
      }
      if (error instanceof RuntimeError) throw error;
      throw new RuntimeExecutionError(
        "El Assistant Runtime no pudo completar la ejecución.",
        this.createErrorDetails(execution.context, "pipeline"),
        error,
      );
    } finally {
      this.config.contextStore.remove(execution.context.requestId);
    }
  }

  private validateExecution(execution: RuntimeExecution): void {
    const descriptor = this.config.definition.descriptor;
    if (!descriptor.enabled) {
      throw new RuntimeError(
        "ASSISTANT_DISABLED",
        `El asistente "${descriptor.id}" está deshabilitado.`,
        { tenantId: descriptor.tenantId, assistantId: descriptor.id },
      );
    }
    if (execution.context.tenantId !== descriptor.tenantId) {
      throw new RuntimeError(
        "TENANT_MISMATCH",
        "El tenant de la ejecución no coincide con el tenant del asistente.",
        this.createErrorDetails(execution.context, "validation"),
      );
    }
    if (execution.context.assistantId !== descriptor.id) {
      throw new RuntimeError(
        "ASSISTANT_MISMATCH",
        "El asistente de la ejecución no coincide con el runtime seleccionado.",
        this.createErrorDetails(execution.context, "validation"),
      );
    }
    if (execution.context.requestId.trim().length === 0 || execution.context.correlationId.trim().length === 0) {
      throw new RuntimeError(
        "INVALID_RUNTIME_CONFIGURATION",
        "La ejecución requiere requestId y correlationId válidos.",
        this.createErrorDetails(execution.context, "validation"),
      );
    }
  }

  private createConversationRequest(execution: RuntimeExecution): ConversationEngineRequest {
    const context = execution.context;
    const message = typeof execution.message === "string"
      ? this.createUserMessage(execution.message, context)
      : execution.message;
    return {
      requestId: context.requestId,
      conversationId: context.conversationId,
      message,
      ...(context.contextInput !== undefined ? { contextInput: context.contextInput } : {}),
      ...(execution.history !== undefined ? { history: execution.history } : {}),
      ...(execution.validationRules !== undefined ? { validationRules: execution.validationRules } : {}),
      useMemory: execution.useMemory ?? this.config.definition.descriptor.capabilities.memory,
      useKnowledgeRetrieval: execution.useKnowledge ?? false,
      usePlanner: false,
      llmMetadata: Object.freeze({
        tenantId: context.tenantId,
        assistantId: context.assistantId,
        correlationId: context.correlationId,
        ...(context.actorId !== undefined ? { actorId: context.actorId } : {}),
      }),
      metadata: Object.freeze({
        ...(context.metadata ?? {}),
        ...(execution.metadata ?? {}),
        tenantId: context.tenantId,
        assistantId: context.assistantId,
        correlationId: context.correlationId,
      }),
      ...(execution.signal !== undefined ? { signal: execution.signal } : {}),
    };
  }

  private createUserMessage(content: string, context: RuntimeContext): AIMessage {
    const timestamp = this.config.now();
    return Object.freeze({
      id: this.config.generateId("message"),
      conversationId: context.conversationId,
      role: "user",
      content: content.trim(),
      contentType: "text",
      status: "completed",
      createdAt: timestamp,
      updatedAt: timestamp,
      metadata: Object.freeze({
        tenantId: context.tenantId,
        assistantId: context.assistantId,
        correlationId: context.correlationId,
      }),
    });
  }

  private createErrorDetails(context: RuntimeContext, stage: string): {
    readonly tenantId: AIIdentifier;
    readonly assistantId: AIIdentifier;
    readonly requestId: AIIdentifier;
    readonly correlationId: AIIdentifier;
    readonly stage: string;
  } {
    return {
      tenantId: context.tenantId,
      assistantId: context.assistantId,
      requestId: context.requestId,
      correlationId: context.correlationId,
      stage,
    };
  }

  private async emit(
    type: "execution-started" | "execution-completed" | "execution-failed" | "execution-cancelled",
    context: RuntimeContext,
    timestamp: string,
    durationMilliseconds?: number,
    error?: unknown,
  ): Promise<void> {
    await this.config.lifecycle.emit(Object.freeze({
      id: this.config.generateId("runtime-event"),
      type,
      timestamp,
      context,
      ...(durationMilliseconds !== undefined ? { durationMilliseconds } : {}),
      ...(error !== undefined ? { error } : {}),
    }));
  }
}

export function createRuntimePipeline(config: DefaultRuntimePipelineConfig): RuntimePipeline {
  return new DefaultRuntimePipeline(config);
}
