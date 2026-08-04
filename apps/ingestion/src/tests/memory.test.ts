import assert from "node:assert/strict";
import test from "node:test";
import type { AIMessage } from "@gano-bot/ai-core";
import {
  createInMemoryMemoryEngineStore,
  createMemoryPipeline,
  createMemoryRuntimeAdapter,
  injectMemoryIntoRAGRequest,
} from "@gano-bot/ai-core/memory-engine";
const scope = {
  tenantId: "tenant-memory",
  assistantId: "assistant-memory",
  userId: "user-memory",
  conversationId: "conversation-memory",
  requestId: "request-memory",
  correlationId: "correlation-memory",
};
function message(
  id: string,
  content: string,
  role: AIMessage["role"] = "user",
): AIMessage {
  return Object.freeze({
    id,
    role,
    content,
    contentType: "text",
    status: "completed",
    createdAt: `2026-08-04T00:00:0${id}.000Z`,
    updatedAt: `2026-08-04T00:00:0${id}.000Z`,
  });
}
test("Memory Engine end-to-end: corto/largo plazo, privacidad, TTL, Runtime y RAG", async () => {
  let current = "2026-08-04T00:00:10.000Z";
  const now = () => current;
  const store = createInMemoryMemoryEngineStore(now);
  const pipeline = createMemoryPipeline(
    { store, now },
    {
      maximumMessages: 3,
      maximumCharacters: 120,
      maximumTokens: 30,
      summaryEnabled: true,
      shortTermEnabled: true,
      longTermEnabled: true,
      retention: {
        ttlMilliseconds: 1_000,
        maximumRecordsPerConversation: 8,
        maximumRecordsPerUser: 10,
        consentRequired: true,
        allowedCategories: [
          "conversation",
          "fact",
          "preference",
          "goal",
          "decision",
          "constraint",
          "summary",
        ],
        forbiddenCategories: ["custom"],
      },
    },
  );
  await assert.rejects(
    pipeline.process({
      scope,
      messages: [message("1", "Prefiero respuestas breves.")],
    }),
    /consentimiento/,
  );
  const result = await pipeline.process({
    scope,
    consent: true,
    messages: [
      message("1", "Soy desarrollador."),
      message("2", "Prefiero respuestas breves."),
      message("3", "Mi objetivo es terminar el proyecto."),
      message("4", "Mi contraseña es secreta y token abc."),
      message("5", "Decidí usar TypeScript."),
    ],
  });
  assert.ok(result.messages.length <= 3);
  assert.ok(result.usage.characterCount > 0);
  assert.ok(result.summary?.text.includes("Decidí"));
  assert.ok(
    result.preferences.some((record) => record.content.includes("Prefiero")),
  );
  assert.ok(result.facts.some((record) => record.category === "goal"));
  assert.ok(result.facts.some((record) => record.category === "decision"));
  assert.ok(
    [...result.facts, ...result.preferences].every(
      (record) => !record.content.toLowerCase().includes("contraseña"),
    ),
  );
  const recalled = await pipeline.recall({ scope });
  assert.ok(recalled.messages.length <= 3);
  const otherScope = { ...scope, tenantId: "other-tenant" };
  assert.equal((await store.find({ scope: otherScope })).length, 0);
  const first = (await store.find({ scope }))[0];
  if (first !== undefined)
    await assert.rejects(store.get(first.id, otherScope), /otro scope/);
  const runtime = createMemoryRuntimeAdapter(pipeline, scope);
  const runtimeResults = await runtime.recall({ limit: 10 });
  assert.ok(runtimeResults.length > 0);
  const ragRequest = injectMemoryIntoRAGRequest(
    {
      query: "consulta",
      tenantId: scope.tenantId,
      assistantId: scope.assistantId,
      knowledgeBaseId: "base",
      requestId: scope.requestId,
      correlationId: scope.correlationId,
    },
    recalled,
    now,
  );
  assert.ok(
    ragRequest.history?.some(
      (entry) => entry.metadata?.contextKind === "conversation-memory",
    ),
  );
  assert.equal(
    ragRequest.history?.some(
      (entry) => entry.metadata?.citationEligible === true,
    ),
    false,
  );
  current = "2026-08-04T00:00:12.000Z";
  assert.ok((await store.cleanup(current)) > 0);
  assert.equal((await store.find({ scope })).length, 0);
  await pipeline.process({
    scope,
    consent: true,
    messages: [message("6", "Prefiero modo oscuro.")],
  });
  assert.ok(
    (await pipeline.forget({
      tenantId: scope.tenantId,
      assistantId: scope.assistantId,
      userId: scope.userId,
    })) > 0,
  );
  assert.equal((await store.find({ scope })).length, 0);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    pipeline.process({
      scope,
      consent: true,
      messages: [message("7", "cancelado")],
      signal: controller.signal,
    }),
    /cancelado/,
  );
});
