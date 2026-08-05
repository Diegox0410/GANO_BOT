import type {
  KnowledgePage,
  ManagedDocument,
  ManagedDocumentPreview,
  ManagedKnowledgeBase,
} from "@gano-bot/ai-core/knowledge-manager";
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
    signal?: AbortSignal,
  ): Promise<readonly ManagedDocument[]>;
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
  public listDocuments(baseId: string, signal?: AbortSignal) {
    return this.request<readonly ManagedDocument[]>(
      `/v1/knowledge-manager/bases/${encodeURIComponent(baseId)}/documents`,
      { method: "GET" },
      signal,
    );
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
