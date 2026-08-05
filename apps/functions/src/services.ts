import type {
  AIChatToolCall,
  AIMessage,
  AssistantDescriptor,
  AssistantManager,
} from "@gano-bot/ai-core";
import type {
  ToolExecutionContext,
  ToolExecutionResult,
  ToolServices,
} from "@gano-bot/ai-core/tools-engine";
import type { ChatApiRequest, CitationApiResource } from "./contracts.js";
export interface BackendChatTurn {
  readonly message: AIMessage;
  readonly citations: readonly CitationApiResource[];
  readonly toolCalls: readonly AIChatToolCall[];
}
export interface BackendChatGateway {
  generate(input: {
    readonly tenantId: string;
    readonly assistant: AssistantDescriptor;
    readonly conversationId: string;
    readonly actorId: string;
    readonly request: ChatApiRequest;
    readonly messages: readonly AIMessage[];
    readonly toolResults: readonly ToolExecutionResult[];
    readonly signal: AbortSignal;
  }): Promise<BackendChatTurn>;
}

/** Adaptador de inversión de dependencias hacia el Assistant Runtime existente. */
export class AssistantManagerChatGateway implements BackendChatGateway {
  public constructor(private readonly manager: AssistantManager) {}
  public async generate(
    input: Parameters<BackendChatGateway["generate"]>[0],
  ): Promise<BackendChatTurn> {
    const toolResult = input.toolResults.at(-1);
    const toolMessage: AIMessage | undefined =
      toolResult === undefined
        ? undefined
        : Object.freeze({
            id: toolResult.executionId,
            conversationId: input.conversationId,
            role: "tool" as const,
            content: JSON.stringify(
              toolResult.output ?? toolResult.error ?? null,
            ),
            contentType: "json" as const,
            parts: Object.freeze([
              {
                type: "tool-result" as const,
                toolCallId: toolResult.executionId,
                toolName: toolResult.toolId,
                result: toolResult.output,
                isError: toolResult.status !== "completed",
              },
            ]),
            status:
              toolResult.status === "completed"
                ? ("completed" as const)
                : ("failed" as const),
            createdAt: toolResult.completedAt,
            updatedAt: toolResult.completedAt,
            toolCallId: toolResult.executionId,
          });
    const result = await this.manager.execute({
      context: Object.freeze({
        tenantId: input.tenantId,
        assistantId: input.assistant.id,
        requestId:
          input.request.metadata?.requestId?.toString() ?? input.conversationId,
        correlationId:
          input.request.metadata?.correlationId?.toString() ??
          input.conversationId,
        conversationId: input.conversationId,
        actorId: input.actorId,
        locale: input.request.locale,
      }),
      message: input.request.message,
      history:
        toolMessage === undefined
          ? input.messages
          : Object.freeze([...input.messages, toolMessage]),
      useMemory: true,
      useKnowledge: input.request.groundingMode !== "general-allowed",
      signal: input.signal,
      metadata: input.request.metadata,
    });
    return Object.freeze({
      message: result.conversation.assistantMessage,
      toolCalls: result.response.toolCalls,
      citations: Object.freeze(
        result.conversation.citations.map((citation) =>
          Object.freeze({
            id: citation.id,
            title: citation.title,
            documentId: citation.sourceId,
            ...(citation.location?.page !== undefined
              ? { page: citation.location.page }
              : {}),
            ...(citation.location?.section !== undefined
              ? { section: citation.location.section }
              : {}),
            ...(citation.score !== undefined ? { score: citation.score } : {}),
          }),
        ),
      ),
    });
  }
}
export interface ToolLoopLimits {
  readonly maximumRounds: number;
  readonly maximumCalls: number;
  readonly maximumMilliseconds: number;
}
export class ToolLoopOrchestrator {
  public constructor(
    private readonly tools: ToolServices,
    private readonly limits: ToolLoopLimits,
  ) {}
  public async execute(
    calls: readonly AIChatToolCall[],
    context: ToolExecutionContext,
  ): Promise<readonly ToolExecutionResult[]> {
    if (calls.length > this.limits.maximumCalls)
      throw new Error("Se excedió el límite de tool calls.");
    const started = Date.now();
    const seen = new Set<string>();
    const results: ToolExecutionResult[] = [];
    for (const call of calls) {
      const signature = JSON.stringify([call.name, call.arguments]);
      if (seen.has(signature))
        throw new Error("Se detectó un loop de tool calls.");
      seen.add(signature);
      if (Date.now() - started > this.limits.maximumMilliseconds)
        throw new DOMException("Timeout", "AbortError");
      results.push(await this.tools.executor.execute({ call, context }));
    }
    return Object.freeze(results);
  }
}
export class InMemoryMetricsSink {
  private requests = 0;
  private errors = 0;
  private readonly durations: number[] = [];
  private readonly statuses = new Map<string, number>();
  public record(status: number, duration: number): void {
    this.requests += 1;
    if (status >= 400) this.errors += 1;
    this.durations.push(duration);
    const key = String(status);
    this.statuses.set(key, (this.statuses.get(key) ?? 0) + 1);
  }
  public snapshot() {
    return Object.freeze({
      requests: this.requests,
      errors: this.errors,
      durationsMilliseconds: Object.freeze([...this.durations]),
      byStatus: Object.freeze(Object.fromEntries(this.statuses)),
    });
  }
}
export class InMemoryRequestAuditSink {
  private readonly events: import("./contracts.js").RequestAuditEvent[] = [];
  public async write(
    event: import("./contracts.js").RequestAuditEvent,
  ): Promise<void> {
    this.events.push(Object.freeze(event));
  }
  public list(): readonly import("./contracts.js").RequestAuditEvent[] {
    return Object.freeze([...this.events]);
  }
}
export class RedactingLogger {
  public readonly entries: {
    readonly level: string;
    readonly message: string;
    readonly metadata: Readonly<
      Record<string, string | number | boolean | null>
    >;
  }[] = [];
  public log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    metadata: Readonly<Record<string, string | number | boolean | null>>,
  ): void {
    const safe = Object.fromEntries(
      Object.entries(metadata).filter(
        ([name]) => !/(token|secret|key|content|prompt)/i.test(name),
      ),
    );
    this.entries.push(
      Object.freeze({ level, message, metadata: Object.freeze(safe) }),
    );
  }
}
