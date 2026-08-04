import type { AIEmbeddingVector, AIMetadata } from "../types.js";
import type { EmbeddingRecord } from "./embeddings.js";
import type { KnowledgeOperationContext } from "./types.js";

export type VectorStoreKind = "memory" | "firestore" | "postgres" | "supabase" | "pinecone" | "qdrant" | "weaviate" | "chroma" | "milvus" | "custom";

export interface VectorStoreDescriptor { readonly id: string; readonly kind: VectorStoreKind; readonly dimensions?: number; readonly metadata?: AIMetadata; }
export interface VectorStoreFilter {
  readonly tenantId: string; readonly assistantId: string; readonly knowledgeBaseId: string;
  readonly documentIds?: readonly string[]; readonly versions?: readonly string[]; readonly tags?: readonly string[]; readonly metadata?: AIMetadata;
}
export interface VectorSearchRequest { readonly vector: AIEmbeddingVector; readonly filter: VectorStoreFilter; readonly limit: number; readonly minimumScore?: number; readonly context: KnowledgeOperationContext; }
export interface VectorSearchMatch { readonly record: EmbeddingRecord; readonly score: number; }
export interface VectorSearchResult { readonly matches: readonly VectorSearchMatch[]; readonly durationMilliseconds: number; readonly metadata?: AIMetadata; }

export interface VectorStore {
  readonly descriptor: VectorStoreDescriptor;
  upsert(records: readonly EmbeddingRecord[], context: KnowledgeOperationContext): Promise<void>;
  remove(filter: VectorStoreFilter, context: KnowledgeOperationContext): Promise<number>;
  search(request: VectorSearchRequest): Promise<VectorSearchResult>;
}

export interface MemoryVectorStore extends VectorStore { readonly descriptor: VectorStoreDescriptor & { readonly kind: "memory" }; }
export interface FirestoreVectorStore extends VectorStore { readonly descriptor: VectorStoreDescriptor & { readonly kind: "firestore" }; }
export interface PostgresVectorStore extends VectorStore { readonly descriptor: VectorStoreDescriptor & { readonly kind: "postgres" }; }
export interface SupabaseVectorStore extends VectorStore { readonly descriptor: VectorStoreDescriptor & { readonly kind: "supabase" }; }
export interface PineconeVectorStore extends VectorStore { readonly descriptor: VectorStoreDescriptor & { readonly kind: "pinecone" }; }
export interface QdrantVectorStore extends VectorStore { readonly descriptor: VectorStoreDescriptor & { readonly kind: "qdrant" }; }
export interface WeaviateVectorStore extends VectorStore { readonly descriptor: VectorStoreDescriptor & { readonly kind: "weaviate" }; }
export interface ChromaVectorStore extends VectorStore { readonly descriptor: VectorStoreDescriptor & { readonly kind: "chroma" }; }
export interface MilvusVectorStore extends VectorStore { readonly descriptor: VectorStoreDescriptor & { readonly kind: "milvus" }; }
