import { validateEmbeddingVector } from "../embeddings.js";
import type { AIEmbeddingService } from "../embeddings.js";
import type { KnowledgeOperationContext } from "../knowledge/index.js";
import type { RAGQuery, RAGQueryExpander, RAGRequest } from "./types.js";
import { RAGError } from "./errors.js";

export async function processRAGQuery(
  request: RAGRequest,
  maximumCharacters: number,
  embeddingService: AIEmbeddingService | undefined,
  embeddingModel: string | undefined,
  expander: RAGQueryExpander | undefined,
  context: KnowledgeOperationContext,
): Promise<{
  readonly query: RAGQuery;
  readonly embeddingMilliseconds: number;
  readonly embeddingTokens?: number;
}> {
  if (request.signal?.aborted === true)
    throw new RAGError("REQUEST_CANCELLED", "La consulta RAG fue cancelada.");
  const normalized = request.query.replace(/\s+/g, " ").trim();
  if (normalized.length === 0)
    throw new RAGError(
      "INVALID_QUERY",
      "La consulta RAG no puede estar vacía.",
    );
  if (normalized.length > maximumCharacters)
    throw new RAGError(
      "INVALID_QUERY",
      "La consulta RAG excede la longitud máxima permitida.",
    );
  const keywords = Object.freeze([
    ...new Set(
      normalized
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length > 2),
    ),
  ]);
  let base: RAGQuery = Object.freeze({
    original: request.query,
    normalized,
    ...(request.language !== undefined ? { language: request.language } : {}),
    keywords,
  });
  if (expander !== undefined) {
    const expanded = await expander.expand(base, context);
    base = Object.freeze({
      ...base,
      keywords: Object.freeze([
        ...new Set([
          ...keywords,
          ...expanded
            .map((value) => value.trim().toLowerCase())
            .filter((value) => value.length > 0),
        ]),
      ]),
    });
  }
  if (request.queryEmbedding !== undefined) {
    validateEmbeddingVector(request.queryEmbedding);
    return {
      query: Object.freeze({ ...base, embedding: request.queryEmbedding }),
      embeddingMilliseconds: 0,
    };
  }
  if (embeddingService === undefined)
    return { query: base, embeddingMilliseconds: 0 };
  const startedAt = Date.now();
  try {
    const response = await embeddingService.embed({
      inputs: [{ id: `query-${request.requestId}`, text: normalized }],
      ...(embeddingModel !== undefined ? { model: embeddingModel } : {}),
      ...(request.signal !== undefined ? { signal: request.signal } : {}),
    });
    const embedding = response.embeddings[0];
    if (embedding === undefined)
      throw new RAGError(
        "EMBEDDING_FAILED",
        "El servicio no devolvió el embedding de consulta.",
      );
    validateEmbeddingVector(embedding.vector);
    return {
      query: Object.freeze({ ...base, embedding: embedding.vector }),
      embeddingMilliseconds: Date.now() - startedAt,
      ...(response.usageTokens !== undefined
        ? { embeddingTokens: response.usageTokens }
        : {}),
    };
  } catch (error) {
    if (error instanceof RAGError) throw error;
    throw new RAGError(
      request.signal?.aborted ? "REQUEST_CANCELLED" : "EMBEDDING_FAILED",
      "No se pudo generar el embedding de consulta.",
      error,
    );
  }
}
