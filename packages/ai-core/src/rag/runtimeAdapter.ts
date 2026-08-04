import type {
  ConversationKnowledgeRequest,
  ConversationKnowledgeRetriever,
} from "../conversationEngine.js";
import type { RAGPipeline } from "./types.js";
export function createRAGRuntimeAdapter(
  pipeline: RAGPipeline,
  scope: {
    readonly tenantId: string;
    readonly assistantId: string;
    readonly knowledgeBaseId: string;
  },
): ConversationKnowledgeRetriever {
  return Object.freeze({
    async retrieve(request: ConversationKnowledgeRequest) {
      const result = await pipeline.execute({
        query: request.query,
        tenantId: scope.tenantId,
        assistantId: scope.assistantId,
        knowledgeBaseId: scope.knowledgeBaseId,
        requestId: request.requestId,
        correlationId: request.requestId,
        ...(request.signal !== undefined ? { signal: request.signal } : {}),
      });
      return Object.freeze({
        documents: Object.freeze(
          result.selectedChunks.map((item) =>
            Object.freeze({
              chunk: Object.freeze({
                id: item.chunk.id,
                documentId: item.chunk.metadata.documentId,
                content: item.chunk.content,
                index: item.chunk.metadata.chunkIndex,
                source: Object.freeze({
                  id: item.chunk.metadata.documentId,
                  title:
                    item.chunk.metadata.section ??
                    item.chunk.metadata.documentId,
                  type: "custom",
                  ...(item.chunk.metadata.page !== undefined
                    ? { page: item.chunk.metadata.page }
                    : {}),
                  ...(item.chunk.metadata.section !== undefined
                    ? { section: item.chunk.metadata.section }
                    : {}),
                }),
                metadata: item.chunk.metadata.metadata,
              }),
              score: item.score,
              rank: item.rank,
              reasons: item.reasons,
            }),
          ),
        ),
        warnings: result.warnings,
        metadata: Object.freeze({
          ragStatus: result.status,
          citationCount: result.citations.length,
        }),
      });
    },
  });
}
