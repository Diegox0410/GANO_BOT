import type {
  ConversationMemoryAdapter,
  ConversationRememberInput,
} from "../conversationEngine.js";
import type {
  AIMemoryEntry,
  AIMemoryQuery,
  AIMemorySearchResult,
  AIMessage,
} from "../types.js";
import type { RAGRequest } from "../rag/index.js";
import type {
  MemoryCategory,
  MemoryPipeline,
  MemoryRecord,
  MemoryScope,
} from "./types.js";
function mapCategories(
  types: AIMemoryQuery["types"],
): readonly MemoryCategory[] | undefined {
  return types?.map((type) => (type === "observation" ? "conversation" : type));
}
function mapType(
  category: import("./types.js").MemoryCategory,
): AIMemoryEntry["type"] {
  return category === "conversation" ? "observation" : category;
}
export function createMemoryRuntimeAdapter(
  pipeline: MemoryPipeline,
  scope: MemoryScope,
): ConversationMemoryAdapter {
  return Object.freeze({
    async recall(
      query: AIMemoryQuery,
    ): Promise<readonly AIMemorySearchResult[]> {
      const result = await pipeline.recall({
        scope,
        text: query.text,
        categories: mapCategories(query.types),
        limit: query.limit,
        includeExpired: query.includeExpired,
      });
      const records: readonly MemoryRecord[] = [
        ...result.facts,
        ...result.preferences,
        ...(result.summary === undefined
          ? []
          : [
              Object.freeze({
                id: `summary-${scope.conversationId}`,
                scope,
                category: "summary" as const,
                content: result.summary.text,
                source: "system" as const,
                confidence: 1,
                createdAt: result.summary.createdAt,
                updatedAt: result.summary.createdAt,
                status: "active" as const,
                tags: Object.freeze([]),
              }),
            ]),
      ];
      return Object.freeze(
        records.map((record) =>
          Object.freeze({
            entry: Object.freeze({
              id: record.id,
              type: mapType(record.category),
              scope:
                record.category === "preference" || record.category === "fact"
                  ? "user"
                  : "conversation",
              content: record.content,
              importance: 0.7,
              confidence: record.confidence,
              createdAt: record.createdAt,
              updatedAt: record.updatedAt,
              ...(record.expiresAt !== undefined
                ? { expiresAt: record.expiresAt }
                : {}),
              metadata: Object.freeze({
                tenantId: scope.tenantId,
                assistantId: scope.assistantId,
                userId: scope.userId,
                conversationId: scope.conversationId,
              }),
            }),
            score: record.confidence,
            reasons: Object.freeze(["memory-engine"]),
          }),
        ),
      );
    },
    async remember(input: ConversationRememberInput): Promise<AIMemoryEntry> {
      const now = new Date().toISOString();
      const message: AIMessage = Object.freeze({
        id: input.sourceMessageIds?.[0] ?? `runtime-${scope.requestId}`,
        role: "user",
        content: input.content,
        contentType: "text",
        status: "completed",
        createdAt: now,
        updatedAt: now,
      });
      const result = await pipeline.process({
        scope,
        messages: [message],
        consent: true,
      });
      const record = [...result.facts, ...result.preferences][0];
      return Object.freeze({
        id: record?.id ?? `runtime-${scope.requestId}`,
        type: input.type,
        scope: input.scope,
        content: input.content,
        importance: input.importance ?? 0.5,
        confidence: input.confidence ?? 1,
        createdAt: now,
        updatedAt: now,
        sourceMessageIds: input.sourceMessageIds,
        metadata: Object.freeze({
          tenantId: scope.tenantId,
          assistantId: scope.assistantId,
          userId: scope.userId,
          conversationId: scope.conversationId,
        }),
      });
    },
  });
}
export function injectMemoryIntoRAGRequest(
  request: RAGRequest,
  memory: import("./types.js").MemoryResult,
  now: () => string = () => new Date().toISOString(),
): RAGRequest {
  const content = [
    "CONVERSATION MEMORY (not documentary evidence; never cite as a source)",
    memory.summary?.text,
    ...memory.facts.map((fact) => `Fact: ${fact.content}`),
    ...memory.preferences.map(
      (preference) => `Preference: ${preference.content}`,
    ),
  ]
    .filter((value): value is string => value !== undefined && value.length > 0)
    .join("\n");
  if (content.length === 0) return request;
  const timestamp = now();
  const message: AIMessage = Object.freeze({
    id: `memory-context-${request.requestId}`,
    role: "developer",
    content,
    contentType: "text",
    status: "completed",
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: Object.freeze({
      contextKind: "conversation-memory",
      citationEligible: false,
    }),
  });
  return Object.freeze({
    ...request,
    history: Object.freeze([...(request.history ?? []), message]),
  });
}
