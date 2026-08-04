import type { RAGGroundingResult, RAGGroundingValidator } from "./types.js";
export class DeterministicGroundingValidator implements RAGGroundingValidator {
  public async validate(
    input: Parameters<RAGGroundingValidator["validate"]>[0],
  ): Promise<RAGGroundingResult> {
    const issues: string[] = [];
    if (input.answer.trim().length === 0) issues.push("empty-answer");
    if (
      input.mode === "strict-private-knowledge" &&
      input.context.blocks.length === 0
    )
      issues.push("missing-evidence");
    if (input.context.blocks.some((block) => block.score < input.minimumScore))
      issues.push("score-below-minimum");
    const contextIds = new Set(
      input.context.blocks.map((block) => block.citationId),
    );
    if (input.citations.some((citation) => !contextIds.has(citation.id)))
      issues.push("citation-outside-context");
    if (
      input.citations.some(
        (citation) =>
          !input.context.blocks.some(
            (block) => block.chunk.id === citation.chunkId,
          ),
      )
    )
      issues.push("citation-chunk-mismatch");
    if (
      input.generation?.finishReason === "content_filter" ||
      input.generation?.finishReason === "error"
    )
      issues.push("generation-blocked");
    return Object.freeze({
      valid: issues.length === 0,
      evidenceSufficient:
        input.context.blocks.length > 0 &&
        input.context.blocks.some((block) => block.score >= input.minimumScore),
      issues: Object.freeze(issues),
      citationIds: Object.freeze(
        input.citations.map((citation) => citation.id),
      ),
    });
  }
}
export function createGroundingValidator(): RAGGroundingValidator {
  return new DeterministicGroundingValidator();
}
