import { KnowledgeError } from "./errors.js";

import type { AIEmbeddingService } from "../embeddings.js";
import type { AIEmbeddingVector, AIIdentifier, AIMetadata } from "../types.js";
import type { KnowledgeChunk } from "./chunks.js";
import type { KnowledgeOperationContext } from "./types.js";

export interface EmbeddingRequest {
  readonly chunks: readonly KnowledgeChunk[];
  readonly model?: string;
  readonly context: KnowledgeOperationContext;
}

export interface EmbeddingMetadata {
  readonly tenantId: AIIdentifier;
  readonly assistantId: AIIdentifier;
  readonly knowledgeBaseId: AIIdentifier;
  readonly documentId: AIIdentifier;
  readonly chunkId: AIIdentifier;
  readonly version: string;
  readonly model: string;
  readonly dimensions: number;
  readonly createdAt: string;
  readonly metadata?: AIMetadata;
}

export interface EmbeddingRecord {
  readonly id: AIIdentifier;
  readonly vector: AIEmbeddingVector;
  readonly metadata: EmbeddingMetadata;
}

export interface EmbeddingService {
  embed(request: EmbeddingRequest): Promise<readonly EmbeddingRecord[]>;
}

export interface KnowledgeEmbeddingRegistry {
  register(id: string, service: AIEmbeddingService, replace?: boolean): void;
  get(id: string): AIEmbeddingService | undefined;
  require(id: string): AIEmbeddingService;
  list(): readonly string[];
}

export class DefaultKnowledgeEmbeddingRegistry implements KnowledgeEmbeddingRegistry {
  private readonly services = new Map<string, AIEmbeddingService>();
  public register(id: string, service: AIEmbeddingService, replace = false): void {
    const normalized = id.trim();
    if (normalized.length === 0) throw new KnowledgeError("INVALID_CONFIGURATION", "El ID del servicio de embeddings es obligatorio.");
    if (this.services.has(normalized) && !replace) throw new KnowledgeError("INVALID_CONFIGURATION", `El servicio de embeddings "${normalized}" ya está registrado.`);
    this.services.set(normalized, service);
  }
  public get(id: string): AIEmbeddingService | undefined { return this.services.get(id.trim()); }
  public require(id: string): AIEmbeddingService {
    const service = this.get(id);
    if (service === undefined) throw new KnowledgeError("EMBEDDING_ERROR", `El servicio de embeddings "${id}" no está registrado.`);
    return service;
  }
  public list(): readonly string[] { return Object.freeze([...this.services.keys()]); }
}

export function createKnowledgeEmbeddingRegistry(): KnowledgeEmbeddingRegistry { return new DefaultKnowledgeEmbeddingRegistry(); }

export function mapEmbeddingRecords(
  chunks: readonly KnowledgeChunk[],
  embeddings: readonly { readonly id: string; readonly vector: AIEmbeddingVector; readonly model: string; readonly createdAt: string; readonly metadata?: AIMetadata }[],
): readonly EmbeddingRecord[] {
  if (chunks.length !== embeddings.length) throw new KnowledgeError("EMBEDDING_ERROR", "La cantidad de embeddings no coincide con la cantidad de chunks.");
  return Object.freeze(chunks.map((chunk, index) => {
    const embedding = embeddings[index];
    if (embedding === undefined) throw new KnowledgeError("EMBEDDING_ERROR", `Falta el embedding para el chunk "${chunk.id}".`);
    return Object.freeze({
      id: embedding.id,
      vector: embedding.vector,
      metadata: Object.freeze({
        tenantId: chunk.metadata.tenantId, assistantId: chunk.metadata.assistantId, knowledgeBaseId: chunk.metadata.knowledgeBaseId,
        documentId: chunk.metadata.documentId, chunkId: chunk.id, version: chunk.metadata.version,
        model: embedding.model, dimensions: embedding.vector.length, createdAt: embedding.createdAt,
        ...(embedding.metadata !== undefined ? { metadata: Object.freeze({ ...embedding.metadata }) } : {}),
      }),
    });
  }));
}
