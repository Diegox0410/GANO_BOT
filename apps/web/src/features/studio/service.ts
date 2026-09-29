import { MockChatTransport } from "@gano-bot/chat-widget";
import type {
  UniversalChatTransport,
  WidgetTransportResponse,
} from "@gano-bot/chat-widget";
import { createEmptyAssistant, validateStudioAssistant } from "./domain";
import type {
  AssistantStudioService,
  StudioAssistant,
  StudioDocument,
  StudioKnowledgeBase,
  StudioPrincipal,
  StudioTool,
} from "./domain";
function clone<T>(value: T): T {
  return structuredClone(value);
}
function ensureSignal(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Cancelado", "AbortError");
}
function demoTransport(): UniversalChatTransport {
  return new MockChatTransport(async (request) => {
    ensureSignal(request.signal);
    const now = new Date().toISOString();
    const citation = Object.freeze({
      id: "studio-citation",
      title: "Documento de desarrollo",
      excerpt: "Contexto recuperado por el adaptador offline.",
      section: "Demo",
      page: 1,
    });
    const response: WidgetTransportResponse = Object.freeze({
      conversationId: request.conversationId ?? "studio-conversation",
      message: Object.freeze({
        id: `message-${request.requestId}`,
        role: "assistant",
        content: `Respuesta de prueba para: ${request.message}`,
        timestamp: now,
        status: "completed",
        citations: Object.freeze([citation]),
        warnings: Object.freeze([
          "Respuesta generada por adaptador determinista de desarrollo.",
        ]),
        metadata: Object.freeze({
          requestId: request.requestId,
          correlationId: request.correlationId,
        }),
      }),
      citations: Object.freeze([citation]),
    });
    return response;
  });
}
/** Repositorio y servicio volátil exclusivos para desarrollo y pruebas. */
export class InMemoryAssistantStudioService implements AssistantStudioService {
  public readonly kind = "development-memory" as const;
  private readonly assistants = new Map<string, StudioAssistant>();
  private readonly knowledge: readonly StudioKnowledgeBase[] = Object.freeze([
    {
      id: "kb-handbook",
      name: "Manual de operaciones",
      status: "active",
      documentCount: 2,
    },
    {
      id: "kb-support",
      name: "Centro de soporte",
      status: "active",
      documentCount: 1,
    },
  ]);
  private readonly documents: readonly StudioDocument[] = Object.freeze([
    {
      id: "doc-guide",
      knowledgeBaseId: "kb-handbook",
      title: "Guía general",
      mediaType: "text/markdown",
      status: "ready",
      size: 2048,
      chunks: 8,
      updatedAt: "2026-08-04T12:00:00.000Z",
    },
    {
      id: "doc-faq",
      knowledgeBaseId: "kb-support",
      title: "Preguntas frecuentes",
      mediaType: "application/json",
      status: "ready",
      size: 1024,
      chunks: 5,
      updatedAt: "2026-08-04T12:00:00.000Z",
    },
  ]);
  private readonly tools: readonly StudioTool[] = Object.freeze([
    {
      id: "calculator",
      name: "Calculadora",
      description: "Realiza operaciones aritméticas deterministas.",
      category: "calculation",
      risk: "safe",
      permissions: Object.freeze([]),
      confirmation: "never",
    },
    {
      id: "current-time",
      name: "Hora actual",
      description: "Consulta un reloj inyectado.",
      category: "system",
      risk: "low",
      permissions: Object.freeze(["tools:execute"]),
      confirmation: "risk-based",
    },
  ]);
  public constructor(
    private readonly principal: StudioPrincipal,
    fixtures: readonly StudioAssistant[] = Object.freeze([]),
  ) {
    for (const item of fixtures) this.assistants.set(item.id, clone(item));
  }
  public getPrincipal(): StudioPrincipal {
    return this.principal;
  }
  public async listAssistants(
    signal?: AbortSignal,
  ): Promise<readonly StudioAssistant[]> {
    ensureSignal(signal);
    return Object.freeze(
      [...this.assistants.values()]
        .filter((item) => item.tenantId === this.principal.tenantId)
        .map(clone),
    );
  }
  public async getAssistant(
    id: string,
    signal?: AbortSignal,
  ): Promise<StudioAssistant | undefined> {
    ensureSignal(signal);
    const item = this.assistants.get(id);
    return item?.tenantId === this.principal.tenantId ? clone(item) : undefined;
  }
  public async saveAssistant(
    value: StudioAssistant,
    signal?: AbortSignal,
  ): Promise<StudioAssistant> {
    ensureSignal(signal);
    if (value.tenantId !== this.principal.tenantId)
      throw new Error("No se permite guardar en otro tenant.");
    if (!this.principal.permissions.includes("assistants:write"))
      throw new Error("No tienes permiso para editar asistentes.");
    const current = this.assistants.get(value.id);
    const now = new Date().toISOString();
    const saved = Object.freeze({
      ...clone(value),
      version: (current?.version ?? 0) + 1,
      updatedAt: now,
      updatedBy: this.principal.actorId,
      validation: validateStudioAssistant(value, now),
    });
    this.assistants.set(saved.id, saved);
    return clone(saved);
  }
  public async deleteAssistant(
    id: string,
    signal?: AbortSignal,
  ): Promise<void> {
    ensureSignal(signal);
    if (!this.principal.permissions.includes("assistants:write"))
      throw new Error("No tienes permiso para eliminar asistentes.");
    this.assistants.delete(id);
  }
  public async duplicateAssistant(
    id: string,
    signal?: AbortSignal,
  ): Promise<StudioAssistant> {
    const source = await this.getAssistant(id, signal);
    if (source === undefined) throw new Error("No existe el asistente.");
    let candidate = `${source.id}-copy`;
    let index = 2;
    while (this.assistants.has(candidate)) {
      candidate = `${source.id}-copy-${index++}`;
    }
    const now = new Date().toISOString();
    const copy = Object.freeze({
      ...clone(source),
      id: candidate,
      version: 1,
      status: "draft" as const,
      identity: Object.freeze({
        ...source.identity,
        name: `${source.identity.name} (copia)`,
      }),
      createdAt: now,
      updatedAt: now,
      createdBy: this.principal.actorId,
      updatedBy: this.principal.actorId,
    });
    return this.saveAssistant(copy, signal);
  }
  public async archiveAssistant(
    id: string,
    signal?: AbortSignal,
  ): Promise<StudioAssistant> {
    const value = await this.require(id, signal);
    return this.saveAssistant(
      Object.freeze({ ...value, status: "archived" }),
      signal,
    );
  }
  public async publishAssistant(
    id: string,
    signal?: AbortSignal,
  ): Promise<StudioAssistant> {
    if (!this.principal.permissions.includes("assistants:publish"))
      throw new Error("No tienes permiso para publicar.");
    const value = await this.require(id, signal);
    const validation = validateStudioAssistant(value);
    if (!validation.valid)
      throw new Error("La configuración contiene errores.");
    return this.saveAssistant(
      Object.freeze({ ...value, status: "published", validation }),
      signal,
    );
  }
  public async listKnowledgeBases(
    signal?: AbortSignal,
  ): Promise<readonly StudioKnowledgeBase[]> {
    ensureSignal(signal);
    return clone(this.knowledge);
  }
  public async listDocuments(
    signal?: AbortSignal,
  ): Promise<readonly StudioDocument[]> {
    ensureSignal(signal);
    return clone(this.documents);
  }
  public async listTools(signal?: AbortSignal): Promise<readonly StudioTool[]> {
    ensureSignal(signal);
    return clone(this.tools);
  }
  public async health(signal?: AbortSignal): Promise<"ready"> {
    ensureSignal(signal);
    return "ready";
  }
  public getChatTransport(_assistantId: string): UniversalChatTransport {
    return demoTransport();
  }
  private async require(
    id: string,
    signal?: AbortSignal,
  ): Promise<StudioAssistant> {
    const value = await this.getAssistant(id, signal);
    if (value === undefined) throw new Error("No existe el asistente.");
    return value;
  }
}
export interface BackendAssistantStudioServiceConfig {
  readonly apiUrl: string;
  readonly principal: StudioPrincipal;
  readonly tokenProvider: () => Promise<string | undefined>;
  readonly fetchImplementation?: typeof fetch;
  readonly chatTransportFactory: (
    assistantId: string,
  ) => UniversalChatTransport;
}
export class BackendAssistantStudioService implements AssistantStudioService {
  public readonly kind = "backend" as const;
  private readonly fetcher: typeof fetch;
  public constructor(
    private readonly config: BackendAssistantStudioServiceConfig,
  ) {
    this.fetcher = config.fetchImplementation ?? fetch;
  }
  public getPrincipal(): StudioPrincipal {
    return this.config.principal;
  }
  public async listAssistants(
    signal?: AbortSignal,
  ): Promise<readonly StudioAssistant[]> {
    const values = await this.readList("/v1/studio/assistants", signal);
    return Object.freeze(values.map((item) => this.toAssistant(item)));
  }
  public async getAssistant(
    id: string,
    signal?: AbortSignal,
  ): Promise<StudioAssistant | undefined> {
    try {
      return this.toAssistant(
        await this.readData(`/v1/studio/assistants/${encodeURIComponent(id)}`, signal),
      );
    } catch (error) {
      if (error instanceof BackendStudioError && error.status === 404) return undefined;
      throw error;
    }
  }
  public async saveAssistant(
    value: StudioAssistant,
    signal?: AbortSignal,
  ): Promise<StudioAssistant> {
    return this.toAssistant(
      await this.readData(
        `/v1/studio/assistants/${encodeURIComponent(value.id)}`,
        signal,
        {
          method: "PUT",
          body: JSON.stringify(this.toBackendConfiguration(value)),
        },
      ),
    );
  }
  public async deleteAssistant(id: string, signal?: AbortSignal): Promise<void> {
    await this.archiveAssistant(id, signal);
  }
  public async duplicateAssistant(_id: string): Promise<StudioAssistant> {
    throw new Error("Duplicación no disponible en el Backend actual.");
  }
  public async archiveAssistant(id: string, signal?: AbortSignal): Promise<StudioAssistant> {
    return this.toAssistant(
      await this.readData(
        `/v1/studio/assistants/${encodeURIComponent(id)}/archive`,
        signal,
        { method: "POST" },
      ),
    );
  }
  public async publishAssistant(id: string, signal?: AbortSignal): Promise<StudioAssistant> {
    const published = this.record(
      await this.readData(
        `/v1/studio/assistants/${encodeURIComponent(id)}/publish`,
        signal,
        { method: "POST" },
      ),
    );
    return this.toAssistant(published.configuration);
  }
  public async listKnowledgeBases(
    signal?: AbortSignal,
  ): Promise<readonly StudioKnowledgeBase[]> {
    const values = await this.readList("/v1/knowledge-bases", signal);
    return Object.freeze(
      values.map((item) => {
        const value = this.record(item);
        return Object.freeze({
          id: String(value.id),
          name: String(value.name),
          status: value.status === "disabled" ? "disabled" : "active",
          documentCount: 0,
        });
      }),
    );
  }
  public async listDocuments(
    signal?: AbortSignal,
  ): Promise<readonly StudioDocument[]> {
    const values = await this.readList("/v1/documents", signal);
    return Object.freeze(
      values.map((item) => {
        const value = this.record(item);
        return Object.freeze({
          id: String(value.id),
          knowledgeBaseId: String(value.knowledgeBaseId),
          title: String(value.title),
          mediaType: String(value.mediaType),
          status: String(value.status),
          updatedAt: "",
        });
      }),
    );
  }
  public async listTools(signal?: AbortSignal): Promise<readonly StudioTool[]> {
    const values = await this.readList("/v1/tools", signal);
    return Object.freeze(
      values.map((item) => {
        const descriptor = this.record(this.record(item).descriptor);
        return Object.freeze({
          id: String(descriptor.id),
          name: String(descriptor.name),
          description: String(descriptor.description),
          category: String(descriptor.category),
          risk: String(descriptor.riskLevel),
          permissions: Array.isArray(descriptor.requiredPermissions)
            ? descriptor.requiredPermissions.filter(
                (entry): entry is string => typeof entry === "string",
              )
            : Object.freeze([]),
          confirmation: String(descriptor.confirmationPolicy),
        });
      }),
    );
  }
  public async health(signal?: AbortSignal): Promise<"ready" | "degraded"> {
    try {
      await this.read("/ready", signal);
      return "ready";
    } catch {
      return "degraded";
    }
  }
  public getChatTransport(assistantId: string): UniversalChatTransport {
    return this.config.chatTransportFactory(assistantId);
  }
  private record(value: unknown): Readonly<Record<string, unknown>> {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new Error("El Backend devolvió datos inválidos.");
    return value as Readonly<Record<string, unknown>>;
  }
  private async readList(
    path: string,
    signal?: AbortSignal,
  ): Promise<readonly unknown[]> {
    const root = this.record(await this.read(path, signal));
    return Array.isArray(root.data) ? root.data : Object.freeze([]);
  }
  private async readData(
    path: string,
    signal?: AbortSignal,
    init: RequestInit = {},
  ): Promise<unknown> {
    const root = this.record(await this.read(path, signal, init));
    return root.data;
  }
  private async read(
    path: string,
    signal?: AbortSignal,
    init: RequestInit = {},
  ): Promise<unknown> {
    const token = await this.config.tokenProvider();
    const response = await this.fetcher(
      `${this.config.apiUrl.replace(/\/$/, "")}${path}`,
      {
        ...init,
        headers: {
          accept: "application/json",
          ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        },
        signal,
      },
    );
    const text = await response.text();
    if (!response.ok) throw new BackendStudioError(response.status);
    return JSON.parse(text) as unknown;
  }

  private toBackendConfiguration(value: StudioAssistant): unknown {
    return Object.freeze({
      id: value.id,
      tenantId: this.config.principal.tenantId,
      version: value.version,
      status: value.status === "archived" ? "archived" : value.status === "published" ? "published" : "draft",
      identity: Object.freeze({
        name: value.identity.name,
        description: value.identity.description,
        purpose: value.identity.purpose,
        locale: value.identity.locale,
        allowedLocales: value.identity.allowedLocales,
        tone: value.identity.tone,
        instructions: value.identity.instructions,
        welcomeMessage: value.identity.welcomeMessage,
      }),
      behavior: value.behavior,
      rag: Object.freeze({
        enabled: value.rag.enabled,
        groundingMode: value.rag.groundingMode,
        knowledgeBaseIds: value.rag.knowledgeBaseIds,
        topK: value.rag.topK,
        minimumScore: value.rag.minimumScore,
        citationsEnabled: value.rag.citationsEnabled,
      }),
      memory: Object.freeze({
        enabled: value.memory.enabled,
        shortTerm: value.memory.shortTerm,
        longTerm: value.memory.longTerm,
        summary: value.memory.summary,
        retentionDays: value.memory.retentionDays,
        consentRequired: value.memory.consentRequired,
      }),
      tools: Object.freeze({
        enabled: value.tools.enabled,
        allowlist: value.tools.allowlist,
        maximumRisk: value.tools.maximumRisk,
        maximumCalls: value.tools.maximumCalls,
        maximumRounds: value.tools.maximumRounds,
      }),
      channels: Object.freeze(["WEB"]),
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      createdBy: value.createdBy,
      updatedBy: value.updatedBy,
    });
  }

  private toAssistant(raw: unknown): StudioAssistant {
    const value = this.record(raw);
    const identity = this.record(value.identity);
    const behavior = this.record(value.behavior);
    const rag = this.record(value.rag);
    const memory = this.record(value.memory);
    const tools = this.record(value.tools);
    const id = String(value.id);
    const base = createEmptyAssistant(
      this.config.principal.tenantId,
      this.config.principal.actorId,
      id,
    );
    const mapped = Object.freeze({
      ...base,
      version: Number(value.version ?? base.version),
      status: value.status === "published" || value.status === "archived" ? value.status : "draft",
      identity: Object.freeze({
        ...base.identity,
        name: String(identity.name ?? ""),
        description: String(identity.description ?? ""),
        purpose: String(identity.purpose ?? ""),
        locale: String(identity.locale ?? "es"),
        tone: String(identity.tone ?? "profesional"),
        instructions: String(identity.instructions ?? ""),
        welcomeMessage: String(identity.welcomeMessage ?? base.identity.welcomeMessage),
      }),
      behavior: Object.freeze({
        ...base.behavior,
        systemPrompt: String(behavior.systemPrompt ?? ""),
        restrictions: String(behavior.restrictions ?? ""),
      }),
      rag: Object.freeze({
        ...base.rag,
        enabled: rag.enabled === true,
        groundingMode: rag.groundingMode === "private-strict" || rag.groundingMode === "general-allowed" ? rag.groundingMode : "private-preferred",
        knowledgeBaseIds: Object.freeze(Array.isArray(rag.knowledgeBaseIds) ? rag.knowledgeBaseIds.filter((item): item is string => typeof item === "string") : []),
        minimumScore: Number(rag.minimumScore ?? base.rag.minimumScore),
      }),
      memory: Object.freeze({ ...base.memory, enabled: memory.enabled === true }),
      tools: Object.freeze({
        ...base.tools,
        enabled: tools.enabled === true,
        allowlist: Object.freeze(Array.isArray(tools.allowlist) ? tools.allowlist.filter((item): item is string => typeof item === "string") : []),
        maximumCalls: Number(tools.maximumCalls ?? base.tools.maximumCalls),
        maximumRounds: Number(tools.maximumRounds ?? base.tools.maximumRounds),
      }),
      createdAt: String(value.createdAt ?? base.createdAt),
      updatedAt: String(value.updatedAt ?? base.updatedAt),
      createdBy: String(value.createdBy ?? base.createdBy),
      updatedBy: String(value.updatedBy ?? base.updatedBy),
    });
    return Object.freeze({ ...mapped, validation: validateStudioAssistant(mapped) });
  }
}

class BackendStudioError extends Error {
  public constructor(readonly status: number) {
    super(`Backend respondió ${status}.`);
    this.name = "BackendStudioError";
  }
}
