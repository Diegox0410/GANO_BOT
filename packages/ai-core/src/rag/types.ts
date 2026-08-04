import type { AIChatProvider, AIChatResponse } from "../chat/types.js";
import type { AIEmbeddingService } from "../embeddings.js";
import type {
  AIEmbeddingVector,
  AIIdentifier,
  AIMetadata,
  AIMessage,
} from "../types.js";
import type {
  Citation,
  CitationBuilder,
  KnowledgeChunk,
  KnowledgeOperationContext,
  KnowledgeRepository,
  RetrievalResultItem,
  Retriever,
  VectorStore,
} from "../knowledge/index.js";

export type RAGGroundingMode =
  | "strict-private-knowledge"
  | "private-knowledge-preferred"
  | "general-knowledge-allowed";
export type RAGStatus = "completed" | "insufficient-evidence" | "failed";
export interface RAGContextBudget {
  readonly maximumCharacters?: number;
  readonly maximumTokens?: number;
  readonly maximumChunks?: number;
  readonly maximumChunksPerDocument?: number;
}
export interface RAGConfiguration {
  readonly groundingMode: RAGGroundingMode;
  readonly topK?: number;
  readonly maximumTopK?: number;
  readonly minimumScore?: number;
  readonly maximumQueryCharacters?: number;
  readonly contextBudget?: RAGContextBudget;
  readonly embeddingModel?: string;
  readonly citationsEnabled?: boolean;
  readonly insufficientEvidenceMessage?: string;
  readonly allowGeneralKnowledgeSupplement?: boolean;
}
export interface RAGRequest {
  readonly query: string;
  readonly tenantId: AIIdentifier;
  readonly assistantId: AIIdentifier;
  readonly knowledgeBaseId: AIIdentifier;
  readonly requestId: AIIdentifier;
  readonly correlationId: AIIdentifier;
  readonly actorId?: AIIdentifier;
  readonly actorRoleIds?: readonly AIIdentifier[];
  readonly documentIds?: readonly AIIdentifier[];
  readonly tags?: readonly string[];
  readonly language?: string;
  readonly history?: readonly AIMessage[];
  readonly queryEmbedding?: AIEmbeddingVector;
  readonly signal?: AbortSignal;
  readonly metadata?: AIMetadata;
}
export interface RAGQuery {
  readonly original: string;
  readonly normalized: string;
  readonly language?: string;
  readonly keywords: readonly string[];
  readonly embedding?: AIEmbeddingVector;
}
export interface RAGContextBlock {
  readonly citationId: AIIdentifier;
  readonly chunk: KnowledgeChunk;
  readonly score: number;
  readonly text: string;
}
export interface RAGContext {
  readonly text: string;
  readonly blocks: readonly RAGContextBlock[];
  readonly characterCount: number;
  readonly estimatedTokens: number;
  readonly truncated: boolean;
}
export interface RAGGroundingResult {
  readonly valid: boolean;
  readonly evidenceSufficient: boolean;
  readonly issues: readonly string[];
  readonly citationIds: readonly AIIdentifier[];
}
export interface RAGMetrics {
  readonly queryProcessingMilliseconds: number;
  readonly embeddingMilliseconds: number;
  readonly retrievalMilliseconds: number;
  readonly rankingMilliseconds: number;
  readonly contextBuildingMilliseconds: number;
  readonly generationMilliseconds: number;
  readonly validationMilliseconds: number;
  readonly totalMilliseconds: number;
  readonly retrievedCount: number;
  readonly selectedCount: number;
  readonly citationCount: number;
  readonly contextCharacterCount: number;
  readonly estimatedContextTokens: number;
}
export interface RAGUsage {
  readonly embeddingTokens?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}
export interface RAGResult {
  readonly status: RAGStatus;
  readonly answer: string;
  readonly tenantId: AIIdentifier;
  readonly assistantId: AIIdentifier;
  readonly requestId: AIIdentifier;
  readonly correlationId: AIIdentifier;
  readonly query: RAGQuery;
  readonly groundingMode: RAGGroundingMode;
  readonly retrievedChunks: readonly RetrievalResultItem[];
  readonly selectedChunks: readonly RetrievalResultItem[];
  readonly citations: readonly Citation[];
  readonly generation?: AIChatResponse;
  readonly grounding: RAGGroundingResult;
  readonly usage: RAGUsage;
  readonly metrics: RAGMetrics;
  readonly warnings: readonly string[];
  readonly metadata?: AIMetadata;
}
export interface RAGDependencies {
  readonly repository: KnowledgeRepository;
  readonly vectorStore?: VectorStore;
  readonly retriever?: Retriever;
  readonly chatProvider: AIChatProvider;
  readonly embeddingService?: AIEmbeddingService;
  readonly citationBuilder?: CitationBuilder;
  readonly queryExpander?: RAGQueryExpander;
  readonly reranker?: RAGRerankingStrategy;
  readonly groundingValidator?: RAGGroundingValidator;
  readonly now?: () => string;
}
export interface RAGQueryExpander {
  expand(
    query: RAGQuery,
    context: KnowledgeOperationContext,
  ): Promise<readonly string[]>;
}
export interface RAGRerankingStrategy {
  readonly id: string;
  rerank(
    query: RAGQuery,
    candidates: readonly RetrievalResultItem[],
    context: KnowledgeOperationContext,
  ): Promise<readonly RetrievalResultItem[]>;
}
export interface RAGGroundingValidator {
  validate(input: {
    readonly answer: string;
    readonly mode: RAGGroundingMode;
    readonly context: RAGContext;
    readonly citations: readonly Citation[];
    readonly minimumScore: number;
    readonly generation?: AIChatResponse;
  }): Promise<RAGGroundingResult>;
}
export interface RAGPipeline {
  execute(request: RAGRequest): Promise<RAGResult>;
}
export interface RAGServices {
  readonly pipeline: RAGPipeline;
  readonly configuration: RAGConfiguration;
}
