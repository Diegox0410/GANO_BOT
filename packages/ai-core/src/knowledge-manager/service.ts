import { createDeterministicKnowledgeId } from "../knowledge/index.js";
import { KnowledgeManagerError } from "./errors.js";
import type { KnowledgeManagerRepository } from "./repository.js";
import type {
  DocumentQuery,
  KnowledgeActivity,
  KnowledgeBaseQuery,
  KnowledgeCollection,
  KnowledgeFolder,
  KnowledgeManagerDocumentProcessor,
  KnowledgeManagerPermission,
  KnowledgeManagerPrincipal,
  KnowledgeManagerStatistics,
  KnowledgePage,
  KnowledgeVersion,
  ManagedDocument,
  ManagedDocumentPreview,
  ManagedFileUpload,
  ManagedIngestionResult,
  ManagedKnowledgeBase,
} from "./types.js";

const PUBLIC_PERMISSIONS = Object.freeze({ public: false });
function normalized(value: string, label: string): string {
  const result = value.trim();
  if (result.length === 0 || result.length > 160)
    throw new KnowledgeManagerError("INVALID_INPUT", `${label} no es válido.`);
  return result;
}
function slug(value: string): string {
  const result = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized(result, "slug");
}
function requirePermission(
  principal: KnowledgeManagerPrincipal,
  permission: KnowledgeManagerPermission,
): void {
  if (principal.permissions.includes(permission)) return;
  throw new KnowledgeManagerError(
    "FORBIDDEN",
    `Falta el permiso ${permission}.`,
  );
}
function ensureTenant(
  principal: KnowledgeManagerPrincipal,
  tenantId: string,
): void {
  if (principal.tenantId !== tenantId)
    throw new KnowledgeManagerError(
      "TENANT_MISMATCH",
      "El recurso no pertenece al tenant autorizado.",
    );
}
function count(values: readonly string[]): Readonly<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return Object.freeze(result);
}
export interface CreateKnowledgeBaseInput {
  readonly name: string;
  readonly description?: string;
  readonly language?: string;
  readonly allowedLanguages?: readonly string[];
  readonly tags?: readonly string[];
  readonly metadata?: ManagedKnowledgeBase["metadata"];
}
export interface UpdateKnowledgeBaseInput {
  readonly name?: string;
  readonly description?: string;
  readonly language?: string;
  readonly allowedLanguages?: readonly string[];
  readonly tags?: readonly string[];
  readonly metadata?: ManagedKnowledgeBase["metadata"];
}
export interface KnowledgeManagerServiceConfig {
  readonly repository: KnowledgeManagerRepository;
  readonly processor?: KnowledgeManagerDocumentProcessor;
  readonly now?: () => string;
  readonly generateId?: (prefix: string) => string;
  readonly maximumFileBytes?: number;
}
export class KnowledgeManagerService {
  private readonly now: () => string;
  private readonly id: (prefix: string) => string;
  private readonly maximumFileBytes: number;
  public constructor(private readonly config: KnowledgeManagerServiceConfig) {
    this.now = config.now ?? (() => new Date().toISOString());
    this.id =
      config.generateId ?? ((prefix) => `${prefix}-${crypto.randomUUID()}`);
    this.maximumFileBytes = config.maximumFileBytes ?? 25 * 1024 * 1024;
  }
  public async createBase(
    principal: KnowledgeManagerPrincipal,
    input: CreateKnowledgeBaseInput,
  ): Promise<ManagedKnowledgeBase> {
    requirePermission(principal, "knowledge:create");
    const timestamp = this.now();
    const name = normalized(input.name, "name");
    const value: ManagedKnowledgeBase = Object.freeze({
      knowledgeBaseId: this.id("kb"),
      tenantId: principal.tenantId,
      name,
      slug: slug(name),
      description: input.description?.trim() ?? "",
      language: input.language ?? "es",
      allowedLanguages: Object.freeze(
        input.allowedLanguages === undefined
          ? [input.language ?? "es"]
          : [...input.allowedLanguages],
      ),
      tags: Object.freeze(
        input.tags === undefined
          ? []
          : [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))],
      ),
      status: "draft",
      version: 1,
      ownerId: principal.actorId,
      createdBy: principal.actorId,
      updatedBy: principal.actorId,
      createdAt: timestamp,
      updatedAt: timestamp,
      assistantIds: Object.freeze([]),
      documentCount: 0,
      chunkCount: 0,
      totalSizeBytes: 0,
      configuration: Object.freeze({
        retrievalEnabled: true,
        embeddingState: "not-configured",
        chunkingStrategyId: "heading",
      }),
      permissions: PUBLIC_PERMISSIONS,
      metadata: Object.freeze({ ...input.metadata }),
    });
    await this.config.repository.saveBase(value);
    await this.record(
      principal,
      value.knowledgeBaseId,
      "knowledge-base.created",
    );
    await this.snapshotBase(principal, value, "Creación");
    return value;
  }
  public async getBase(
    principal: KnowledgeManagerPrincipal,
    id: string,
  ): Promise<ManagedKnowledgeBase> {
    requirePermission(principal, "knowledge:read");
    const value = await this.config.repository.getBase(principal.tenantId, id);
    if (value === undefined)
      throw new KnowledgeManagerError(
        "NOT_FOUND",
        "Base de conocimiento no encontrada.",
      );
    return value;
  }
  public async listBases(
    principal: KnowledgeManagerPrincipal,
    query: KnowledgeBaseQuery = {},
  ): Promise<KnowledgePage<ManagedKnowledgeBase>> {
    requirePermission(principal, "knowledge:read");
    let values = [
      ...(await this.config.repository.listBases(principal.tenantId)),
    ];
    const search = query.search?.trim().toLowerCase();
    if (search !== undefined && search.length > 0)
      values = values.filter((v) =>
        `${v.name} ${v.description} ${v.tags.join(" ")}`
          .toLowerCase()
          .includes(search),
      );
    if (query.statuses !== undefined)
      values = values.filter((v) => query.statuses?.includes(v.status));
    if (query.tags !== undefined)
      values = values.filter((v) =>
        query.tags?.every((tag) => v.tags.includes(tag)),
      );
    const sortKey = query.sort ?? "updatedAt";
    const direction = query.direction === "asc" ? 1 : -1;
    values.sort(
      (a, b) =>
        String(a[sortKey]).localeCompare(String(b[sortKey])) * direction,
    );
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const start = (page - 1) * pageSize;
    return Object.freeze({
      items: Object.freeze(values.slice(start, start + pageSize)),
      page,
      pageSize,
      total: values.length,
      hasNext: start + pageSize < values.length,
      hasPrevious: page > 1,
    });
  }
  public async updateBase(
    principal: KnowledgeManagerPrincipal,
    id: string,
    input: UpdateKnowledgeBaseInput,
  ): Promise<ManagedKnowledgeBase> {
    requirePermission(principal, "knowledge:update");
    const current = await this.getBase(principal, id);
    const name =
      input.name === undefined ? current.name : normalized(input.name, "name");
    const value: ManagedKnowledgeBase = Object.freeze({
      ...current,
      name,
      slug: input.name === undefined ? current.slug : slug(name),
      description: input.description?.trim() ?? current.description,
      language: input.language ?? current.language,
      allowedLanguages:
        input.allowedLanguages === undefined
          ? current.allowedLanguages
          : Object.freeze([...input.allowedLanguages]),
      tags:
        input.tags === undefined
          ? current.tags
          : Object.freeze([...new Set(input.tags)]),
      metadata:
        input.metadata === undefined
          ? current.metadata
          : Object.freeze({ ...input.metadata }),
      updatedBy: principal.actorId,
      updatedAt: this.now(),
      version: current.version + 1,
    });
    await this.config.repository.saveBase(value);
    await this.record(principal, id, "knowledge-base.updated");
    await this.snapshotBase(principal, value, "Edición");
    return value;
  }
  public async duplicateBase(
    principal: KnowledgeManagerPrincipal,
    id: string,
  ): Promise<ManagedKnowledgeBase> {
    const current = await this.getBase(principal, id);
    const copy = await this.createBase(principal, {
      name: `${current.name} (copia)`,
      description: current.description,
      language: current.language,
      allowedLanguages: current.allowedLanguages,
      tags: current.tags,
      metadata: current.metadata,
    });
    await this.record(
      principal,
      copy.knowledgeBaseId,
      "knowledge-base.duplicated",
    );
    return copy;
  }
  public async archiveBase(
    principal: KnowledgeManagerPrincipal,
    id: string,
  ): Promise<ManagedKnowledgeBase> {
    requirePermission(principal, "knowledge:archive");
    const current = await this.getBase(principal, id);
    const value = Object.freeze({
      ...current,
      status: "archived" as const,
      archivedAt: this.now(),
      updatedAt: this.now(),
      updatedBy: principal.actorId,
    });
    await this.config.repository.saveBase(value);
    await this.record(principal, id, "knowledge-base.archived", {
      assistantCount: current.assistantIds.length,
    });
    return value;
  }
  public async restoreBase(
    principal: KnowledgeManagerPrincipal,
    id: string,
  ): Promise<ManagedKnowledgeBase> {
    requirePermission(principal, "knowledge:restore");
    const current = await this.getBase(principal, id);
    const { archivedAt: _archivedAt, ...rest } = current;
    const value = Object.freeze({
      ...rest,
      status:
        current.documentCount > 0 ? ("ready" as const) : ("draft" as const),
      updatedAt: this.now(),
      updatedBy: principal.actorId,
    });
    await this.config.repository.saveBase(value);
    await this.record(principal, id, "knowledge-base.restored");
    return value;
  }
  public async deleteBase(
    principal: KnowledgeManagerPrincipal,
    id: string,
  ): Promise<boolean> {
    requirePermission(principal, "knowledge:delete");
    const current = await this.getBase(principal, id);
    if (current.status !== "archived" || current.assistantIds.length > 0)
      throw new KnowledgeManagerError(
        "CONFLICT",
        "Solo puede eliminarse una base archivada y sin asistentes asociados.",
      );
    if (
      (await this.config.repository.listDocuments(principal.tenantId, id))
        .length > 0
    )
      throw new KnowledgeManagerError(
        "CONFLICT",
        "Archive o elimine los documentos antes de eliminar la base.",
      );
    const deleted = await this.config.repository.deleteBase(
      principal.tenantId,
      id,
    );
    await this.record(principal, id, "knowledge-base.deleted");
    return deleted;
  }
  public async associateAssistant(
    principal: KnowledgeManagerPrincipal,
    baseId: string,
    assistantId: string,
    assistantTenantId = principal.tenantId,
  ): Promise<ManagedKnowledgeBase> {
    requirePermission(principal, "knowledge:associate");
    ensureTenant(principal, assistantTenantId);
    const base = await this.getBase(principal, baseId);
    const value = Object.freeze({
      ...base,
      assistantIds: Object.freeze([
        ...new Set([
          ...base.assistantIds,
          normalized(assistantId, "assistantId"),
        ]),
      ]),
      updatedAt: this.now(),
      updatedBy: principal.actorId,
    });
    await this.config.repository.saveBase(value);
    await this.record(principal, baseId, "assistant.associated", {
      assistantId,
    });
    return value;
  }
  public async disassociateAssistant(
    principal: KnowledgeManagerPrincipal,
    baseId: string,
    assistantId: string,
  ): Promise<ManagedKnowledgeBase> {
    requirePermission(principal, "knowledge:associate");
    const base = await this.getBase(principal, baseId);
    const value = Object.freeze({
      ...base,
      assistantIds: Object.freeze(
        base.assistantIds.filter((id) => id !== assistantId),
      ),
      updatedAt: this.now(),
      updatedBy: principal.actorId,
    });
    await this.config.repository.saveBase(value);
    await this.record(principal, baseId, "assistant.disassociated", {
      assistantId,
    });
    return value;
  }
  public async ingest(
    principal: KnowledgeManagerPrincipal,
    baseId: string,
    assistantId: string,
    upload: ManagedFileUpload,
    signal?: AbortSignal,
    onProgress?: (
      status: import("./types.js").ManagedDocumentStatus,
      completed: number,
    ) => void | Promise<void>,
  ): Promise<ManagedIngestionResult> {
    requirePermission(principal, "ingestion:execute");
    requirePermission(principal, "documents:create");
    const base = await this.getBase(principal, baseId);
    if (signal?.aborted === true)
      throw new KnowledgeManagerError("CANCELLED", "Ingesta cancelada.");
    if (upload.file.size === 0)
      throw new KnowledgeManagerError("EMPTY_FILE", "El archivo está vacío.");
    if (upload.file.size > this.maximumFileBytes)
      throw new KnowledgeManagerError(
        "FILE_TOO_LARGE",
        "El archivo excede el tamaño permitido.",
      );
    if (this.config.processor === undefined)
      throw new KnowledgeManagerError(
        "CONFLICT",
        "No hay procesador de documentos configurado.",
      );
    const documentId = upload.replaceDocumentId ?? this.id("document");
    const prior =
      upload.replaceDocumentId === undefined
        ? undefined
        : await this.config.repository.getDocument(
            principal.tenantId,
            upload.replaceDocumentId,
          );
    const result = await this.config.processor.process({
      tenantId: principal.tenantId,
      assistantId,
      knowledgeBaseId: baseId,
      documentId,
      version: (prior?.version ?? 0) + 1,
      upload,
      actorId: principal.actorId,
      ...(signal === undefined ? {} : { signal }),
      onProgress: async (status, completed) => {
        await onProgress?.(status, completed);
        const current = await this.config.repository.getDocument(
          principal.tenantId,
          documentId,
        );
        if (current !== undefined)
          await this.config.repository.saveDocument(
            Object.freeze({ ...current, status, updatedAt: this.now() }),
          );
      },
    });
    ensureTenant(principal, result.document.tenantId);
    await this.config.repository.saveDocument(result.document);
    const documents = await this.config.repository.listDocuments(
      principal.tenantId,
      baseId,
    );
    const updatedBase = Object.freeze({
      ...base,
      status: "ready" as const,
      documentCount: documents.length,
      chunkCount: documents.reduce((sum, item) => sum + item.chunkCount, 0),
      totalSizeBytes: documents.reduce((sum, item) => sum + item.sizeBytes, 0),
      lastIngestionAt: this.now(),
      lastIndexedAt: this.now(),
      updatedAt: this.now(),
    });
    await this.config.repository.saveBase(updatedBase);
    await this.snapshotDocument(
      principal,
      result.document,
      result.deduplicated ? "Deduplicación" : "Ingesta",
    );
    await this.record(
      principal,
      documentId,
      result.deduplicated ? "document.deduplicated" : "document.ingested",
      { chunkCount: result.chunks.length },
    );
    return result;
  }
  public async listDocuments(
    principal: KnowledgeManagerPrincipal,
    baseId: string,
    query: DocumentQuery = {},
  ): Promise<readonly ManagedDocument[]> {
    requirePermission(principal, "documents:read");
    await this.getBase(principal, baseId);
    const values = await this.config.repository.listDocuments(
      principal.tenantId,
      baseId,
    );
    return Object.freeze(
      values.filter(
        (value) =>
          (query.folderId === undefined || value.folderId === query.folderId) &&
          (query.collectionId === undefined ||
            value.collectionIds.includes(query.collectionId)) &&
          (query.tags === undefined ||
            query.tags.every((tag) => value.tags.includes(tag))),
      ),
    );
  }
  public async getDocument(
    principal: KnowledgeManagerPrincipal,
    id: string,
  ): Promise<ManagedDocument> {
    requirePermission(principal, "documents:read");
    return this.requireDocument(principal, id);
  }
  public async updateDocument(
    principal: KnowledgeManagerPrincipal,
    id: string,
    input: {
      readonly title?: string;
      readonly language?: string;
      readonly tags?: readonly string[];
      readonly metadata?: ManagedDocument["metadata"];
    },
  ): Promise<ManagedDocument> {
    requirePermission(principal, "documents:update");
    const current = await this.requireDocument(principal, id);
    const value = Object.freeze({
      ...current,
      title:
        input.title === undefined
          ? current.title
          : normalized(input.title, "title"),
      language:
        input.language === undefined
          ? current.language
          : normalized(input.language, "language"),
      tags:
        input.tags === undefined
          ? current.tags
          : Object.freeze([
              ...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean)),
            ]),
      metadata:
        input.metadata === undefined
          ? current.metadata
          : Object.freeze({ ...input.metadata }),
      version: current.version + 1,
      updatedAt: this.now(),
      updatedBy: principal.actorId,
    });
    await this.config.repository.saveDocument(value);
    await this.snapshotDocument(principal, value, "Actualización de metadata");
    await this.record(principal, id, "document.updated");
    return value;
  }
  public async archiveDocument(
    principal: KnowledgeManagerPrincipal,
    id: string,
  ): Promise<ManagedDocument> {
    requirePermission(principal, "documents:update");
    const current = await this.requireDocument(principal, id);
    const value = Object.freeze({
      ...current,
      status: "archived" as const,
      archivedAt: this.now(),
      updatedAt: this.now(),
      updatedBy: principal.actorId,
    });
    await this.config.repository.saveDocument(value);
    await this.record(principal, id, "document.archived");
    return value;
  }
  public async restoreDocument(
    principal: KnowledgeManagerPrincipal,
    id: string,
  ): Promise<ManagedDocument> {
    requirePermission(principal, "documents:update");
    const current = await this.requireDocument(principal, id);
    const { archivedAt: _archivedAt, ...rest } = current;
    const value = Object.freeze({
      ...rest,
      status: "ready" as const,
      updatedAt: this.now(),
      updatedBy: principal.actorId,
    });
    await this.config.repository.saveDocument(value);
    await this.record(principal, id, "document.restored");
    return value;
  }
  public async deleteDocument(
    principal: KnowledgeManagerPrincipal,
    id: string,
  ): Promise<boolean> {
    requirePermission(principal, "documents:delete");
    const current = await this.requireDocument(principal, id);
    if (current.status !== "archived")
      throw new KnowledgeManagerError(
        "CONFLICT",
        "El documento debe estar archivado antes de eliminarlo.",
      );
    const deleted = await this.config.repository.deleteDocument(
      principal.tenantId,
      id,
    );
    await this.record(principal, id, "document.deleted");
    return deleted;
  }
  public async previewDocument(
    principal: KnowledgeManagerPrincipal,
    id: string,
  ): Promise<ManagedDocumentPreview> {
    requirePermission(principal, "documents:read");
    const document = await this.requireDocument(principal, id);
    const chunks =
      this.config.processor === undefined
        ? Object.freeze([])
        : await this.config.processor.getChunks(document);
    const text = chunks
      .map((chunk) => chunk.content)
      .join("\n\n")
      .slice(0, 4000);
    const sections = Object.freeze([
      ...new Set(
        chunks
          .map((chunk) => chunk.metadata.section)
          .filter((value): value is string => value !== undefined),
      ),
    ]);
    const pages = Object.freeze([
      ...new Set(
        chunks
          .map((chunk) => chunk.metadata.page)
          .filter((value): value is number => value !== undefined),
      ),
    ]);
    const sheets =
      document.sourceKind === "xlsx" ? sections : Object.freeze([]);
    return Object.freeze({
      documentId: document.documentId,
      title: document.title,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      status: document.status,
      checksum: `${document.checksum.slice(0, 12)}…`,
      version: document.version,
      metadata: Object.freeze({ ...document.metadata }),
      sections,
      pages,
      sheets,
      chunks: Object.freeze(
        chunks
          .slice(0, 5)
          .map((chunk) =>
            Object.freeze({
              id: chunk.id,
              text: chunk.content.slice(0, 500),
              index: chunk.metadata.chunkIndex,
            }),
          ),
      ),
      extractedText: text,
      ...(document.error === undefined ? {} : { error: document.error }),
    });
  }
  public async reprocessDocument(
    principal: KnowledgeManagerPrincipal,
    id: string,
    signal?: AbortSignal,
    onProgress?: (
      status: import("./types.js").ManagedDocumentStatus,
      completed: number,
    ) => void | Promise<void>,
  ): Promise<ManagedDocument> {
    requirePermission(principal, "documents:reprocess");
    const current = await this.requireDocument(principal, id);
    if (this.config.processor === undefined)
      throw new KnowledgeManagerError(
        "CONFLICT",
        "No hay procesador configurado.",
      );
    const result = await this.config.processor.reprocess(
      current,
      principal.actorId,
      signal,
      onProgress,
    );
    await this.config.repository.saveDocument(result.document);
    await this.snapshotDocument(principal, result.document, "Reprocesamiento");
    await this.record(principal, id, "document.reprocessed");
    return result.document;
  }
  public async createFolder(
    principal: KnowledgeManagerPrincipal,
    baseId: string,
    name: string,
    parentId?: string,
  ): Promise<KnowledgeFolder> {
    requirePermission(principal, "knowledge:update");
    await this.getBase(principal, baseId);
    if (parentId !== undefined) {
      const folders = await this.config.repository.listFolders(
        principal.tenantId,
        baseId,
      );
      if (!folders.some((folder) => folder.folderId === parentId))
        throw new KnowledgeManagerError(
          "NOT_FOUND",
          "Carpeta padre no encontrada.",
        );
    }
    const value = Object.freeze({
      folderId: this.id("folder"),
      tenantId: principal.tenantId,
      knowledgeBaseId: baseId,
      name: normalized(name, "name"),
      ...(parentId === undefined ? {} : { parentId }),
      createdAt: this.now(),
    });
    await this.config.repository.saveFolder(value);
    await this.record(principal, value.folderId, "folder.created");
    return value;
  }
  public async listFolders(
    principal: KnowledgeManagerPrincipal,
    baseId: string,
  ): Promise<readonly KnowledgeFolder[]> {
    requirePermission(principal, "knowledge:read");
    await this.getBase(principal, baseId);
    return this.config.repository.listFolders(principal.tenantId, baseId);
  }
  public async renameFolder(
    principal: KnowledgeManagerPrincipal,
    baseId: string,
    folderId: string,
    name: string,
  ): Promise<KnowledgeFolder> {
    requirePermission(principal, "knowledge:update");
    const value = (await this.listFolders(principal, baseId)).find(
      (folder) => folder.folderId === folderId,
    );
    if (value === undefined)
      throw new KnowledgeManagerError("NOT_FOUND", "Carpeta no encontrada.");
    const updated = Object.freeze({ ...value, name: normalized(name, "name") });
    await this.config.repository.saveFolder(updated);
    await this.record(principal, folderId, "folder.renamed");
    return updated;
  }
  public async deleteFolder(
    principal: KnowledgeManagerPrincipal,
    baseId: string,
    folderId: string,
  ): Promise<boolean> {
    requirePermission(principal, "knowledge:update");
    const folders = await this.listFolders(principal, baseId);
    if (
      folders.some((folder) => folder.parentId === folderId) ||
      (await this.listDocuments(principal, baseId)).some(
        (document) => document.folderId === folderId,
      )
    )
      throw new KnowledgeManagerError(
        "CONFLICT",
        "Solo puede eliminarse una carpeta vacía y sin descendientes.",
      );
    return this.config.repository.deleteFolder(principal.tenantId, folderId);
  }
  public async moveDocument(
    principal: KnowledgeManagerPrincipal,
    documentId: string,
    folderId?: string,
  ): Promise<ManagedDocument> {
    requirePermission(principal, "documents:update");
    const current = await this.requireDocument(principal, documentId);
    if (folderId !== undefined) {
      const folders = await this.config.repository.listFolders(
        principal.tenantId,
        current.knowledgeBaseId,
      );
      if (!folders.some((folder) => folder.folderId === folderId))
        throw new KnowledgeManagerError("NOT_FOUND", "Carpeta no encontrada.");
    }
    const { folderId: _old, ...rest } = current;
    const value = Object.freeze({
      ...rest,
      ...(folderId === undefined ? {} : { folderId }),
      updatedAt: this.now(),
      updatedBy: principal.actorId,
    });
    await this.config.repository.saveDocument(value);
    await this.snapshotDocument(principal, value, "Movimiento de carpeta");
    await this.record(principal, documentId, "document.moved");
    return value;
  }
  public async createCollection(
    principal: KnowledgeManagerPrincipal,
    baseId: string,
    name: string,
  ): Promise<KnowledgeCollection> {
    requirePermission(principal, "knowledge:update");
    await this.getBase(principal, baseId);
    const value = Object.freeze({
      collectionId: this.id("collection"),
      tenantId: principal.tenantId,
      knowledgeBaseId: baseId,
      name: normalized(name, "name"),
      documentIds: Object.freeze([]),
      createdAt: this.now(),
    });
    await this.config.repository.saveCollection(value);
    return value;
  }
  public async listCollections(
    principal: KnowledgeManagerPrincipal,
    baseId: string,
  ): Promise<readonly KnowledgeCollection[]> {
    requirePermission(principal, "knowledge:read");
    await this.getBase(principal, baseId);
    return this.config.repository.listCollections(principal.tenantId, baseId);
  }
  public async setDocumentCollections(
    principal: KnowledgeManagerPrincipal,
    documentId: string,
    collectionIds: readonly string[],
  ): Promise<ManagedDocument> {
    requirePermission(principal, "documents:update");
    const current = await this.requireDocument(principal, documentId);
    const collections = await this.config.repository.listCollections(
      principal.tenantId,
      current.knowledgeBaseId,
    );
    if (
      collectionIds.some(
        (id) => !collections.some((value) => value.collectionId === id),
      )
    )
      throw new KnowledgeManagerError("NOT_FOUND", "Colección no encontrada.");
    const value = Object.freeze({
      ...current,
      collectionIds: Object.freeze([...new Set(collectionIds)]),
      updatedAt: this.now(),
      updatedBy: principal.actorId,
    });
    await this.config.repository.saveDocument(value);
    for (const collection of collections) {
      const contains = value.collectionIds.includes(collection.collectionId);
      const documentIds = contains
        ? [...new Set([...collection.documentIds, documentId])]
        : collection.documentIds.filter((id) => id !== documentId);
      await this.config.repository.saveCollection(
        Object.freeze({ ...collection, documentIds: Object.freeze(documentIds) }),
      );
    }
    await this.snapshotDocument(principal, value, "Actualización de colecciones");
    return value;
  }
  public async reindexDocument(
    principal: KnowledgeManagerPrincipal,
    id: string,
    signal?: AbortSignal,
  ): Promise<ManagedDocument> {
    requirePermission(principal, "documents:reprocess");
    const current = await this.requireDocument(principal, id);
    if (this.config.processor === undefined)
      throw new KnowledgeManagerError(
        "CONFLICT",
        "No hay procesador configurado.",
      );
    const chunks = await this.config.processor.reindex(current, signal);
    const value = Object.freeze({
      ...current,
      status: "ready" as const,
      chunkCount: chunks.length,
      indexedAt: this.now(),
      updatedAt: this.now(),
      updatedBy: principal.actorId,
    });
    await this.config.repository.saveDocument(value);
    await this.record(principal, id, "document.reindexed", {
      chunkCount: chunks.length,
    });
    return value;
  }
  public async reindexKnowledgeBase(
    principal: KnowledgeManagerPrincipal,
    baseId: string,
    signal?: AbortSignal,
  ): Promise<readonly ManagedDocument[]> {
    requirePermission(principal, "documents:reprocess");
    const documents = (await this.listDocuments(principal, baseId)).filter(
      (document) => document.status !== "archived",
    );
    const results: ManagedDocument[] = [];
    for (const document of documents) {
      if (signal?.aborted === true) break;
      results.push(
        await this.reindexDocument(principal, document.documentId, signal),
      );
    }
    await this.record(principal, baseId, "knowledge-base.reindexed", {
      processed: results.length,
      total: documents.length,
    });
    return Object.freeze(results);
  }
  public async restoreVersion<T extends ManagedKnowledgeBase | ManagedDocument>(
    principal: KnowledgeManagerPrincipal,
    resourceId: string,
    versionId: string,
  ): Promise<T> {
    requirePermission(principal, "versions:restore");
    const version = (await this.versions<T>(principal, resourceId)).find(
      (value) => value.versionId === versionId,
    );
    if (version === undefined)
      throw new KnowledgeManagerError("NOT_FOUND", "Versión no encontrada.");
    ensureTenant(principal, version.tenantId);
    const snapshot = version.snapshot;
    if ("knowledgeBaseId" in snapshot && "documentId" in snapshot)
      await this.config.repository.saveDocument(snapshot);
    else await this.config.repository.saveBase(snapshot);
    await this.record(principal, resourceId, "version.restored", { versionId });
    return snapshot;
  }
  public async statistics(
    principal: KnowledgeManagerPrincipal,
  ): Promise<KnowledgeManagerStatistics> {
    requirePermission(principal, "knowledge:read");
    const bases = await this.config.repository.listBases(principal.tenantId);
    const docs = await this.config.repository.listDocuments(principal.tenantId);
    const activity = await this.config.repository.listActivity(
      principal.tenantId,
    );
    const totalChunks = docs.reduce((sum, v) => sum + v.chunkCount, 0);
    const indexed = docs
      .map((v) => v.indexedAt)
      .filter((v): v is string => v !== undefined)
      .sort()
      .at(-1);
    return Object.freeze({
      totalKnowledgeBases: bases.length,
      totalDocuments: docs.length,
      totalChunks,
      totalSizeBytes: docs.reduce((sum, v) => sum + v.sizeBytes, 0),
      readyDocuments: docs.filter((v) => v.status === "ready").length,
      failedDocuments: docs.filter((v) => v.status === "failed").length,
      pendingDocuments: docs.filter(
        (v) => !["ready", "failed", "archived"].includes(v.status),
      ).length,
      archivedDocuments: docs.filter((v) => v.status === "archived").length,
      documentsByType: count(docs.map((v) => v.sourceKind)),
      documentsByLanguage: count(docs.map((v) => v.language)),
      documentsByStatus: count(docs.map((v) => v.status)),
      chunksByKnowledgeBase: Object.freeze(
        Object.fromEntries(
          bases.map((base) => [
            base.knowledgeBaseId,
            docs
              .filter((v) => v.knowledgeBaseId === base.knowledgeBaseId)
              .reduce((sum, v) => sum + v.chunkCount, 0),
          ]),
        ),
      ),
      recentIngestions: Object.freeze(
        activity.filter((v) => v.action.includes("ingest")).slice(-10),
      ),
      averageChunksPerDocument:
        docs.length === 0 ? 0 : totalChunks / docs.length,
      deduplicatedDocuments: activity.filter(
        (v) => v.action === "document.deduplicated",
      ).length,
      ...(indexed === undefined ? {} : { lastIndexedAt: indexed }),
      errorCount: docs.filter((v) => v.error !== undefined).length,
    });
  }
  public async activity(
    principal: KnowledgeManagerPrincipal,
    resourceId?: string,
  ): Promise<readonly KnowledgeActivity[]> {
    requirePermission(principal, "knowledge:read");
    return this.config.repository.listActivity(principal.tenantId, resourceId);
  }
  public async versions<T>(
    principal: KnowledgeManagerPrincipal,
    resourceId: string,
  ): Promise<readonly KnowledgeVersion<T>[]> {
    requirePermission(principal, "versions:read");
    return this.config.repository.listVersions<T>(
      principal.tenantId,
      resourceId,
    );
  }
  private async requireDocument(
    principal: KnowledgeManagerPrincipal,
    id: string,
  ): Promise<ManagedDocument> {
    const value = await this.config.repository.getDocument(
      principal.tenantId,
      id,
    );
    if (value === undefined)
      throw new KnowledgeManagerError("NOT_FOUND", "Documento no encontrado.");
    ensureTenant(principal, value.tenantId);
    return value;
  }
  private async record(
    principal: KnowledgeManagerPrincipal,
    resourceId: string,
    action: string,
    metadata: ManagedKnowledgeBase["metadata"] = {},
  ): Promise<void> {
    const value: KnowledgeActivity = Object.freeze({
      activityId: this.id("activity"),
      tenantId: principal.tenantId,
      resourceId,
      action,
      actorId: principal.actorId,
      timestamp: this.now(),
      metadata: Object.freeze({ ...metadata }),
    });
    await this.config.repository.appendActivity(value);
  }
  private async snapshotBase(
    principal: KnowledgeManagerPrincipal,
    value: ManagedKnowledgeBase,
    reason: string,
  ): Promise<void> {
    await this.config.repository.saveVersion(
      Object.freeze({
        versionId: createDeterministicKnowledgeId(
          `${value.tenantId}:${value.knowledgeBaseId}:${value.version}`,
          "kb-version",
        ),
        tenantId: value.tenantId,
        resourceId: value.knowledgeBaseId,
        version: value.version,
        snapshot: value,
        createdAt: this.now(),
        createdBy: principal.actorId,
        reason,
      }),
    );
  }
  private async snapshotDocument(
    principal: KnowledgeManagerPrincipal,
    value: ManagedDocument,
    reason: string,
  ): Promise<void> {
    await this.config.repository.saveVersion(
      Object.freeze({
        versionId: createDeterministicKnowledgeId(
          `${value.tenantId}:${value.documentId}:${value.version}:${value.checksum}`,
          "document-version",
        ),
        tenantId: value.tenantId,
        resourceId: value.documentId,
        version: value.version,
        snapshot: value,
        createdAt: this.now(),
        createdBy: principal.actorId,
        reason,
      }),
    );
  }
}
