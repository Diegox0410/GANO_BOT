import { createDeterministicKnowledgeId } from "./chunks.js";
import { KnowledgeError, throwIfKnowledgeAborted } from "./errors.js";
import { freezeKnowledgeMetadata, freezeKnowledgePermissions, normalizeKnowledgeTags, PUBLIC_KNOWLEDGE_PERMISSIONS } from "./metadata.js";

import type { ChunkingStrategy } from "./chunking.js";
import type { KnowledgeConnector } from "./connectors.js";
import type { KnowledgeChunk } from "./chunks.js";
import type { DocumentLoader } from "./loaders.js";
import type { DocumentParser } from "./parser.js";
import type { KnowledgeRegistry } from "./registry.js";
import type { KnowledgeRepository } from "./repository.js";
import type { KnowledgeSourceItem } from "./sources.js";
import type { KnowledgeConfiguration, KnowledgeDocument, KnowledgeDocumentIdentity, KnowledgeOperationContext, KnowledgePermissions } from "./types.js";
import type { AIMetadata } from "../types.js";

export interface KnowledgeIngestionRequest {
  readonly mode?: "ingest" | "reingest" | "reindex";
  readonly sourceId: string;
  readonly connectorId?: string;
  readonly loaderId?: string;
  readonly parserId?: string;
  readonly chunkingStrategyId: string;
  readonly item: KnowledgeSourceItem;
  readonly identity: KnowledgeDocumentIdentity;
  readonly permissions?: KnowledgePermissions;
  readonly tags?: readonly string[];
  readonly language?: string;
  readonly metadata?: AIMetadata;
  readonly context: KnowledgeOperationContext;
}

export interface KnowledgeIngestionResult {
  readonly document: KnowledgeDocument;
  readonly chunks: readonly KnowledgeChunk[];
  readonly deduplicated: boolean;
  readonly warnings: readonly string[];
  readonly durationMilliseconds: number;
}

export type KnowledgeIngestionItemResult =
  | { readonly ok: true; readonly result: KnowledgeIngestionResult }
  | { readonly ok: false; readonly request: KnowledgeIngestionRequest; readonly error: KnowledgeError };

export interface KnowledgeIngestionPipeline {
  ingest(request: KnowledgeIngestionRequest): Promise<KnowledgeIngestionResult>;
  ingestMany(requests: readonly KnowledgeIngestionRequest[]): Promise<readonly KnowledgeIngestionItemResult[]>;
}

export interface KnowledgeIngestionPipelineConfig {
  readonly registry: KnowledgeRegistry;
  readonly repository: KnowledgeRepository;
  readonly configuration?: KnowledgeConfiguration;
  readonly now?: () => string;
}

async function progress(request: KnowledgeIngestionRequest, stage: KnowledgeDocument["status"], completed: number, message?: string): Promise<void> {
  await request.context.onProgress?.({ stage, completed, ...(message !== undefined ? { message } : {}) });
}

function checksumContent(content: string | Uint8Array): string {
  const serialized = typeof content === "string" ? content : Array.from(content).join(",");
  return createDeterministicKnowledgeId(serialized, "checksum");
}

export class DefaultKnowledgeIngestionPipeline implements KnowledgeIngestionPipeline {
  private readonly configuration: KnowledgeConfiguration;
  private readonly now: () => string;
  public constructor(private readonly config: KnowledgeIngestionPipelineConfig) {
    this.configuration = Object.freeze({ ...config.configuration });
    this.now = config.now ?? (() => new Date().toISOString());
  }

  public async ingest(request: KnowledgeIngestionRequest): Promise<KnowledgeIngestionResult> {
    const startedAt = Date.now();
    this.validateIsolation(request);
    throwIfKnowledgeAborted(request.context.signal);
    const source = this.config.registry.requireSource(request.sourceId);
    const connector: KnowledgeConnector = request.connectorId === undefined
      ? this.config.registry.findConnector(source.kind) ?? (() => { throw new KnowledgeError("CONNECTOR_NOT_FOUND", `No existe conector para "${source.kind}".`); })()
      : this.config.registry.requireConnector(request.connectorId);
    await progress(request, "loading", 0);
    const connectorContent = await connector.read({ source, item: request.item, context: request.context });
    if (this.configuration.maximumDocumentBytes !== undefined && connectorContent.size > this.configuration.maximumDocumentBytes) {
      throw new KnowledgeError("INGESTION_ERROR", "El documento excede el tamaño máximo permitido.", {
        tenantId: request.identity.tenantId, assistantId: request.identity.assistantId,
        knowledgeBaseId: request.identity.knowledgeBaseId, documentId: request.identity.documentId,
      });
    }
    throwIfKnowledgeAborted(request.context.signal);
    const loader: DocumentLoader = request.loaderId === undefined
      ? this.config.registry.findLoader(source.kind, connectorContent.mimeType) ?? (() => { throw new KnowledgeError("LOADER_NOT_FOUND", `No existe loader para "${connectorContent.mimeType}".`); })()
      : this.config.registry.requireLoader(request.loaderId);
    const loaded = await loader.load({
      identity: request.identity, title: request.item.name, source: request.item.uri ?? source.uri ?? source.name,
      sourceKind: source.kind, language: request.language, connectorContent, context: request.context, metadata: request.metadata,
    });
    const checksum = loaded.checksum ?? checksumContent(loaded.content);
    if (this.configuration.deduplicate !== false) {
      const duplicates = await this.config.repository.findDocuments({
        tenantId: request.identity.tenantId, assistantId: request.identity.assistantId,
        knowledgeBaseId: request.identity.knowledgeBaseId, checksum, limit: 1,
      });
      const duplicate = duplicates[0];
      if (duplicate !== undefined && !this.configuration.allowReingestion) {
        return Object.freeze({ document: duplicate, chunks: await this.config.repository.getChunks(duplicate.tenantId, duplicate.assistantId, duplicate.knowledgeBaseId, duplicate.documentId, duplicate.version), deduplicated: true, warnings: Object.freeze([]), durationMilliseconds: Date.now() - startedAt });
      }
    }
    await progress(request, "parsing", 1);
    const parser: DocumentParser = request.parserId === undefined
      ? this.config.registry.findParser(loaded.mimeType) ?? (() => { throw new KnowledgeError("PARSER_NOT_FOUND", `No existe parser para "${loaded.mimeType}".`); })()
      : this.config.registry.requireParser(request.parserId);
    const parsed = await parser.parse({ document: loaded, context: request.context });
    throwIfKnowledgeAborted(request.context.signal);
    await progress(request, "chunking", 2);
    const chunker: ChunkingStrategy = this.config.registry.requireChunker(request.chunkingStrategyId);
    const chunking = await chunker.chunk({ document: parsed, context: request.context });
    const maximumChunks = this.configuration.maximumChunksPerDocument;
    if (maximumChunks !== undefined && chunking.chunks.length > maximumChunks) throw new KnowledgeError("INGESTION_ERROR", "El documento excede el máximo de chunks permitido.");
    const timestamp = this.now();
    const document: KnowledgeDocument = Object.freeze({
      ...request.identity, checksum, title: loaded.title, source: loaded.source, sourceKind: loaded.sourceKind,
      mimeType: loaded.mimeType, language: parsed.language, createdAt: timestamp, updatedAt: timestamp,
      metadata: freezeKnowledgeMetadata(request.metadata), permissions: freezeKnowledgePermissions(request.permissions ?? PUBLIC_KNOWLEDGE_PERMISSIONS),
      tags: normalizeKnowledgeTags(request.tags), status: "ready",
    });
    await this.config.repository.saveDocument(document);
    await this.config.repository.saveChunks(document, chunking.chunks);
    await progress(request, "ready", 3);
    return Object.freeze({ document, chunks: chunking.chunks, deduplicated: false, warnings: chunking.warnings, durationMilliseconds: Date.now() - startedAt });
  }

  public async ingestMany(requests: readonly KnowledgeIngestionRequest[]): Promise<readonly KnowledgeIngestionItemResult[]> {
    const results: KnowledgeIngestionItemResult[] = [];
    for (const request of requests) {
      try {
        results.push(Object.freeze({ ok: true, result: await this.ingest(request) }));
      } catch (error) {
        const normalized = error instanceof KnowledgeError
          ? error
          : new KnowledgeError("INGESTION_ERROR", "Falló la ingesta del documento.", {
              tenantId: request.identity.tenantId, assistantId: request.identity.assistantId,
              knowledgeBaseId: request.identity.knowledgeBaseId, documentId: request.identity.documentId,
            }, error);
        results.push(Object.freeze({ ok: false, request, error: normalized }));
        if (this.configuration.continueOnPartialError !== true) throw normalized;
      }
    }
    return Object.freeze(results);
  }

  private validateIsolation(request: KnowledgeIngestionRequest): void {
    const identity = request.identity;
    const context = request.context;
    if (identity.tenantId !== context.tenantId || identity.assistantId !== context.assistantId || identity.knowledgeBaseId !== context.knowledgeBaseId) {
      throw new KnowledgeError("INVALID_DOCUMENT", "La identidad documental no coincide con el contexto multiempresa.", {
        tenantId: context.tenantId, assistantId: context.assistantId, knowledgeBaseId: context.knowledgeBaseId, documentId: identity.documentId, requestId: context.requestId,
      });
    }
  }
}

export function createKnowledgeIngestionPipeline(config: KnowledgeIngestionPipelineConfig): KnowledgeIngestionPipeline { return new DefaultKnowledgeIngestionPipeline(config); }
