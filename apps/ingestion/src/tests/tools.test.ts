import assert from "node:assert/strict";
import test from "node:test";
import {
  createInMemoryToolAuditSink,
  createOfflineBuiltinTools,
  createToolBuilder,
  createToolChatAdapter,
  createToolExecutor,
  createToolRegistry,
  createToolRuntimeAdapter,
  validateToolArguments,
} from "@gano-bot/ai-core/tools-engine";
import type {
  ToolDefinition,
  ToolExecutionContext,
} from "@gano-bot/ai-core/tools-engine";
const baseContext: ToolExecutionContext = Object.freeze({
  tenantId: "tenant-tools",
  assistantId: "assistant-tools",
  actorId: "actor-tools",
  conversationId: "conversation-tools",
  requestId: "request-tools",
  correlationId: "correlation-tools",
  roles: Object.freeze(["user"]),
  permissions: Object.freeze(["tools.execute"]),
  allowedToolIds: Object.freeze([
    "calculator",
    "current-time",
    "uuid",
    "echo",
    "text-transform",
    "json-inspect",
    "markdown-summary",
    "danger",
    "slow",
  ]),
  allowedCategories: Object.freeze<ToolExecutionContext["allowedCategories"]>([
    "calculation",
    "text",
    "data",
    "system",
    "custom",
  ]),
  maximumRiskLevel: "critical",
  memoryContext: Object.freeze({ authorized: true }),
  ragContext: Object.freeze({ authorizedChunks: 1 }),
});
function call(
  id: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
) {
  return Object.freeze({ id, name, arguments: Object.freeze({ ...args }) });
}
test("Tools Engine offline end-to-end con seguridad, auditoría y adaptadores", async () => {
  const registry = createToolRegistry();
  const builtins = createOfflineBuiltinTools({
    clock: () => new Date("2026-08-04T12:00:00.000Z"),
    generateUuid: () => "00000000-0000-4000-8000-000000000007",
  });
  registry.registerMany(builtins);
  assert.equal(registry.list().length, 7);
  assert.throws(
    () => registry.register(builtins[0] as ToolDefinition),
    /ya existe/,
  );
  registry.disable("echo");
  assert.equal(registry.require("echo").descriptor.enabled, false);
  registry.enable("echo");
  registry.register(builtins[0] as ToolDefinition, true);
  assert.equal(registry.list({ category: "calculation" }).length, 1);
  assert.equal(
    validateToolArguments(
      { operation: "sum", values: [1, 2] },
      {
        type: "object",
        required: ["operation", "values"],
        properties: {
          operation: { type: "string" },
          values: { type: "array", items: { type: "number" } },
        },
        additionalProperties: false,
      },
    ).length,
    0,
  );
  assert.ok(
    validateToolArguments(
      { operation: "sum", values: ["x"] },
      {
        type: "object",
        properties: {
          operation: { type: "string" },
          values: { type: "array", items: { type: "number" } },
        },
      },
    ).length > 0,
  );
  const danger = createToolBuilder()
    .withDescriptor({
      id: "danger",
      name: "danger",
      description: "High risk deterministic test action.",
      version: "1.0.0",
      category: "custom",
      riskLevel: "high",
      inputSchema: {
        type: "object",
        required: ["value"],
        properties: { value: { type: "string" } },
        additionalProperties: false,
      },
      requiredPermissions: ["tools.execute"],
      confirmationPolicy: "always",
      timeoutMs: 1_000,
      enabled: true,
      tenantId: "tenant-tools",
      assistantId: "assistant-tools",
      tags: [],
    })
    .withHandler({
      async execute(args, context) {
        return Object.freeze({
          accepted: args.value,
          hasMemory: context.memoryContext !== undefined,
          hasRag: context.ragContext !== undefined,
        });
      },
    })
    .build();
  const slow = createToolBuilder()
    .withDescriptor({
      id: "slow",
      name: "slow",
      description: "Timeout test.",
      version: "1.0.0",
      category: "custom",
      riskLevel: "safe",
      inputSchema: { type: "object" },
      requiredPermissions: [],
      confirmationPolicy: "never",
      timeoutMs: 5,
      enabled: true,
      tags: [],
    })
    .withHandler({
      async execute() {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return "late";
      },
    })
    .build();
  registry.registerMany([danger, slow]);
  assert.equal(
    registry.list({ tenantId: "other-tenant", category: "custom" }).length,
    1,
  );
  assert.equal(
    registry.list({
      tenantId: "tenant-tools",
      assistantId: "assistant-tools",
      category: "custom",
    }).length,
    2,
  );
  const audit = createInMemoryToolAuditSink();
  let sequence = 0;
  const executor = createToolExecutor({
    registry,
    auditSink: audit,
    now: () => "2026-08-04T12:00:00.000Z",
    generateId: (prefix) => `${prefix}-${++sequence}`,
  });
  const calculator = await executor.execute({
    call: call("call-1", "calculator", { operation: "sum", values: [2, 3, 5] }),
    context: baseContext,
  });
  assert.equal(calculator.status, "completed");
  assert.deepEqual(calculator.output, { result: 10 });
  const denied = await executor.execute({
    call: call("call-2", "calculator", { operation: "sum", values: [1] }),
    context: { ...baseContext, allowedToolIds: [] },
  });
  assert.equal(denied.status, "denied");
  const confirmation = await executor.execute({
    call: call("call-danger", "danger", { value: "safe summary" }),
    context: baseContext,
  });
  assert.equal(confirmation.status, "confirmation-required");
  const confirmed = await executor.execute({
    call: call("call-danger", "danger", { value: "safe summary" }),
    context: { ...baseContext, confirmationIds: ["confirm-call-danger"] },
  });
  assert.equal(confirmed.status, "completed");
  assert.deepEqual(confirmed.output, {
    accepted: "safe summary",
    hasMemory: true,
    hasRag: true,
  });
  const timedOut = await executor.execute({
    call: call("call-slow", "slow", {}),
    context: baseContext,
  });
  assert.equal(timedOut.status, "timed-out");
  const cancelledController = new AbortController();
  cancelledController.abort();
  const cancelled = await executor.execute({
    call: call("call-cancelled", "slow", {}),
    context: { ...baseContext, signal: cancelledController.signal },
  });
  assert.equal(cancelled.status, "cancelled");
  const time = await executor.execute({
    call: call("call-time", "current-time", { timezone: "UTC" }),
    context: baseContext,
  });
  assert.equal(
    (time.output as Readonly<{ iso: string }>).iso,
    "2026-08-04T12:00:00.000Z",
  );
  const uuid = await executor.execute({
    call: call("call-uuid", "uuid", {}),
    context: baseContext,
  });
  assert.equal(
    (uuid.output as Readonly<{ uuid: string }>).uuid,
    "00000000-0000-4000-8000-000000000007",
  );
  const transformed = await executor.execute({
    call: call("call-text", "text-transform", {
      operation: "word-count",
      text: "uno dos tres",
    }),
    context: baseContext,
  });
  assert.deepEqual(transformed.output, { count: 3 });
  assert.equal(
    (
      await executor.execute({
        call: call("call-json", "json-inspect", { json: '{"a":[1,2]}' }),
        context: baseContext,
      })
    ).status,
    "completed",
  );
  assert.equal(
    (
      await executor.execute({
        call: call("call-md", "markdown-summary", {
          markdown: "# Uno\n- a\n## Dos",
        }),
        context: baseContext,
      })
    ).status,
    "completed",
  );
  await assert.rejects(
    executor.executeMany([
      { call: call("loop-1", "echo", { text: "x" }), context: baseContext },
      { call: call("loop-2", "echo", { text: "x" }), context: baseContext },
    ]),
    /repetida/,
  );
  await assert.rejects(
    executor.executeMany(
      [
        { call: call("limit-1", "echo", { text: "a" }), context: baseContext },
        { call: call("limit-2", "echo", { text: "b" }), context: baseContext },
      ],
      { maximumCallsPerTurn: 1 },
    ),
    /máximo/,
  );
  const chat = createToolChatAdapter(() => "2026-08-04T12:00:00.000Z");
  assert.equal(chat.definitions(registry.list()).length, 9);
  const runtime = createToolRuntimeAdapter(
    executor,
    { maximumCallsPerTurn: 2 },
    chat,
  );
  const cycle = await runtime.executeCalls(
    [
      call("provider-call", "calculator", {
        operation: "average",
        values: [2, 4, 6],
      }),
    ],
    baseContext,
  );
  assert.equal(cycle.results[0]?.status, "completed");
  assert.equal(cycle.messages[0]?.role, "tool");
  const finalSimulatedResponse = `Resultado final: ${(cycle.results[0]?.output as Readonly<{ result: number }>).result}`;
  assert.equal(finalSimulatedResponse, "Resultado final: 4");
  assert.ok((await audit.list()).length >= 10);
});
