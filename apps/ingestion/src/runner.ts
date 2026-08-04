import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import {
  createHeadingChunkingStrategy,
  createInMemoryKnowledgeRepository,
  createKnowledgeIngestionPipeline,
  createKnowledgeRegistry,
  createMarkdownChunkingStrategy,
  createParagraphChunkingStrategy,
  mapEmbeddingRecords,
} from "@gano-bot/ai-core/knowledge";
import type { AIEmbeddingService } from "@gano-bot/ai-core";
import type {
  EmbeddingRecord,
  KnowledgeIngestionItemResult,
  KnowledgeOperationContext,
  KnowledgeProgress,
  KnowledgeRepository,
} from "@gano-bot/ai-core/knowledge";
import { findFormatByPath } from "./formats.js";
import {
  createLocalDocumentLoaders,
  createLocalFileKnowledgeSource,
  LocalFileKnowledgeConnector,
} from "./local.js";
import { createLocalDocumentParsers } from "./parsers.js";

export interface LocalIngestionConfig {
  readonly rootDirectory: string;
  readonly files?: readonly string[];
  readonly tenantId: string;
  readonly assistantId: string;
  readonly knowledgeBaseId: string;
  readonly version?: string;
  readonly language?: string;
  readonly tags?: readonly string[];
  readonly maximumDocumentBytes?: number;
  readonly allowReingestion?: boolean;
  readonly signal?: AbortSignal;
  readonly embeddingService?: AIEmbeddingService;
  readonly embeddingModel?: string;
  readonly repository?: KnowledgeRepository;
  readonly onProgress?: (
    file: string,
    progress: KnowledgeProgress,
  ) => void | Promise<void>;
}
export interface LocalIngestionFileResult {
  readonly file: string;
  readonly ok: boolean;
  readonly documentId: string;
  readonly chunks: number;
  readonly deduplicated: boolean;
  readonly durationMilliseconds: number;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}
export interface LocalIngestionSummary {
  readonly files: readonly LocalIngestionFileResult[];
  readonly documentCount: number;
  readonly chunkCount: number;
  readonly deduplicatedCount: number;
  readonly failedCount: number;
  readonly durationMilliseconds: number;
  readonly embeddings: readonly EmbeddingRecord[];
}

export async function ingestLocalFiles(
  config: LocalIngestionConfig,
): Promise<LocalIngestionSummary> {
  const startedAt = Date.now();
  const root = resolve(config.rootDirectory);
  const source = createLocalFileKnowledgeSource({
    id: "local-source",
    rootDirectory: root,
  });
  const connector = new LocalFileKnowledgeConnector(
    root,
    config.maximumDocumentBytes,
  );
  const registry = createKnowledgeRegistry();
  registry.registerSource(source);
  registry.registerConnector(connector);
  for (const loader of createLocalDocumentLoaders())
    registry.registerLoader(loader);
  for (const parser of createLocalDocumentParsers())
    registry.registerParser(parser);
  registry.registerChunker(createParagraphChunkingStrategy());
  registry.registerChunker(createMarkdownChunkingStrategy());
  registry.registerChunker(createHeadingChunkingStrategy());
  const repository = config.repository ?? createInMemoryKnowledgeRepository();
  const pipeline = createKnowledgeIngestionPipeline({
    registry,
    repository,
    configuration: {
      maximumDocumentBytes: config.maximumDocumentBytes,
      deduplicate: true,
      allowReingestion: config.allowReingestion ?? false,
      continueOnPartialError: true,
    },
  });
  const baseContext: KnowledgeOperationContext = {
    requestId: randomUUID(),
    correlationId: randomUUID(),
    tenantId: config.tenantId,
    assistantId: config.assistantId,
    knowledgeBaseId: config.knowledgeBaseId,
    ...(config.signal !== undefined ? { signal: config.signal } : {}),
  };
  const listed = await connector.list({ source, context: baseContext });
  const selected =
    config.files === undefined
      ? listed.items
      : listed.items.filter(
          (item) =>
            config.files?.some(
              (file) => resolve(file) === resolve(item.uri ?? ""),
            ) === true,
        );
  const requests = selected.flatMap((item) => {
    const format = findFormatByPath(item.name);
    if (format === undefined) return [];
    const documentId = `document-${Buffer.from(item.externalId).toString("base64url")}`;
    return [
      {
        sourceId: source.id,
        connectorId: connector.id,
        loaderId: `${format.kind}-document-loader`,
        parserId: `${format.kind}-document-parser`,
        chunkingStrategyId: format.chunkerId,
        item,
        identity: {
          tenantId: config.tenantId,
          assistantId: config.assistantId,
          knowledgeBaseId: config.knowledgeBaseId,
          documentId,
          version: config.version ?? "1",
        },
        tags: config.tags,
        language: config.language ?? "es",
        metadata: { localPath: item.externalId, format: format.kind },
        context: {
          ...baseContext,
          onProgress:
            config.onProgress === undefined
              ? undefined
              : (progress: KnowledgeProgress) =>
                  config.onProgress?.(item.uri ?? item.name, progress),
        },
      },
    ];
  });
  const results = await pipeline.ingestMany(requests);
  const files: LocalIngestionFileResult[] = results.map((item, index) =>
    mapFileResult(
      item,
      selected[index]?.uri ?? selected[index]?.name ?? "unknown",
    ),
  );
  const successful = results.filter(
    (
      item,
    ): item is Extract<KnowledgeIngestionItemResult, { readonly ok: true }> =>
      item.ok,
  );
  const embeddings: EmbeddingRecord[] = [];
  if (config.embeddingService !== undefined) {
    for (const item of successful) {
      const response = await config.embeddingService.embed({
        inputs: item.result.chunks.map((chunk) => ({
          id: chunk.id,
          text: chunk.content,
          metadata: { documentId: chunk.metadata.documentId },
        })),
        ...(config.embeddingModel !== undefined
          ? { model: config.embeddingModel }
          : {}),
        ...(config.signal !== undefined ? { signal: config.signal } : {}),
      });
      embeddings.push(
        ...mapEmbeddingRecords(item.result.chunks, response.embeddings),
      );
    }
  }
  return Object.freeze({
    files: Object.freeze(files),
    documentCount: successful.length,
    chunkCount: files.reduce((total, file) => total + file.chunks, 0),
    deduplicatedCount: files.filter((file) => file.deduplicated).length,
    failedCount: files.filter((file) => !file.ok).length,
    durationMilliseconds: Date.now() - startedAt,
    embeddings: Object.freeze(embeddings),
  });
}

function mapFileResult(
  item: KnowledgeIngestionItemResult,
  file: string,
): LocalIngestionFileResult {
  if (item.ok)
    return Object.freeze({
      file,
      ok: true,
      documentId: item.result.document.documentId,
      chunks: item.result.chunks.length,
      deduplicated: item.result.deduplicated,
      durationMilliseconds: item.result.durationMilliseconds,
    });
  return Object.freeze({
    file,
    ok: false,
    documentId: item.request.identity.documentId,
    chunks: 0,
    deduplicated: false,
    durationMilliseconds: 0,
    errorCode: item.error.code,
    errorMessage: item.error.message,
  });
}

export function summarizeLocalIngestion(
  summary: LocalIngestionSummary,
): string {
  return [
    `Archivos: ${summary.files.length}`,
    `Documentos: ${summary.documentCount}`,
    `Chunks: ${summary.chunkCount}`,
    `Deduplicados: ${summary.deduplicatedCount}`,
    `Fallidos: ${summary.failedCount}`,
    `Duración: ${summary.durationMilliseconds} ms`,
    ...summary.files.map(
      (file) =>
        `${file.ok ? "OK" : "ERROR"} ${basename(file.file)} — ${file.chunks} chunks${file.errorMessage === undefined ? "" : ` — ${file.errorMessage}`}`,
    ),
  ].join("\n");
}
