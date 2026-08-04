import type { AIChatToolCall, AIChatToolDefinition } from "../chat/types.js";
import type { AIMessage } from "../types.js";
import type {
  ToolChatAdapter,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionRequest,
  ToolExecutionResult,
  ToolExecutor,
} from "./types.js";
export function createToolChatAdapter(
  now: () => string = () => new Date().toISOString(),
): ToolChatAdapter {
  return Object.freeze({
    definitions(
      tools: readonly ToolDefinition[],
    ): readonly AIChatToolDefinition[] {
      return Object.freeze(
        tools
          .filter((tool) => tool.descriptor.enabled)
          .map((tool) =>
            Object.freeze({
              name: tool.descriptor.id,
              description: tool.descriptor.description,
              parameters: tool.descriptor.inputSchema,
              requiresConfirmation:
                tool.descriptor.confirmationPolicy !== "never",
              timeoutMilliseconds: tool.descriptor.timeoutMs,
              metadata: Object.freeze({
                version: tool.descriptor.version,
                category: tool.descriptor.category,
                riskLevel: tool.descriptor.riskLevel,
              }),
            }),
          ),
      );
    },
    request(
      call: AIChatToolCall,
      context: ToolExecutionContext,
    ): ToolExecutionRequest {
      return Object.freeze({ call, context });
    },
    resultMessage(result: ToolExecutionResult): AIMessage {
      const timestamp = now();
      const message: AIMessage = {
        id: `tool-message-${result.executionId}`,
        role: "tool",
        name: result.toolId,
        toolCallId: result.executionId,
        content: JSON.stringify({
          status: result.status,
          output: result.output,
          error: result.error,
        }),
        contentType: "json",
        status: result.status === "completed" ? "completed" : "failed",
        createdAt: timestamp,
        updatedAt: timestamp,
        parts: Object.freeze([
          {
            type: "tool-result" as const,
            toolCallId: result.executionId,
            toolName: result.toolId,
            result: result.output,
            isError: result.status !== "completed",
          },
        ]),
        metadata: Object.freeze({
          ...(result.auditId !== undefined ? { auditId: result.auditId } : {}),
          executionStatus: result.status,
        }),
      };
      return Object.freeze(message);
    },
  });
}
export interface ToolRuntimeAdapter {
  executeCalls(
    calls: readonly AIChatToolCall[],
    context: ToolExecutionContext,
  ): Promise<{
    readonly results: readonly ToolExecutionResult[];
    readonly messages: readonly AIMessage[];
  }>;
}
export function createToolRuntimeAdapter(
  executor: ToolExecutor,
  limits: import("./types.js").ToolExecutionLimits = {},
  chat = createToolChatAdapter(),
): ToolRuntimeAdapter {
  return Object.freeze({
    async executeCalls(
      calls: readonly AIChatToolCall[],
      context: ToolExecutionContext,
    ) {
      const results = await executor.executeMany(
        calls.map((call: AIChatToolCall) => chat.request(call, context)),
        limits,
      );
      return Object.freeze({
        results,
        messages: Object.freeze(
          results.map((result) => chat.resultMessage(result)),
        ),
      });
    },
  });
}
