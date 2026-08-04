import type { CitationBuilder } from "./citations.js";
import type { KnowledgeEmbeddingRegistry } from "./embeddings.js";
import type { KnowledgeIngestionPipeline } from "./ingestion.js";
import type { KnowledgeRegistry } from "./registry.js";
import type { KnowledgeRepository } from "./repository.js";
import type { Retriever } from "./retrieval.js";
import type { KnowledgeConfiguration } from "./types.js";
import type { ConversationKnowledgeRequest, ConversationKnowledgeRetriever } from "../conversationEngine.js";
import type { AIDocumentChunk, AIDocumentSource, AIRetrievedDocument } from "../types.js";

export interface KnowledgeServices {
  readonly configuration: KnowledgeConfiguration;
  readonly registry: KnowledgeRegistry;
  readonly repository: KnowledgeRepository;
  readonly ingestion: KnowledgeIngestionPipeline;
  readonly embeddings?: KnowledgeEmbeddingRegistry;
  readonly retriever?: Retriever;
  readonly citations?: CitationBuilder;
}

export function createKnowledgeServices(services: KnowledgeServices): KnowledgeServices {
  return Object.freeze({ ...services, configuration: Object.freeze({ ...services.configuration }) });
}

export interface ConversationKnowledgeAdapterScope {
  readonly tenantId: string;
  readonly assistantId: string;
  readonly knowledgeBaseId: string;
}

export function createConversationKnowledgeRetrieverAdapter(
  retriever: Retriever,
  scope: ConversationKnowledgeAdapterScope,
): ConversationKnowledgeRetriever {
  return Object.freeze({
    async retrieve(request: ConversationKnowledgeRequest) {
      const result = await retriever.retrieve({
        query: request.query,
        filters: scope,
        limit: request.limit,
        context: {
          requestId: request.requestId,
          correlationId: request.requestId,
          tenantId: scope.tenantId,
          assistantId: scope.assistantId,
          knowledgeBaseId: scope.knowledgeBaseId,
          signal: request.signal,
        },
      });
      const documents: readonly AIRetrievedDocument[] = Object.freeze(result.items.map((item) => {
        const metadata = item.chunk.metadata;
        const source: AIDocumentSource = Object.freeze({
          id: metadata.documentId,
          title: metadata.section ?? metadata.documentId,
          type: "custom",
          ...(metadata.page !== undefined ? { page: metadata.page } : {}),
          ...(metadata.section !== undefined ? { section: metadata.section } : {}),
          metadata: Object.freeze({
            tenantId: metadata.tenantId,
            assistantId: metadata.assistantId,
            knowledgeBaseId: metadata.knowledgeBaseId,
            version: metadata.version,
          }),
        });
        const chunk: AIDocumentChunk = Object.freeze({
          id: item.chunk.id,
          documentId: metadata.documentId,
          content: item.chunk.content,
          index: metadata.chunkIndex,
          ...(item.chunk.tokenCount !== undefined ? { tokenCount: item.chunk.tokenCount } : {}),
          source,
          metadata: metadata.metadata,
        });
        return Object.freeze({ chunk, score: item.score, rank: item.rank, ...(item.reasons !== undefined ? { reasons: item.reasons } : {}) });
      }));
      return Object.freeze({ documents, metadata: Object.freeze({ totalCandidates: result.totalCandidates, durationMilliseconds: result.durationMilliseconds }) });
    },
  });
}
