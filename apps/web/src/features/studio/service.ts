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
    const values = await this.readList("/v1/assistants", signal);
    return Object.freeze(
      values.map((item) => {
        const descriptor = this.record(item).descriptor;
        const data = this.record(descriptor);
        const base = createEmptyAssistant(
          this.config.principal.tenantId,
          this.config.principal.actorId,
          String(data.id),
        );
        return Object.freeze({
          ...base,
          identity: Object.freeze({
            ...base.identity,
            name: String(data.name ?? data.id),
            description: String(data.description ?? ""),
          }),
          status: data.enabled === true ? "ready" : "draft",
        });
      }),
    );
  }
  public async getAssistant(
    id: string,
    signal?: AbortSignal,
  ): Promise<StudioAssistant | undefined> {
    return (await this.listAssistants(signal)).find((item) => item.id === id);
  }
  public async saveAssistant(
    _value: StudioAssistant,
  ): Promise<StudioAssistant> {
    throw new Error(
      "El Backend del Hito 8 no expone mutaciones administrativas.",
    );
  }
  public async deleteAssistant(_id: string): Promise<void> {
    throw new Error(
      "El Backend del Hito 8 no expone eliminación administrativa.",
    );
  }
  public async duplicateAssistant(_id: string): Promise<StudioAssistant> {
    throw new Error("Duplicación no disponible en el Backend actual.");
  }
  public async archiveAssistant(_id: string): Promise<StudioAssistant> {
    throw new Error("Archivado no disponible en el Backend actual.");
  }
  public async publishAssistant(_id: string): Promise<StudioAssistant> {
    throw new Error("Publicación no disponible en el Backend actual.");
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
  private async read(path: string, signal?: AbortSignal): Promise<unknown> {
    const token = await this.config.tokenProvider();
    const response = await this.fetcher(
      `${this.config.apiUrl.replace(/\/$/, "")}${path}`,
      {
        headers:
          token === undefined
            ? undefined
            : { authorization: `Bearer ${token}` },
        signal,
      },
    );
    const text = await response.text();
    if (!response.ok) throw new Error(`Backend respondió ${response.status}.`);
    return JSON.parse(text) as unknown;
  }
}
