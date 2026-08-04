import type {
  KnowledgeOperationContext,
  RetrievalResultItem,
} from "../knowledge/index.js";
import type { RAGQuery, RAGRerankingStrategy } from "./types.js";

function textualScore(query: RAGQuery, content: string): number {
  if (query.keywords.length === 0) return 0;
  const normalized = content.toLowerCase();
  return (
    query.keywords.filter((keyword) => normalized.includes(keyword)).length /
    query.keywords.length
  );
}
export function rankRAGCandidates(
  query: RAGQuery,
  candidates: readonly RetrievalResultItem[],
): readonly RetrievalResultItem[] {
  const newest = new Map<string, string>();
  for (const candidate of candidates) {
    const current = newest.get(candidate.chunk.metadata.documentId);
    if (
      current === undefined ||
      candidate.chunk.metadata.version.localeCompare(current, undefined, {
        numeric: true,
      }) > 0
    )
      newest.set(
        candidate.chunk.metadata.documentId,
        candidate.chunk.metadata.version,
      );
  }
  const seenIds = new Set<string>();
  const seenContent = new Set<string>();
  const filtered = candidates.filter((candidate) => {
    const chunk = candidate.chunk;
    const content = chunk.content.trim().toLowerCase();
    if (
      seenIds.has(chunk.id) ||
      seenContent.has(content) ||
      newest.get(chunk.metadata.documentId) !== chunk.metadata.version
    )
      return false;
    seenIds.add(chunk.id);
    seenContent.add(content);
    return content.length > 0;
  });
  return Object.freeze(
    filtered
      .map((candidate) =>
        Object.freeze({
          ...candidate,
          score: Math.min(
            1,
            candidate.score * 0.8 +
              textualScore(query, candidate.chunk.content) * 0.2,
          ),
          reasons: Object.freeze([
            ...(candidate.reasons ?? []),
            "vector-score",
            "textual-overlap",
          ]),
        }),
      )
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.chunk.id.localeCompare(right.chunk.id),
      )
      .map((candidate, index) =>
        Object.freeze({ ...candidate, rank: index + 1 }),
      ),
  );
}
export class DeterministicRAGReranker implements RAGRerankingStrategy {
  public readonly id = "deterministic-rag";
  public async rerank(
    query: RAGQuery,
    candidates: readonly RetrievalResultItem[],
    _context: KnowledgeOperationContext,
  ): Promise<readonly RetrievalResultItem[]> {
    return rankRAGCandidates(query, candidates);
  }
}
export function createDeterministicRAGReranker(): RAGRerankingStrategy {
  return new DeterministicRAGReranker();
}
