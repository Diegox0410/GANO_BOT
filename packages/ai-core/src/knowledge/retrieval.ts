import { KnowledgeError, throwIfKnowledgeAborted } from "./errors.js";
import { createScoreRankingStrategy } from "./ranking.js";

import type { AIMetadata } from "../types.js";
import type { RankingCandidate, RankingStrategy, RerankingStrategy } from "./ranking.js";
import type { KnowledgeOperationContext } from "./types.js";

export interface RetrievalFilters {
  readonly tenantId: string;
  readonly assistantId: string;
  readonly knowledgeBaseId: string;
  readonly documentIds?: readonly string[];
  readonly versions?: readonly string[];
  readonly tags?: readonly string[];
  readonly language?: string;
  readonly metadata?: AIMetadata;
}

export interface RetrievalRequest {
  readonly query: string;
  readonly filters: RetrievalFilters;
  readonly minimumScore?: number;
  readonly limit?: number;
  readonly context: KnowledgeOperationContext;
}

export interface RetrievalResultItem extends RankingCandidate { readonly rank: number; }
export interface RetrievalResult {
  readonly query: string;
  readonly items: readonly RetrievalResultItem[];
  readonly totalCandidates: number;
  readonly durationMilliseconds: number;
  readonly metadata?: AIMetadata;
}

export interface RetrievalCandidateSource { retrieveCandidates(request: RetrievalRequest): Promise<readonly RankingCandidate[]>; }
export interface Retriever { retrieve(request: RetrievalRequest): Promise<RetrievalResult>; }

export interface RetrieverConfig {
  readonly source: RetrievalCandidateSource;
  readonly ranking?: RankingStrategy;
  readonly reranking?: RerankingStrategy;
  readonly defaultLimit?: number;
  readonly defaultMinimumScore?: number;
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.max(1, Math.floor(value));
}

export class DefaultRetriever implements Retriever {
  private readonly ranking: RankingStrategy;
  public constructor(private readonly config: RetrieverConfig) { this.ranking = config.ranking ?? createScoreRankingStrategy(); }

  public async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
    const startedAt = Date.now();
    throwIfKnowledgeAborted(request.context.signal);
    this.validateIsolation(request);
    const candidates = await this.config.source.retrieveCandidates(request);
    throwIfKnowledgeAborted(request.context.signal);
    const isolated = candidates.filter((candidate) => {
      const metadata = candidate.chunk.metadata;
      return metadata.tenantId === request.filters.tenantId
        && metadata.assistantId === request.filters.assistantId
        && metadata.knowledgeBaseId === request.filters.knowledgeBaseId
        && (request.filters.documentIds === undefined || request.filters.documentIds.includes(metadata.documentId))
        && (request.filters.versions === undefined || request.filters.versions.includes(metadata.version))
        && (request.filters.language === undefined || metadata.language === request.filters.language);
    });
    const minimumScore = request.minimumScore ?? this.config.defaultMinimumScore ?? 0;
    const eligible = isolated.filter((candidate) => Number.isFinite(candidate.score) && candidate.score >= minimumScore);
    const ranked = await this.ranking.rank({ query: request.query, candidates: eligible, context: request.context });
    const reranked = this.config.reranking === undefined
      ? ranked
      : await this.config.reranking.rerank({ query: request.query, candidates: ranked, context: request.context });
    const limit = normalizeLimit(request.limit, this.config.defaultLimit ?? 8);
    const items = reranked.slice(0, limit).map((candidate, index) => Object.freeze({ ...candidate, rank: index + 1 }));
    return Object.freeze({ query: request.query, items: Object.freeze(items), totalCandidates: candidates.length, durationMilliseconds: Date.now() - startedAt });
  }

  private validateIsolation(request: RetrievalRequest): void {
    const filters = request.filters;
    const context = request.context;
    if (filters.tenantId !== context.tenantId || filters.assistantId !== context.assistantId || filters.knowledgeBaseId !== context.knowledgeBaseId) {
      throw new KnowledgeError("RETRIEVAL_ERROR", "Los filtros de retrieval no coinciden con el contexto multiempresa.", {
        tenantId: context.tenantId, assistantId: context.assistantId, knowledgeBaseId: context.knowledgeBaseId, requestId: context.requestId,
      });
    }
    if (request.query.trim().length === 0) throw new KnowledgeError("RETRIEVAL_ERROR", "La consulta de retrieval no puede estar vacía.");
  }
}

export function createRetriever(config: RetrieverConfig): Retriever { return new DefaultRetriever(config); }
