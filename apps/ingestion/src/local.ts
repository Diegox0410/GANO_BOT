import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import {
  createDocumentLoader,
  createKnowledgeSource,
  KnowledgeError,
  throwIfKnowledgeAborted,
} from "@gano-bot/ai-core/knowledge";
import type {
  DocumentLoader,
  KnowledgeConnector,
  KnowledgeConnectorContent,
  KnowledgeSource,
  KnowledgeSourceItem,
  KnowledgeSourceListRequest,
  KnowledgeSourceListResult,
  KnowledgeConnectorReadRequest,
} from "@gano-bot/ai-core/knowledge";
import { findFormatByPath, LOCAL_FORMATS, sniffMimeType } from "./formats.js";

export interface LocalFileKnowledgeSourceConfig {
  readonly id: string;
  readonly rootDirectory: string;
  readonly name?: string;
}
export function createLocalFileKnowledgeSource(
  config: LocalFileKnowledgeSourceConfig,
): KnowledgeSource {
  return createKnowledgeSource({
    id: config.id,
    kind: "custom",
    name: config.name ?? "Local files",
    uri: resolve(config.rootDirectory),
    enabled: true,
    metadata: { adapter: "local-file" },
  });
}

async function authorizePath(
  rootDirectory: string,
  candidate: string,
): Promise<string> {
  const root = await realpath(resolve(rootDirectory));
  const target = await realpath(resolve(candidate));
  const difference = relative(root, target);
  if (
    difference === "" ||
    (!difference.startsWith(`..${sep}`) &&
      difference !== ".." &&
      !isAbsolute(difference))
  )
    return target;
  throw new KnowledgeError(
    "INVALID_DOCUMENT",
    "La ruta solicitada está fuera del directorio autorizado.",
  );
}
async function collectFiles(
  directory: string,
  signal: AbortSignal | undefined,
): Promise<readonly string[]> {
  throwIfKnowledgeAborted(signal);
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    throwIfKnowledgeAborted(signal);
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(path, signal)));
    else if (entry.isFile() && findFormatByPath(entry.name) !== undefined)
      files.push(path);
  }
  return Object.freeze(files.sort());
}

export class LocalFileKnowledgeConnector implements KnowledgeConnector {
  public readonly id = "local-file";
  public readonly kinds = Object.freeze(["custom"] as const);
  public constructor(
    private readonly rootDirectory: string,
    private readonly maximumBytes = 25 * 1024 * 1024,
  ) {}
  public async list(
    request: KnowledgeSourceListRequest,
  ): Promise<KnowledgeSourceListResult> {
    const root = await authorizePath(
      this.rootDirectory,
      request.source.uri ?? this.rootDirectory,
    );
    const files = await collectFiles(root, request.context.signal);
    const items: KnowledgeSourceItem[] = [];
    for (const file of files.slice(0, request.limit ?? files.length)) {
      const info = await stat(file);
      const format = findFormatByPath(file);
      if (format !== undefined)
        items.push(
          Object.freeze({
            sourceId: request.source.id,
            externalId: relative(root, file),
            name: basename(file),
            uri: file,
            mimeType: format.mimeTypes[0],
            size: info.size,
            modifiedAt: info.mtime.toISOString(),
            metadata: { sourceKind: format.kind },
          }),
        );
    }
    return Object.freeze({ items: Object.freeze(items) });
  }
  public async read(
    request: KnowledgeConnectorReadRequest,
  ): Promise<KnowledgeConnectorContent> {
    throwIfKnowledgeAborted(request.context.signal);
    if (request.item.uri === undefined)
      throw new KnowledgeError(
        "INVALID_DOCUMENT",
        "El archivo local no contiene una ruta.",
      );
    const path = await authorizePath(this.rootDirectory, request.item.uri);
    const format = findFormatByPath(path);
    if (format === undefined)
      throw new KnowledgeError(
        "INVALID_DOCUMENT",
        "La extensión del archivo no está permitida.",
      );
    const info = await stat(path);
    if (info.size > this.maximumBytes)
      throw new KnowledgeError(
        "INGESTION_ERROR",
        "El archivo excede el tamaño máximo permitido.",
      );
    const buffer = await readFile(path, { signal: request.context.signal });
    const data = new Uint8Array(buffer);
    const sniffed = sniffMimeType(data);
    if (format.binary && sniffed === undefined)
      throw new KnowledgeError(
        "INVALID_DOCUMENT",
        "La firma del archivo no coincide con un formato binario permitido.",
      );
    if (format.kind === "pdf" && sniffed !== "application/pdf")
      throw new KnowledgeError(
        "INVALID_DOCUMENT",
        "La firma del archivo no corresponde a PDF.",
      );
    if (
      (format.kind === "docx" || format.kind === "xlsx") &&
      sniffed !== "application/zip"
    )
      throw new KnowledgeError(
        "INVALID_DOCUMENT",
        "La firma del archivo no corresponde a Office Open XML.",
      );
    return Object.freeze({
      data,
      mimeType: format.mimeTypes[0] ?? "application/octet-stream",
      size: data.byteLength,
      etag: createHash("sha256").update(data).digest("hex"),
    });
  }
}

export function createLocalDocumentLoaders(): readonly DocumentLoader[] {
  return Object.freeze(
    LOCAL_FORMATS.map((format) =>
      createDocumentLoader({
        id: `${format.kind}-document-loader`,
        sourceKinds: ["custom", format.kind],
        mimeTypes: format.mimeTypes,
        supports: (request) =>
          format.mimeTypes.includes(request.connectorContent.mimeType),
        load: async (request) => {
          throwIfKnowledgeAborted(request.context.signal);
          const bytes =
            typeof request.connectorContent.data === "string"
              ? new TextEncoder().encode(request.connectorContent.data)
              : request.connectorContent.data;
          let content: string | Uint8Array;
          try {
            content = format.binary
              ? bytes
              : new TextDecoder("utf-8", { fatal: true })
                  .decode(bytes)
                  .replace(/^\uFEFF/, "");
          } catch (error) {
            throw new KnowledgeError(
              "INVALID_DOCUMENT",
              "El documento de texto no usa UTF-8 válido.",
              undefined,
              error,
            );
          }
          return Object.freeze({
            ...request.identity,
            title: request.title,
            source: request.source,
            sourceKind: format.kind,
            mimeType: format.mimeTypes[0] ?? request.connectorContent.mimeType,
            ...(request.language !== undefined
              ? { language: request.language }
              : {}),
            content,
            size: bytes.byteLength,
            checksum: createHash("sha256").update(bytes).digest("hex"),
            ...(request.metadata !== undefined
              ? { metadata: Object.freeze({ ...request.metadata }) }
              : {}),
          });
        },
      }),
    ),
  );
}
