import {
  createDeterministicKnowledgeId,
  throwIfKnowledgeAborted,
} from "../knowledge/index.js";
import type { RetrievalResultItem } from "../knowledge/index.js";
import type { RAGContext, RAGContextBlock, RAGContextBudget } from "./types.js";

export function estimateRAGTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
export function buildRAGContext(
  candidates: readonly RetrievalResultItem[],
  budget: RAGContextBudget = {},
  signal?: AbortSignal,
): RAGContext {
  const maximumCharacters = Math.max(1, budget.maximumCharacters ?? 12_000);
  const maximumTokens = Math.max(1, budget.maximumTokens ?? 3_000);
  const maximumChunks = Math.max(1, budget.maximumChunks ?? 8);
  const maximumPerDocument = Math.max(1, budget.maximumChunksPerDocument ?? 3);
  const blocks: RAGContextBlock[] = [];
  const counts = new Map<string, number>();
  let text = "";
  let truncated = false;
  for (const candidate of candidates) {
    throwIfKnowledgeAborted(signal);
    if (blocks.length >= maximumChunks) {
      truncated = true;
      break;
    }
    const chunk = candidate.chunk;
    const count = counts.get(chunk.metadata.documentId) ?? 0;
    if (count >= maximumPerDocument) continue;
    const citationId = createDeterministicKnowledgeId(
      `${chunk.id}:${candidate.score}`,
      "citation",
    );
    const header = `[Fuente ${blocks.length + 1} | ${citationId} | documento ${chunk.metadata.documentId}${chunk.metadata.section === undefined ? "" : ` | sección ${chunk.metadata.section}`} ]`;
    const remaining = Math.min(
      maximumCharacters - text.length,
      maximumTokens * 4 - text.length,
    );
    if (remaining <= header.length + 1) {
      truncated = true;
      break;
    }
    const content = chunk.content.slice(0, remaining - header.length - 1);
    const blockText = `${header}\n${content}`;
    if (content.length < chunk.content.length) truncated = true;
    text += `${text.length === 0 ? "" : "\n\n"}${blockText}`;
    blocks.push(
      Object.freeze({
        citationId,
        chunk,
        score: candidate.score,
        text: blockText,
      }),
    );
    counts.set(chunk.metadata.documentId, count + 1);
    if (truncated) break;
  }
  return Object.freeze({
    text,
    blocks: Object.freeze(blocks),
    characterCount: text.length,
    estimatedTokens: estimateRAGTokens(text),
    truncated,
  });
}
