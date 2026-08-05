import type {
  KnowledgePage,
  KnowledgeCollection,
  KnowledgeFolder,
  KnowledgeVersion,
  ManagedDocument,
  ManagedDocumentPreview,
  ManagedKnowledgeBase,
} from "@gano-bot/ai-core/knowledge-manager";
export interface KnowledgeAssistantOption {
  readonly id: string;
  readonly name: string;
  readonly tenantId: string;
}
export interface DocumentFilters {
  readonly folderId?: string;
  readonly collectionId?: string;
  readonly tags?: readonly string[];
}
export interface KnowledgeManagerJob {
  readonly jobId: string;
  readonly status:
    | "queued"
    | "processing"
    | "completed"
    | "partially-completed"
    | "failed"
    | "cancelled";
  readonly progress: number;
  readonly currentStage: string;
  readonly documentIds: readonly string[];
  readonly processedFiles: number;
  readonly failedFiles: number;
  readonly totalFiles: number;
  readonly errors: readonly Readonly<{
    readonly fileName: string;
    readonly code: string;
    readonly message: string;
  }>[];
}
interface Envelope<T> {
  readonly success: true;
  readonly data: T;
}
export interface KnowledgeManagerClient {
  listBases(
    search?: string,
    signal?: AbortSignal,
  ): Promise<KnowledgePage<ManagedKnowledgeBase>>;
  createBase(name: string, signal?: AbortSignal): Promise<ManagedKnowledgeBase>;
  upload(
    baseId: string,
    assistantId: string,
    files: readonly File[],
    signal?: AbortSignal,
  ): Promise<KnowledgeManagerJob>;
  listDocuments(
    baseId: string,
    filters?: DocumentFilters,
    signal?: AbortSignal,
  ): Promise<readonly ManagedDocument[]>;
  updateDocument(id: string, input: Readonly<{ title: string; language: string; tags: readonly string[] }>, signal?: AbortSignal): Promise<ManagedDocument>;
  listFolders(baseId: string, signal?: AbortSignal): Promise<readonly KnowledgeFolder[]>;
  createFolder(baseId: string, name: string, signal?: AbortSignal): Promise<KnowledgeFolder>;
  renameFolder(baseId: string, id: string, name: string, signal?: AbortSignal): Promise<KnowledgeFolder>;
  deleteFolder(baseId: string, id: string, signal?: AbortSignal): Promise<boolean>;
  moveDocument(id: string, folderId?: string, signal?: AbortSignal): Promise<ManagedDocument>;
  listCollections(baseId: string, signal?: AbortSignal): Promise<readonly KnowledgeCollection[]>;
  createCollection(baseId: string, name: string, signal?: AbortSignal): Promise<KnowledgeCollection>;
  setDocumentCollections(id: string, collectionIds: readonly string[], signal?: AbortSignal): Promise<ManagedDocument>;
  listVersions<T>(kind: "bases" | "documents", id: string, signal?: AbortSignal): Promise<readonly KnowledgeVersion<T>[]>;
  restoreVersion<T>(kind: "bases" | "documents", id: string, versionId: string, signal?: AbortSignal): Promise<T>;
  listAssistants(signal?: AbortSignal): Promise<readonly KnowledgeAssistantOption[]>;
  associateAssistant(baseId: string, assistant: KnowledgeAssistantOption, signal?: AbortSignal): Promise<ManagedKnowledgeBase>;
  disassociateAssistant(baseId: string, assistantId: string, signal?: AbortSignal): Promise<ManagedKnowledgeBase>;
  preview(
    documentId: string,
    signal?: AbortSignal,
  ): Promise<ManagedDocumentPreview>;
  reindex(documentId: string, signal?: AbortSignal): Promise<ManagedDocument>;
  reprocess(documentId: string, signal?: AbortSignal): Promise<ManagedDocument>;
  archiveDocument(
    documentId: string,
    signal?: AbortSignal,
  ): Promise<ManagedDocument>;
  restoreDocument(
    documentId: string,
    signal?: AbortSignal,
  ): Promise<ManagedDocument>;
  retry(jobId: string, signal?: AbortSignal): Promise<KnowledgeManagerJob>;
  cancel(jobId: string, signal?: AbortSignal): Promise<KnowledgeManagerJob>;
}
export interface BackendKnowledgeManagerClientConfig {
  readonly apiUrl?: string;
  readonly token?: string;
  readonly fetchImplementation?: typeof fetch;
  readonly timeoutMilliseconds?: number;
}
export class BackendKnowledgeManagerClient implements KnowledgeManagerClient {
  private readonly apiUrl: string;
  private readonly token: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly timeout: number;
  public constructor(config: BackendKnowledgeManagerClientConfig = {}) {
    this.apiUrl = (config.apiUrl ?? "").replace(/\/$/, "");
    this.token =
      config.token ?? "dev:development-tenant:developer-user:tenant-admin";
    this.fetchImplementation = config.fetchImplementation ?? fetch.bind(globalThis);
    this.timeout = config.timeoutMilliseconds ?? 30000;
  }
  public listBases(search = "", signal?: AbortSignal) {
    return this.request<KnowledgePage<ManagedKnowledgeBase>>(
      `/v1/knowledge-manager/bases?search=${encodeURIComponent(search)}`,
      { method: "GET" },
      signal,
    );
  }
  public createBase(name: string, signal?: AbortSignal) {
    return this.request<ManagedKnowledgeBase>(
      "/v1/knowledge-manager/bases",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      },
      signal,
    );
  }
  public upload(
    baseId: string,
    assistantId: string,
    files: readonly File[],
    signal?: AbortSignal,
  ) {
    const form = new FormData();
    form.set("assistantId", assistantId);
    for (const file of files) form.append("files", file, file.name);
    return this.request<KnowledgeManagerJob>(
      `/v1/knowledge-manager/bases/${encodeURIComponent(baseId)}/documents`,
      { method: "POST", body: form },
      signal,
    );
  }
  public listDocuments(baseId: string, filters: DocumentFilters = {}, signal?: AbortSignal) {
    const query = new URLSearchParams();
    if (filters.folderId !== undefined) query.set("folderId", filters.folderId);
    if (filters.collectionId !== undefined) query.set("collectionId", filters.collectionId);
    for (const tag of filters.tags ?? []) query.append("tag", tag);
    return this.request<readonly ManagedDocument[]>(
      `/v1/knowledge-manager/bases/${encodeURIComponent(baseId)}/documents${query.size === 0 ? "" : `?${query.toString()}`}`,
      { method: "GET" },
      signal,
    );
  }
  public updateDocument(id: string, input: Readonly<{ title: string; language: string; tags: readonly string[] }>, signal?: AbortSignal) {
    return this.json<ManagedDocument>(`/v1/knowledge-manager/documents/${encodeURIComponent(id)}`, "PATCH", input, signal);
  }
  public listFolders(baseId: string, signal?: AbortSignal) {
    return this.request<readonly KnowledgeFolder[]>(`/v1/knowledge-manager/bases/${encodeURIComponent(baseId)}/folders`, { method: "GET" }, signal);
  }
  public createFolder(baseId: string, name: string, signal?: AbortSignal) {
    return this.json<KnowledgeFolder>(`/v1/knowledge-manager/bases/${encodeURIComponent(baseId)}/folders`, "POST", { name }, signal);
  }
  public renameFolder(baseId: string, id: string, name: string, signal?: AbortSignal) {
    return this.json<KnowledgeFolder>(`/v1/knowledge-manager/folders/${encodeURIComponent(id)}`, "PATCH", { baseId, name }, signal);
  }
  public async deleteFolder(baseId: string, id: string, signal?: AbortSignal) {
    const value = await this.request<Readonly<{ deleted: boolean }>>(`/v1/knowledge-manager/folders/${encodeURIComponent(id)}?baseId=${encodeURIComponent(baseId)}`, { method: "DELETE" }, signal);
    return value.deleted;
  }
  public moveDocument(id: string, folderId?: string, signal?: AbortSignal) {
    return this.json<ManagedDocument>(`/v1/knowledge-manager/documents/${encodeURIComponent(id)}/folder`, "PUT", { folderId: folderId ?? "" }, signal);
  }
  public listCollections(baseId: string, signal?: AbortSignal) {
    return this.request<readonly KnowledgeCollection[]>(`/v1/knowledge-manager/bases/${encodeURIComponent(baseId)}/collections`, { method: "GET" }, signal);
  }
  public createCollection(baseId: string, name: string, signal?: AbortSignal) {
    return this.json<KnowledgeCollection>(`/v1/knowledge-manager/bases/${encodeURIComponent(baseId)}/collections`, "POST", { name }, signal);
  }
  public setDocumentCollections(id: string, collectionIds: readonly string[], signal?: AbortSignal) {
    return this.json<ManagedDocument>(`/v1/knowledge-manager/documents/${encodeURIComponent(id)}/collections`, "PUT", { collectionIds }, signal);
  }
  public listVersions<T>(kind: "bases" | "documents", id: string, signal?: AbortSignal) {
    return this.request<readonly KnowledgeVersion<T>[]>(`/v1/knowledge-manager/${kind}/${encodeURIComponent(id)}/versions`, { method: "GET" }, signal);
  }
  public restoreVersion<T>(kind: "bases" | "documents", id: string, versionId: string, signal?: AbortSignal) {
    return this.request<T>(`/v1/knowledge-manager/${kind}/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}`, { method: "POST" }, signal);
  }
  public async listAssistants(signal?: AbortSignal) {
    const values = await this.request<readonly Readonly<{ descriptor: Readonly<{ id: string; name?: string; tenantId?: string }> }>[]>("/v1/assistants", { method: "GET" }, signal);
    return Object.freeze(values.map(({ descriptor }) => Object.freeze({ id: descriptor.id, name: descriptor.name ?? descriptor.id, tenantId: descriptor.tenantId ?? "development-tenant" })));
  }
  public associateAssistant(baseId: string, assistant: KnowledgeAssistantOption, signal?: AbortSignal) {
    return this.json<ManagedKnowledgeBase>(`/v1/knowledge-manager/bases/${encodeURIComponent(baseId)}/assistants/${encodeURIComponent(assistant.id)}`, "POST", { assistantTenantId: assistant.tenantId }, signal);
  }
  public disassociateAssistant(baseId: string, assistantId: string, signal?: AbortSignal) {
    return this.request<ManagedKnowledgeBase>(`/v1/knowledge-manager/bases/${encodeURIComponent(baseId)}/assistants/${encodeURIComponent(assistantId)}`, { method: "DELETE" }, signal);
  }
  public preview(id: string, signal?: AbortSignal) {
    return this.request<ManagedDocumentPreview>(
      `/v1/knowledge-manager/documents/${encodeURIComponent(id)}/preview`,
      { method: "GET" },
      signal,
    );
  }
  public reindex(id: string, signal?: AbortSignal) {
    return this.action(id, "reindex", signal);
  }
  public reprocess(id: string, signal?: AbortSignal) {
    return this.action(id, "reprocess", signal);
  }
  public archiveDocument(id: string, signal?: AbortSignal) {
    return this.action(id, "archive", signal);
  }
  public restoreDocument(id: string, signal?: AbortSignal) {
    return this.action(id, "restore", signal);
  }
  public retry(id: string, signal?: AbortSignal) {
    return this.request<KnowledgeManagerJob>(
      `/v1/knowledge-manager/jobs/${encodeURIComponent(id)}/retry`,
      { method: "POST" },
      signal,
    );
  }
  public cancel(id: string, signal?: AbortSignal) {
    return this.request<KnowledgeManagerJob>(
      `/v1/knowledge-manager/jobs/${encodeURIComponent(id)}/cancel`,
      { method: "POST" },
      signal,
    );
  }
  private action(id: string, action: string, signal?: AbortSignal) {
    return this.request<ManagedDocument>(
      `/v1/knowledge-manager/documents/${encodeURIComponent(id)}/${action}`,
      { method: "POST" },
      signal,
    );
  }
  private json<T>(path: string, method: "POST" | "PATCH" | "PUT", value: unknown, signal?: AbortSignal) {
    return this.request<T>(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(value) }, signal);
  }
  private async request<T>(
    path: string,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout);
    const abort = (): void => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${this.token}`);
      const response = await this.fetchImplementation(`${this.apiUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
      const text = await response.text();
      const parsed: unknown = text === "" ? undefined : JSON.parse(text);
      if (
        !response.ok ||
        typeof parsed !== "object" ||
        parsed === null ||
        !("success" in parsed) ||
        parsed.success !== true ||
        !("data" in parsed)
      )
        throw new Error(`Knowledge Manager HTTP ${response.status}`);
      return (parsed as Envelope<T>).data;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
}
