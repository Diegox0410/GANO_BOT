import type { AIEmbeddingVector, AIMetadata } from "../types.js";
import type { EmbeddingRecord } from "./embeddings.js";
import type { KnowledgeOperationContext } from "./types.js";
import {
  calculateCosineSimilarity,
  validateEmbeddingVector,
} from "../embeddings.js";
import { KnowledgeError, throwIfKnowledgeAborted } from "./errors.js";

export type VectorStoreKind =
  | "memory"
  | "firestore"
  | "postgres"
  | "supabase"
  | "pinecone"
  | "qdrant"
  | "weaviate"
  | "chroma"
  | "milvus"
  | "custom";

export interface VectorStoreDescriptor {
  readonly id: string;
  readonly kind: VectorStoreKind;
  readonly dimensions?: number;
  readonly metadata?: AIMetadata;
}
export interface VectorStoreFilter {
  readonly tenantId: string;
  readonly assistantId: string;
  readonly knowledgeBaseId: string;
  readonly documentIds?: readonly string[];
  readonly versions?: readonly string[];
  readonly tags?: readonly string[];
  readonly metadata?: AIMetadata;
}
export interface VectorSearchRequest {
  readonly vector: AIEmbeddingVector;
  readonly filter: VectorStoreFilter;
  readonly limit: number;
  readonly minimumScore?: number;
  readonly context: KnowledgeOperationContext;
}
export interface VectorSearchMatch {
  readonly record: EmbeddingRecord;
  readonly score: number;
}
export interface VectorSearchResult {
  readonly matches: readonly VectorSearchMatch[];
  readonly durationMilliseconds: number;
  readonly metadata?: AIMetadata;
}

export interface VectorStore {
  readonly descriptor: VectorStoreDescriptor;
  upsert(
    records: readonly EmbeddingRecord[],
    context: KnowledgeOperationContext,
  ): Promise<void>;
  remove(
    filter: VectorStoreFilter,
    context: KnowledgeOperationContext,
  ): Promise<number>;
  search(request: VectorSearchRequest): Promise<VectorSearchResult>;
}

export interface MemoryVectorStore extends VectorStore {
  readonly descriptor: VectorStoreDescriptor & { readonly kind: "memory" };
}
export interface FirestoreVectorStore extends VectorStore {
  readonly descriptor: VectorStoreDescriptor & { readonly kind: "firestore" };
}
export interface PostgresVectorStore extends VectorStore {
  readonly descriptor: VectorStoreDescriptor & { readonly kind: "postgres" };
}
export interface SupabaseVectorStore extends VectorStore {
  readonly descriptor: VectorStoreDescriptor & { readonly kind: "supabase" };
}
export interface PineconeVectorStore extends VectorStore {
  readonly descriptor: VectorStoreDescriptor & { readonly kind: "pinecone" };
}
export interface QdrantVectorStore extends VectorStore {
  readonly descriptor: VectorStoreDescriptor & { readonly kind: "qdrant" };
}
export interface WeaviateVectorStore extends VectorStore {
  readonly descriptor: VectorStoreDescriptor & { readonly kind: "weaviate" };
}
export interface ChromaVectorStore extends VectorStore {
  readonly descriptor: VectorStoreDescriptor & { readonly kind: "chroma" };
}
export interface MilvusVectorStore extends VectorStore {
  readonly descriptor: VectorStoreDescriptor & { readonly kind: "milvus" };
}

/** Almacén volátil exclusivamente para desarrollo y pruebas deterministas. */
export class InMemoryVectorStore implements MemoryVectorStore {
  public readonly descriptor: MemoryVectorStore["descriptor"];
  private readonly records = new Map<string, EmbeddingRecord>();
  public constructor(id = "memory-vector-store", dimensions?: number) {
    this.descriptor = Object.freeze({
      id,
      kind: "memory",
      ...(dimensions !== undefined ? { dimensions } : {}),
      metadata: Object.freeze({ production: false }),
    });
  }
  public async upsert(
    records: readonly EmbeddingRecord[],
    context: KnowledgeOperationContext,
  ): Promise<void> {
    throwIfKnowledgeAborted(context.signal);
    for (const record of records) {
      this.validateScope(record, context);
      validateEmbeddingVector(record.vector, {
        expectedDimensions: this.descriptor.dimensions,
      });
      this.records.set(record.id, record);
    }
  }
  public async remove(
    filter: VectorStoreFilter,
    context: KnowledgeOperationContext,
  ): Promise<number> {
    this.validateFilter(filter, context);
    let removed = 0;
    for (const [id, record] of this.records)
      if (matchesFilter(record, filter)) {
        this.records.delete(id);
        removed += 1;
      }
    return removed;
  }
  public async search(
    request: VectorSearchRequest,
  ): Promise<VectorSearchResult> {
    const startedAt = Date.now();
    this.validateFilter(request.filter, request.context);
    throwIfKnowledgeAborted(request.context.signal);
    validateEmbeddingVector(request.vector, {
      expectedDimensions: this.descriptor.dimensions,
    });
    const matches = [...this.records.values()]
      .filter((record) => matchesFilter(record, request.filter))
      .map((record) =>
        Object.freeze({
          record,
          score: calculateCosineSimilarity(request.vector, record.vector),
        }),
      )
      .filter((match) => match.score >= (request.minimumScore ?? -1))
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.record.id.localeCompare(right.record.id),
      )
      .slice(0, Math.max(1, Math.floor(request.limit)));
    return Object.freeze({
      matches: Object.freeze(matches),
      durationMilliseconds: Date.now() - startedAt,
    });
  }
  private validateScope(
    record: EmbeddingRecord,
    context: KnowledgeOperationContext,
  ): void {
    const metadata = record.metadata;
    if (
      metadata.tenantId !== context.tenantId ||
      metadata.assistantId !== context.assistantId ||
      metadata.knowledgeBaseId !== context.knowledgeBaseId
    )
      throw new KnowledgeError(
        "VECTOR_STORE_ERROR",
        "El embedding no pertenece al contexto multiempresa indicado.",
      );
  }
  private validateFilter(
    filter: VectorStoreFilter,
    context: KnowledgeOperationContext,
  ): void {
    if (
      filter.tenantId !== context.tenantId ||
      filter.assistantId !== context.assistantId ||
      filter.knowledgeBaseId !== context.knowledgeBaseId
    )
      throw new KnowledgeError(
        "VECTOR_STORE_ERROR",
        "El filtro vectorial no coincide con el contexto multiempresa.",
      );
  }
}

function matchesFilter(
  record: EmbeddingRecord,
  filter: VectorStoreFilter,
): boolean {
  const metadata = record.metadata;
  return (
    metadata.tenantId === filter.tenantId &&
    metadata.assistantId === filter.assistantId &&
    metadata.knowledgeBaseId === filter.knowledgeBaseId &&
    (filter.documentIds === undefined ||
      filter.documentIds.includes(metadata.documentId)) &&
    (filter.versions === undefined ||
      filter.versions.includes(metadata.version))
  );
}

export function createInMemoryVectorStore(
  id?: string,
  dimensions?: number,
): MemoryVectorStore {
  return new InMemoryVectorStore(id, dimensions);
}
