import type { AIIdentifier, AIMetadata } from "../types.js";

export type KnowledgeErrorCode =
  | "INVALID_CONFIGURATION" | "INVALID_DOCUMENT" | "SOURCE_NOT_FOUND" | "CONNECTOR_NOT_FOUND"
  | "LOADER_NOT_FOUND" | "PARSER_NOT_FOUND" | "CHUNKER_NOT_FOUND" | "REPOSITORY_ERROR"
  | "DUPLICATE_DOCUMENT" | "VERSION_CONFLICT" | "EMBEDDING_ERROR" | "VECTOR_STORE_ERROR"
  | "RETRIEVAL_ERROR" | "INGESTION_ERROR" | "REQUEST_CANCELLED" | "PARTIAL_FAILURE";

export interface KnowledgeErrorDetails {
  readonly tenantId?: AIIdentifier;
  readonly assistantId?: AIIdentifier;
  readonly knowledgeBaseId?: AIIdentifier;
  readonly documentId?: AIIdentifier;
  readonly requestId?: AIIdentifier;
  readonly stage?: string;
  readonly metadata?: AIMetadata;
}

export class KnowledgeError extends Error {
  public override readonly name = "KnowledgeError";
  public constructor(
    public readonly code: KnowledgeErrorCode,
    message: string,
    public readonly details?: KnowledgeErrorDetails,
    public override readonly cause?: unknown,
  ) { super(message, cause === undefined ? undefined : { cause }); }
}

export function throwIfKnowledgeAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new KnowledgeError("REQUEST_CANCELLED", "La operación de conocimiento fue cancelada.");
}
