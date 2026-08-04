import { KnowledgeError } from "./errors.js";

import type { KnowledgeChunk } from "./chunks.js";
import type { KnowledgeDocument, KnowledgeDocumentStatus } from "./types.js";

export interface KnowledgeDocumentQuery {
  readonly tenantId: string;
  readonly assistantId: string;
  readonly knowledgeBaseId: string;
  readonly documentIds?: readonly string[];
  readonly statuses?: readonly KnowledgeDocumentStatus[];
  readonly tags?: readonly string[];
  readonly checksum?: string;
  readonly limit?: number;
}

export interface KnowledgeRepository {
  getDocument(tenantId: string, assistantId: string, knowledgeBaseId: string, documentId: string, version?: string): Promise<KnowledgeDocument | undefined>;
  findDocuments(query: KnowledgeDocumentQuery): Promise<readonly KnowledgeDocument[]>;
  saveDocument(document: KnowledgeDocument): Promise<void>;
  saveChunks(document: KnowledgeDocument, chunks: readonly KnowledgeChunk[]): Promise<void>;
  getChunks(tenantId: string, assistantId: string, knowledgeBaseId: string, documentId: string, version?: string): Promise<readonly KnowledgeChunk[]>;
  removeVersion(tenantId: string, assistantId: string, knowledgeBaseId: string, documentId: string, version: string): Promise<boolean>;
}

function key(parts: readonly string[]): string { return JSON.stringify(parts); }

/** Adaptador volátil exclusivamente para desarrollo y pruebas deterministas. */
export class InMemoryKnowledgeRepository implements KnowledgeRepository {
  private readonly documents = new Map<string, KnowledgeDocument>();
  private readonly chunks = new Map<string, readonly KnowledgeChunk[]>();

  public async getDocument(tenantId: string, assistantId: string, knowledgeBaseId: string, documentId: string, version?: string): Promise<KnowledgeDocument | undefined> {
    if (version !== undefined) return this.documents.get(key([tenantId, assistantId, knowledgeBaseId, documentId, version]));
    return [...this.documents.values()]
      .filter((document) => document.tenantId === tenantId && document.assistantId === assistantId && document.knowledgeBaseId === knowledgeBaseId && document.documentId === documentId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  }

  public async findDocuments(query: KnowledgeDocumentQuery): Promise<readonly KnowledgeDocument[]> {
    const documents = [...this.documents.values()].filter((document) =>
      document.tenantId === query.tenantId && document.assistantId === query.assistantId && document.knowledgeBaseId === query.knowledgeBaseId
      && (query.documentIds === undefined || query.documentIds.includes(document.documentId))
      && (query.statuses === undefined || query.statuses.includes(document.status))
      && (query.tags === undefined || query.tags.every((tag) => document.tags.includes(tag)))
      && (query.checksum === undefined || document.checksum === query.checksum));
    return Object.freeze(documents.slice(0, query.limit ?? documents.length));
  }

  public async saveDocument(document: KnowledgeDocument): Promise<void> {
    const documentKey = key([document.tenantId, document.assistantId, document.knowledgeBaseId, document.documentId, document.version]);
    const existing = this.documents.get(documentKey);
    if (existing !== undefined && existing.checksum !== document.checksum) {
      throw new KnowledgeError("VERSION_CONFLICT", `La versión "${document.version}" ya existe con otro checksum.`, {
        tenantId: document.tenantId, assistantId: document.assistantId, knowledgeBaseId: document.knowledgeBaseId, documentId: document.documentId,
      });
    }
    this.documents.set(documentKey, document);
  }

  public async saveChunks(document: KnowledgeDocument, chunks: readonly KnowledgeChunk[]): Promise<void> {
    for (const chunk of chunks) {
      if (chunk.metadata.tenantId !== document.tenantId || chunk.metadata.assistantId !== document.assistantId || chunk.metadata.knowledgeBaseId !== document.knowledgeBaseId || chunk.metadata.documentId !== document.documentId || chunk.metadata.version !== document.version) {
        throw new KnowledgeError("INVALID_DOCUMENT", "Un chunk no pertenece al documento indicado.");
      }
    }
    this.chunks.set(key([document.tenantId, document.assistantId, document.knowledgeBaseId, document.documentId, document.version]), Object.freeze([...chunks]));
  }

  public async getChunks(tenantId: string, assistantId: string, knowledgeBaseId: string, documentId: string, version?: string): Promise<readonly KnowledgeChunk[]> {
    const document = await this.getDocument(tenantId, assistantId, knowledgeBaseId, documentId, version);
    if (document === undefined) return Object.freeze([]);
    return this.chunks.get(key([tenantId, assistantId, knowledgeBaseId, documentId, document.version])) ?? Object.freeze([]);
  }

  public async removeVersion(tenantId: string, assistantId: string, knowledgeBaseId: string, documentId: string, version: string): Promise<boolean> {
    const documentKey = key([tenantId, assistantId, knowledgeBaseId, documentId, version]);
    this.chunks.delete(documentKey);
    return this.documents.delete(documentKey);
  }
}

export function createInMemoryKnowledgeRepository(): KnowledgeRepository { return new InMemoryKnowledgeRepository(); }
