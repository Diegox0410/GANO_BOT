import type { KnowledgeChunk } from "./chunks.js";
import type { KnowledgeOperationContext } from "./types.js";

export interface RankingCandidate { readonly chunk: KnowledgeChunk; readonly score: number; readonly reasons?: readonly string[]; }
export interface RankingRequest { readonly query: string; readonly candidates: readonly RankingCandidate[]; readonly context: KnowledgeOperationContext; }
export interface RankingStrategy { readonly id: string; rank(request: RankingRequest): Promise<readonly RankingCandidate[]>; }
export interface RerankingStrategy { readonly id: string; rerank(request: RankingRequest): Promise<readonly RankingCandidate[]>; }

export class ScoreRankingStrategy implements RankingStrategy {
  public readonly id = "score";
  public async rank(request: RankingRequest): Promise<readonly RankingCandidate[]> {
    return Object.freeze([...request.candidates].sort((left, right) => right.score - left.score || left.chunk.id.localeCompare(right.chunk.id)));
  }
}

export function createScoreRankingStrategy(): RankingStrategy { return new ScoreRankingStrategy(); }
