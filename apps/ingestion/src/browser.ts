import { createHash } from "node:crypto";
import {
  createHeadingChunkingStrategy,
  createInMemoryKnowledgeRepository,
  createKnowledgeIngestionPipeline,
  createKnowledgeRegistry,
  createKnowledgeSource,
  createMarkdownChunkingStrategy,
  createParagraphChunkingStrategy,
  KnowledgeError,
} from "@gano-bot/ai-core/knowledge";
import type {
  KnowledgeChunk,
  KnowledgeConnector,
  KnowledgeConnectorReadRequest,
  KnowledgeProgress,
  KnowledgeRepository,
  KnowledgeSourceKind,
  KnowledgeSourceListResult,
} from "@gano-bot/ai-core/knowledge";
import type {
  KnowledgeManagerDocumentProcessor,
  ManagedDocument,
  ManagedFileUpload,
  ManagedIngestionResult,
} from "@gano-bot/ai-core/knowledge-manager";
import { LOCAL_FORMATS, sniffMimeType } from "./formats.js";
import { createLocalDocumentLoaders } from "./local.js";
import { createLocalDocumentParsers } from "./parsers.js";

function extension(name: string): string {
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index).toLowerCase();
}
function formatFor(upload: ManagedFileUpload) {
  const ext = extension(upload.file.name);
  const format = LOCAL_FORMATS.find((candidate) =>
    candidate.extensions.includes(ext),
  );
  if (format === undefined || !format.mimeTypes.includes(upload.file.type))
    throw new KnowledgeError(
      "INVALID_DOCUMENT",
      "La extensión y MIME del archivo no están permitidos.",
    );
  return format;
}
function validateSignature(kind: KnowledgeSourceKind, bytes: Uint8Array): void {
  const signature = sniffMimeType(bytes);
  if (kind === "pdf" && signature !== "application/pdf")
    throw new KnowledgeError(
      "INVALID_DOCUMENT",
      "La firma no corresponde a PDF.",
    );
  if ((kind === "docx" || kind === "xlsx") && signature !== "application/zip")
    throw new KnowledgeError(
      "INVALID_DOCUMENT",
      "La firma no corresponde a Office Open XML.",
    );
}
class BytesConnector implements KnowledgeConnector {
  public readonly id = "browser-bytes";
  public readonly kinds = Object.freeze(["custom"] as const);
  public constructor(
    private readonly bytes: Uint8Array,
    private readonly mimeType: string,
  ) {}
  public async list(): Promise<KnowledgeSourceListResult> {
    return Object.freeze({ items: Object.freeze([]) });
  }
  public async read(request: KnowledgeConnectorReadRequest) {
    if (request.context.signal?.aborted === true)
      throw new KnowledgeError("REQUEST_CANCELLED", "Operación cancelada.");
    return Object.freeze({
      data: this.bytes,
      mimeType: this.mimeType,
      size: this.bytes.byteLength,
      etag: createHash("sha256").update(this.bytes).digest("hex"),
    });
  }
}
/** Adaptador de File/bytes para desarrollo y pruebas; los binarios se descartan al finalizar. */
export class BrowserBytesDocumentProcessor implements KnowledgeManagerDocumentProcessor {
  private readonly repository: KnowledgeRepository;
  private readonly chunks = new Map<string, readonly KnowledgeChunk[]>();
  private readonly uploads = new Map<string, ManagedFileUpload>();
  public constructor(
    repository: KnowledgeRepository = createInMemoryKnowledgeRepository(),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.repository = repository;
  }
  public async process(input: {
    readonly tenantId: string;
    readonly assistantId: string;
    readonly knowledgeBaseId: string;
    readonly documentId: string;
    readonly version: number;
    readonly upload: ManagedFileUpload;
    readonly actorId: string;
    readonly signal?: AbortSignal;
    readonly onProgress?: (
      status: import("@gano-bot/ai-core/knowledge-manager").ManagedDocumentStatus,
      completed: number,
    ) => void | Promise<void>;
  }): Promise<ManagedIngestionResult> {
    const format = formatFor(input.upload);
    const bytes = new Uint8Array(await input.upload.file.arrayBuffer());
    if (bytes.byteLength === 0)
      throw new KnowledgeError("INVALID_DOCUMENT", "El archivo está vacío.");
    if (format.binary) validateSignature(format.kind, bytes);
    const registry = createKnowledgeRegistry();
    const source = createKnowledgeSource({
      id: "browser-upload",
      kind: "custom",
      name: "Browser upload",
      enabled: true,
    });
    const connector = new BytesConnector(bytes, input.upload.file.type);
    registry.registerSource(source);
    registry.registerConnector(connector);
    for (const loader of createLocalDocumentLoaders())
      registry.registerLoader(loader);
    for (const parser of createLocalDocumentParsers())
      registry.registerParser(parser);
    registry.registerChunker(createParagraphChunkingStrategy());
    registry.registerChunker(createMarkdownChunkingStrategy());
    registry.registerChunker(createHeadingChunkingStrategy());
    const pipeline = createKnowledgeIngestionPipeline({
      registry,
      repository: this.repository,
      configuration: {
        deduplicate: true,
        allowReingestion: input.upload.replaceDocumentId !== undefined,
        continueOnPartialError: false,
      },
    });
    const result = await pipeline.ingest({
      sourceId: source.id,
      connectorId: connector.id,
      loaderId: `${format.kind}-document-loader`,
      parserId: `${format.kind}-document-parser`,
      chunkingStrategyId: format.chunkerId,
      item: Object.freeze({
        sourceId: source.id,
        externalId: input.upload.file.name,
        name: input.upload.file.name,
        mimeType: input.upload.file.type,
        size: input.upload.file.size,
      }),
      identity: Object.freeze({
        tenantId: input.tenantId,
        assistantId: input.assistantId,
        knowledgeBaseId: input.knowledgeBaseId,
        documentId: input.documentId,
        version: String(input.version),
      }),
      language: input.upload.language ?? "es",
      tags: input.upload.tags,
      permissions: Object.freeze({
        public: false,
        allowedActorIds: Object.freeze([input.actorId]),
      }),
      metadata: Object.freeze({
        upload: "browser-bytes",
        originalFileName: input.upload.file.name,
      }),
      context: Object.freeze({
        requestId: `request-${input.documentId}`,
        correlationId: `correlation-${input.documentId}`,
        tenantId: input.tenantId,
        assistantId: input.assistantId,
        knowledgeBaseId: input.knowledgeBaseId,
        actorId: input.actorId,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        onProgress: async (progress: KnowledgeProgress) => {
          const mapped =
            progress.stage === "pending"
              ? "queued"
              : progress.stage === "partial"
                ? "partially-ready"
                : progress.stage === "embedding"
                  ? "embedding-pending"
                  : progress.stage === "indexing"
                    ? "indexing-pending"
                    : progress.stage;
          await input.onProgress?.(mapped, progress.completed);
        },
      }),
    });
    this.chunks.set(`${input.tenantId}:${input.documentId}`, result.chunks);
    this.uploads.set(`${input.tenantId}:${input.documentId}`, input.upload);
    const timestamp = this.now();
    const sections = Object.freeze([
      ...new Set(
        result.chunks
          .map((chunk) => chunk.metadata.section)
          .filter((value): value is string => value !== undefined),
      ),
    ]);
    const pages = Object.freeze([
      ...new Set(
        result.chunks
          .map((chunk) => chunk.metadata.page)
          .filter((value): value is number => value !== undefined),
      ),
    ]);
    const document: ManagedDocument = Object.freeze({
      documentId: input.documentId,
      tenantId: input.tenantId,
      knowledgeBaseId: input.knowledgeBaseId,
      assistantId: input.assistantId,
      title: input.upload.title?.trim() || input.upload.file.name,
      originalFileName: input.upload.file.name,
      source: "browser-upload",
      sourceKind: format.kind,
      extension: extension(input.upload.file.name),
      mimeType: input.upload.file.type,
      sizeBytes: bytes.byteLength,
      language: input.upload.language ?? "es",
      checksum: result.document.checksum,
      version: input.version,
      status: "ready",
      collectionIds: Object.freeze([]),
      tags: Object.freeze(
        input.upload.tags === undefined ? [] : [...input.upload.tags],
      ),
      permissions: result.document.permissions,
      metadata: Object.freeze({
        format: format.kind,
        embeddingState: "pending",
        retrievalMode: "lexical",
        sections: JSON.stringify(sections),
        pages: JSON.stringify(pages),
      }),
      createdBy: input.actorId,
      updatedBy: input.actorId,
      createdAt: timestamp,
      updatedAt: timestamp,
      processedAt: timestamp,
      indexedAt: timestamp,
      chunkCount: result.chunks.length,
    });
    bytes.fill(0);
    return Object.freeze({
      document,
      chunks: result.chunks,
      deduplicated: result.deduplicated,
    });
  }
  public async reprocess(
    document: ManagedDocument,
    actorId: string,
    signal?: AbortSignal,
    onProgress?: (
      status: import("@gano-bot/ai-core/knowledge-manager").ManagedDocumentStatus,
      completed: number,
    ) => void | Promise<void>,
  ): Promise<ManagedIngestionResult> {
    const upload = this.uploads.get(
      `${document.tenantId}:${document.documentId}`,
    );
    if (upload === undefined)
      throw new KnowledgeError(
        "INVALID_DOCUMENT",
        "Los bytes de sesión ya no están disponibles para reprocesar.",
      );
    return this.process({
      tenantId: document.tenantId,
      assistantId: document.assistantId,
      knowledgeBaseId: document.knowledgeBaseId,
      documentId: document.documentId,
      version: document.version + 1,
      upload: Object.freeze({
        ...upload,
        replaceDocumentId: document.documentId,
      }),
      actorId,
      ...(signal === undefined ? {} : { signal }),
      ...(onProgress === undefined ? {} : { onProgress }),
    });
  }
  public async reindex(
    document: ManagedDocument,
    signal?: AbortSignal,
  ): Promise<readonly KnowledgeChunk[]> {
    if (signal?.aborted === true)
      throw new KnowledgeError("REQUEST_CANCELLED", "Operación cancelada.");
    return (
      this.chunks.get(`${document.tenantId}:${document.documentId}`) ??
      Object.freeze([])
    );
  }
  public async getChunks(
    document: ManagedDocument,
  ): Promise<readonly KnowledgeChunk[]> {
    return (
      this.chunks.get(`${document.tenantId}:${document.documentId}`) ??
      Object.freeze([])
    );
  }
}
