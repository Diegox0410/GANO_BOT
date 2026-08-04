export type RAGErrorCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_QUERY"
  | "EMBEDDING_FAILED"
  | "DIMENSION_MISMATCH"
  | "RETRIEVAL_FAILED"
  | "ISOLATION_VIOLATION"
  | "EMPTY_CONTEXT"
  | "INSUFFICIENT_GROUNDING"
  | "GENERATION_FAILED"
  | "VALIDATION_FAILED"
  | "REQUEST_CANCELLED"
  | "TIMEOUT";
export class RAGError extends Error {
  public override readonly name = "RAGError";
  public constructor(
    public readonly code: RAGErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
  }
}
