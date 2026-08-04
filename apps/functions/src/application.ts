import type { AIMessage, AssistantDescriptor } from "@gano-bot/ai-core";
import type {
  ToolCategory,
  ToolExecutionContext,
  ToolServices,
} from "@gano-bot/ai-core/tools-engine";
import { BackendApiError, normalizeBackendError } from "./errors.js";
import {
  authorize,
  DevelopmentAuthenticationProvider,
  InMemoryRateLimiter,
} from "./security.js";
import {
  InMemoryAssistantRepository,
  InMemoryConversationRepository,
  InMemoryIngestionJobRepository,
  InMemoryKnowledgeCatalog,
} from "./repositories.js";
import {
  InMemoryMetricsSink,
  InMemoryRequestAuditSink,
  RedactingLogger,
  ToolLoopOrchestrator,
} from "./services.js";
import type { BackendChatGateway } from "./services.js";
import type {
  ApiErrorResponse,
  ApiHealth,
  ApiPermission,
  ApiPrincipal,
  ApiSuccessResponse,
  AuthenticationProvider,
  ChatApiRequest,
  ChatApiResponse,
  ChatStreamEvent,
  Logger,
  MetricsSink,
  RateLimiter,
  RequestAuditSink,
} from "./contracts.js";
export interface BackendConfiguration {
  readonly requestTimeoutMilliseconds: number;
  readonly maximumBodyBytes: number;
  readonly maximumJsonDepth: number;
  readonly allowedOrigins: readonly string[];
  readonly rateLimit: {
    readonly limit: number;
    readonly windowMilliseconds: number;
  };
  readonly maximumToolRounds: number;
  readonly maximumToolCalls: number;
  readonly maximumToolMilliseconds: number;
  readonly maximumConversationMessages: number;
  readonly streamingEnabled: boolean;
}
export interface BackendDependencies {
  readonly chat: BackendChatGateway;
  readonly assistants: InMemoryAssistantRepository;
  readonly conversations?: InMemoryConversationRepository;
  readonly knowledge?: InMemoryKnowledgeCatalog;
  readonly ingestion?: InMemoryIngestionJobRepository;
  readonly tools?: ToolServices;
  readonly authentication?: AuthenticationProvider;
  readonly rateLimiter?: RateLimiter;
  readonly metrics?: MetricsSink;
  readonly audit?: RequestAuditSink;
  readonly logger?: Logger;
  readonly now?: () => Date;
  readonly generateId?: (prefix: string) => string;
}
const DEFAULT_CONFIG: BackendConfiguration = Object.freeze({
  requestTimeoutMilliseconds: 30000,
  maximumBodyBytes: 65536,
  maximumJsonDepth: 16,
  allowedOrigins: Object.freeze([]),
  rateLimit: Object.freeze({ limit: 100, windowMilliseconds: 60000 }),
  maximumToolRounds: 4,
  maximumToolCalls: 8,
  maximumToolMilliseconds: 10000,
  maximumConversationMessages: 100,
  streamingEnabled: true,
});
function validId(value: string | null): string | undefined {
  if (value === null) return undefined;
  const normalized = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)
    ? normalized
    : undefined;
}
function objectValue(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new BackendApiError(
      "BAD_REQUEST",
      "El cuerpo debe ser un objeto JSON.",
      400,
    );
  return value as Readonly<Record<string, unknown>>;
}
function depth(value: unknown, level = 0): number {
  if (typeof value !== "object" || value === null) return level;
  const children = Array.isArray(value) ? value : Object.values(value);
  return children.reduce(
    (maximum, item) => Math.max(maximum, depth(item, level + 1)),
    level,
  );
}
function chatBody(value: unknown): ChatApiRequest {
  const data = objectValue(value);
  const allowed = new Set([
    "assistantId",
    "conversationId",
    "message",
    "locale",
    "metadata",
    "groundingMode",
    "toolConfirmationIds",
  ]);
  if (Object.keys(data).some((key) => !allowed.has(key)))
    throw new BackendApiError(
      "BAD_REQUEST",
      "El cuerpo contiene propiedades desconocidas.",
      400,
    );
  if (
    typeof data.assistantId !== "string" ||
    validId(data.assistantId) === undefined ||
    typeof data.message !== "string" ||
    data.message.trim().length === 0 ||
    data.message.length > 16000
  )
    throw new BackendApiError(
      "BAD_REQUEST",
      "assistantId y message válidos son obligatorios.",
      400,
    );
  return Object.freeze({
    assistantId: data.assistantId.trim(),
    message: data.message.trim(),
    ...(typeof data.conversationId === "string"
      ? { conversationId: data.conversationId }
      : {}),
    ...(typeof data.locale === "string" ? { locale: data.locale } : {}),
    ...(typeof data.metadata === "object" && data.metadata !== null
      ? { metadata: data.metadata as ChatApiRequest["metadata"] }
      : {}),
    ...(data.groundingMode === "private-strict" ||
    data.groundingMode === "private-preferred" ||
    data.groundingMode === "general-allowed"
      ? { groundingMode: data.groundingMode }
      : {}),
    ...(Array.isArray(data.toolConfirmationIds) &&
    data.toolConfirmationIds.every((item) => typeof item === "string")
      ? { toolConfirmationIds: data.toolConfirmationIds as readonly string[] }
      : {}),
  });
}
export class BackendApplication {
  private readonly config: BackendConfiguration;
  private readonly conversations: InMemoryConversationRepository;
  private readonly knowledge: InMemoryKnowledgeCatalog;
  private readonly ingestion: InMemoryIngestionJobRepository;
  private readonly authentication: AuthenticationProvider;
  private readonly rateLimiter: RateLimiter;
  private readonly metrics: MetricsSink;
  private readonly audit: RequestAuditSink;
  private readonly logger: Logger;
  private readonly now: () => Date;
  private readonly generateId: (prefix: string) => string;
  public constructor(
    private readonly dependencies: BackendDependencies,
    configuration: Partial<BackendConfiguration> = {},
  ) {
    this.config = Object.freeze({
      ...DEFAULT_CONFIG,
      ...configuration,
      rateLimit: Object.freeze({
        ...DEFAULT_CONFIG.rateLimit,
        ...configuration.rateLimit,
      }),
    });
    this.conversations =
      dependencies.conversations ?? new InMemoryConversationRepository();
    this.knowledge = dependencies.knowledge ?? new InMemoryKnowledgeCatalog();
    this.ingestion =
      dependencies.ingestion ?? new InMemoryIngestionJobRepository();
    this.authentication =
      dependencies.authentication ?? new DevelopmentAuthenticationProvider();
    this.rateLimiter = dependencies.rateLimiter ?? new InMemoryRateLimiter();
    this.metrics = dependencies.metrics ?? new InMemoryMetricsSink();
    this.audit = dependencies.audit ?? new InMemoryRequestAuditSink();
    this.logger = dependencies.logger ?? new RedactingLogger();
    this.now = dependencies.now ?? (() => new Date());
    this.generateId =
      dependencies.generateId ??
      ((prefix) => `${prefix}-${crypto.randomUUID()}`);
  }
  public async handle(request: Request): Promise<Response> {
    const started = Date.now();
    const requestId =
      validId(request.headers.get("x-request-id")) ??
      this.generateId("request");
    const correlationId =
      validId(request.headers.get("x-correlation-id")) ?? requestId;
    let principal: ApiPrincipal | undefined;
    let status = 500;
    let errorCode: import("./contracts.js").ApiErrorCode | undefined;
    try {
      if (request.method === "OPTIONS")
        return this.preflight(request, requestId, correlationId);
      if (new URL(request.url).pathname === "/health") {
        status = 200;
        return this.success<ApiHealth>(
          { status: "ok", timestamp: this.now().toISOString() },
          requestId,
          correlationId,
          status,
        );
      }
      const authentication = await this.authentication.authenticate(
        request,
        request.signal,
      );
      principal = authentication.principal;
      if (principal === undefined)
        throw new BackendApiError(
          "UNAUTHORIZED",
          "Se requiere autenticación.",
          401,
        );
      const limited = await this.rateLimiter.consume(
        `${principal.tenantId}:${principal.actorId}`,
        this.config.rateLimit,
        Date.now(),
      );
      if (!limited.allowed)
        throw new BackendApiError(
          "RATE_LIMITED",
          "Se excedió el límite de solicitudes.",
          429,
        );
      const response = await this.route(
        request,
        principal,
        requestId,
        correlationId,
      );
      status = response.status;
      return response;
    } catch (error) {
      const normalized = normalizeBackendError(error);
      status = normalized.status;
      errorCode = normalized.code;
      return this.failure(normalized, requestId, correlationId);
    } finally {
      const duration = Date.now() - started;
      this.metrics.record(status, duration);
      this.logger.log(status >= 500 ? "error" : "info", "api.request", {
        requestId,
        correlationId,
        status,
        duration,
      });
      if (principal !== undefined)
        await this.audit.write({
          requestId,
          correlationId,
          tenantId: principal.tenantId,
          actorId: principal.actorId,
          method: request.method,
          endpoint: new URL(request.url).pathname,
          status,
          durationMilliseconds: duration,
          ...(errorCode !== undefined ? { errorCode } : {}),
        });
    }
  }
  private async route(
    request: Request,
    principal: ApiPrincipal,
    requestId: string,
    correlationId: string,
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const segments = path.split("/").filter(Boolean);
    if (path === "/ready" && request.method === "GET")
      return this.success<ApiHealth>(
        {
          status: "ok",
          timestamp: this.now().toISOString(),
          checks: Object.freeze({
            configuration: true,
            assistantRegistry: true,
            chatGateway: true,
            conversationRepository: true,
            knowledgeService: true,
            toolService: this.dependencies.tools !== undefined,
          }),
        },
        requestId,
        correlationId,
      );
    if (path === "/v1/assistants" && request.method === "GET") {
      authorize(principal, "assistants:read", principal.tenantId);
      return this.success(
        this.dependencies.assistants
          .list(principal.tenantId)
          .map((descriptor) => ({ descriptor })),
        requestId,
        correlationId,
      );
    }
    if (
      segments[1] === "assistants" &&
      segments.length === 3 &&
      request.method === "GET"
    ) {
      authorize(principal, "assistants:read", principal.tenantId, segments[2]);
      const item = this.dependencies.assistants.get(
        principal.tenantId,
        segments[2] ?? "",
      );
      if (item === undefined)
        throw new BackendApiError(
          "ASSISTANT_NOT_FOUND",
          "No existe el asistente solicitado.",
          404,
        );
      return this.success({ descriptor: item }, requestId, correlationId);
    }
    if (path === "/v1/conversations" && request.method === "GET") {
      authorize(principal, "conversations:read", principal.tenantId);
      return this.success(
        this.conversations.list(
          principal.tenantId,
          principal.actorId,
          principal.roles.includes("tenant-admin"),
        ),
        requestId,
        correlationId,
      );
    }
    if (path === "/v1/conversations" && request.method === "POST") {
      authorize(principal, "conversations:write", principal.tenantId);
      const body = objectValue(await this.readJson(request));
      const assistantId =
        typeof body.assistantId === "string" ? body.assistantId : "";
      this.requireAssistant(principal, assistantId);
      const now = this.now().toISOString();
      const value = Object.freeze({
        id: this.generateId("conversation"),
        tenantId: principal.tenantId,
        assistantId,
        ownerId: principal.actorId,
        messages: Object.freeze([]),
        createdAt: now,
        updatedAt: now,
      });
      this.conversations.save(value);
      return this.success(value, requestId, correlationId, 201);
    }
    if (segments[1] === "conversations" && segments.length === 3) {
      const id = segments[2] ?? "";
      const assistantId = validId(url.searchParams.get("assistantId")) ?? "";
      authorize(
        principal,
        request.method === "DELETE"
          ? "conversations:write"
          : "conversations:read",
        principal.tenantId,
        assistantId,
      );
      if (request.method === "DELETE") {
        if (
          !this.conversations.delete(
            principal.tenantId,
            assistantId,
            id,
            principal.actorId,
            principal.roles.includes("tenant-admin"),
          )
        )
          throw new BackendApiError(
            "CONVERSATION_NOT_FOUND",
            "No existe la conversación solicitada.",
            404,
          );
        return this.success({ deleted: true }, requestId, correlationId);
      }
      if (request.method === "GET") {
        const value = this.conversations.get(
          principal.tenantId,
          assistantId,
          id,
          principal.actorId,
          principal.roles.includes("tenant-admin"),
        );
        if (value === undefined)
          throw new BackendApiError(
            "CONVERSATION_NOT_FOUND",
            "No existe la conversación solicitada.",
            404,
          );
        return this.success(value, requestId, correlationId);
      }
    }
    if (
      (path === "/v1/chat" || path === "/v1/chat/stream") &&
      request.method === "POST"
    ) {
      authorize(principal, "chat:execute", principal.tenantId);
      const body = chatBody(await this.readJson(request));
      const result = await this.chat(
        body,
        principal,
        requestId,
        correlationId,
        request.signal,
      );
      if (path.endsWith("/stream")) {
        if (!this.config.streamingEnabled)
          throw new BackendApiError(
            "SERVICE_UNAVAILABLE",
            "Streaming no está habilitado.",
            503,
          );
        const events: readonly ChatStreamEvent[] = Object.freeze([
          { type: "request.accepted", timestamp: this.now().toISOString() },
          { type: "assistant.resolved", timestamp: this.now().toISOString() },
          { type: "generation.started", timestamp: this.now().toISOString() },
          {
            type: "message.completed",
            timestamp: this.now().toISOString(),
            data: result,
          },
          { type: "done", timestamp: this.now().toISOString() },
        ]);
        return new Response(
          events
            .map(
              (event) =>
                `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            )
            .join(""),
          {
            status: 200,
            headers: this.headers(
              requestId,
              correlationId,
              "text/event-stream",
            ),
          },
        );
      }
      return this.success(result, requestId, correlationId);
    }
    if (path === "/v1/knowledge-bases" && request.method === "GET") {
      authorize(principal, "knowledge:read", principal.tenantId);
      return this.success(
        this.knowledge.listBases(principal.tenantId),
        requestId,
        correlationId,
      );
    }
    if (
      segments[1] === "knowledge-bases" &&
      segments.length === 3 &&
      request.method === "GET"
    ) {
      authorize(principal, "knowledge:read", principal.tenantId);
      const item = this.knowledge.getBase(
        principal.tenantId,
        segments[2] ?? "",
      );
      if (item === undefined)
        throw new BackendApiError(
          "KNOWLEDGE_NOT_FOUND",
          "No existe la base de conocimiento.",
          404,
        );
      return this.success(item, requestId, correlationId);
    }
    if (path === "/v1/documents" && request.method === "GET") {
      authorize(principal, "knowledge:read", principal.tenantId);
      return this.success(
        this.knowledge.listDocuments(principal.tenantId),
        requestId,
        correlationId,
      );
    }
    if (
      segments[1] === "documents" &&
      segments.length === 3 &&
      request.method === "GET"
    ) {
      authorize(principal, "knowledge:read", principal.tenantId);
      const item = this.knowledge.getDocument(
        principal.tenantId,
        segments[2] ?? "",
      );
      if (item === undefined)
        throw new BackendApiError(
          "KNOWLEDGE_NOT_FOUND",
          "No existe el documento.",
          404,
        );
      return this.success(item, requestId, correlationId);
    }
    if (path === "/v1/ingestion/jobs" && request.method === "POST") {
      authorize(principal, "ingestion:execute", principal.tenantId);
      const body = objectValue(await this.readJson(request));
      const assistantId =
        typeof body.assistantId === "string" ? body.assistantId : "";
      const fixtureId =
        typeof body.fixtureId === "string" ? body.fixtureId : "";
      this.requireAssistant(principal, assistantId);
      return this.success(
        this.ingestion.create(
          this.generateId("job"),
          principal.tenantId,
          assistantId,
          fixtureId,
          this.now().toISOString(),
        ),
        requestId,
        correlationId,
        202,
      );
    }
    if (
      segments[1] === "ingestion" &&
      segments[2] === "jobs" &&
      segments.length === 4 &&
      request.method === "GET"
    ) {
      authorize(principal, "ingestion:execute", principal.tenantId);
      const job = this.ingestion.get(principal.tenantId, segments[3] ?? "");
      if (job === undefined)
        throw new BackendApiError(
          "NOT_FOUND",
          "No existe el trabajo de ingesta.",
          404,
        );
      return this.success(job, requestId, correlationId);
    }
    if (path === "/v1/tools" && request.method === "GET") {
      authorize(principal, "tools:execute", principal.tenantId);
      return this.success(
        (
          this.dependencies.tools?.registry.list({
            tenantId: principal.tenantId,
          }) ?? []
        )
          .filter(
            (tool) =>
              tool.descriptor.enabled &&
              tool.descriptor.requiredPermissions.every((permission) =>
                principal.permissions.includes(permission as ApiPermission),
              ),
          )
          .map((tool) => ({ descriptor: tool.descriptor })),
        requestId,
        correlationId,
      );
    }
    if (
      segments[1] === "tools" &&
      segments.length === 4 &&
      segments[3] === "execute" &&
      request.method === "POST"
    ) {
      authorize(principal, "tools:execute", principal.tenantId);
      if (this.dependencies.tools === undefined)
        throw new BackendApiError(
          "SERVICE_UNAVAILABLE",
          "Tools Engine no está disponible.",
          503,
        );
      const body = objectValue(await this.readJson(request));
      const assistantId =
        typeof body.assistantId === "string" ? body.assistantId : "";
      const args =
        typeof body.arguments === "object" &&
        body.arguments !== null &&
        !Array.isArray(body.arguments)
          ? objectValue(body.arguments)
          : Object.freeze({});
      const result = await this.dependencies.tools.executor.execute({
        call: {
          id: this.generateId("call"),
          name: segments[2] ?? "",
          arguments: args,
        },
        context: this.toolContext(
          principal,
          assistantId,
          typeof body.conversationId === "string"
            ? body.conversationId
            : this.generateId("conversation"),
          requestId,
          correlationId,
          request.signal,
          Array.isArray(body.confirmationIds)
            ? body.confirmationIds.filter(
                (item): item is string => typeof item === "string",
              )
            : Object.freeze([]),
        ),
      });
      return this.success(result, requestId, correlationId);
    }
    if (path === "/v1/metrics" && request.method === "GET") {
      authorize(principal, "metrics:read", principal.tenantId);
      return this.success(this.metrics.snapshot(), requestId, correlationId);
    }
    throw new BackendApiError(
      "NOT_FOUND",
      "No existe el endpoint solicitado.",
      404,
    );
  }
  private async chat(
    body: ChatApiRequest,
    principal: ApiPrincipal,
    requestId: string,
    correlationId: string,
    signal: AbortSignal,
  ): Promise<ChatApiResponse> {
    const assistant = this.requireAssistant(principal, body.assistantId);
    const conversationId =
      body.conversationId ?? this.generateId("conversation");
    const prior = this.conversations.get(
      principal.tenantId,
      body.assistantId,
      conversationId,
      principal.actorId,
    );
    const createdAt = prior?.createdAt ?? this.now().toISOString();
    const user = this.message("user", body.message, conversationId);
    let messages = Object.freeze([...(prior?.messages ?? []), user]);
    let toolResults: readonly import("@gano-bot/ai-core/tools-engine").ToolExecutionResult[] =
      Object.freeze([]);
    const seenToolCalls = new Set<string>();
    let totalToolCalls = 0;
    let turn = await this.dependencies.chat.generate({
      tenantId: principal.tenantId,
      assistant,
      conversationId,
      actorId: principal.actorId,
      request: body,
      messages,
      toolResults,
      signal,
    });
    let rounds = 0;
    while (turn.toolCalls.length > 0) {
      rounds += 1;
      totalToolCalls += turn.toolCalls.length;
      if (
        rounds > this.config.maximumToolRounds ||
        totalToolCalls > this.config.maximumToolCalls ||
        this.dependencies.tools === undefined
      )
        throw new BackendApiError(
          "TOOL_EXECUTION_FAILED",
          "No fue posible completar la orquestación de herramientas.",
          422,
        );
      const orchestrator = new ToolLoopOrchestrator(this.dependencies.tools, {
        maximumRounds: this.config.maximumToolRounds,
        maximumCalls: this.config.maximumToolCalls,
        maximumMilliseconds: this.config.maximumToolMilliseconds,
      });
      toolResults = await orchestrator.execute(
        turn.toolCalls,
        this.toolContext(
          principal,
          body.assistantId,
          conversationId,
          requestId,
          correlationId,
          signal,
          body.toolConfirmationIds ?? Object.freeze([]),
        ),
      );
      const confirmation = toolResults.find(
        (result) => result.status === "confirmation-required",
      );
      if (confirmation !== undefined)
        throw new BackendApiError(
          "TOOL_CONFIRMATION_REQUIRED",
          confirmation.confirmationReason ??
            "La herramienta requiere confirmación.",
          409,
        );
      turn = await this.dependencies.chat.generate({
        tenantId: principal.tenantId,
        assistant,
        conversationId,
        actorId: principal.actorId,
        request: body,
        messages,
        toolResults,
        signal,
      });
    }
    for (const call of turn.toolCalls) {
      const signature = JSON.stringify([call.name, call.arguments]);
      if (seenToolCalls.has(signature))
        throw new BackendApiError(
          "TOOL_EXECUTION_FAILED",
          "Se detectó un loop de herramientas.",
          422,
        );
      seenToolCalls.add(signature);
    }
    messages = Object.freeze([...messages, turn.message]);
    if (messages.length > this.config.maximumConversationMessages)
      messages = Object.freeze(
        messages.slice(-this.config.maximumConversationMessages),
      );
    this.conversations.save({
      id: conversationId,
      tenantId: principal.tenantId,
      assistantId: body.assistantId,
      ownerId: principal.actorId,
      messages,
      createdAt,
      updatedAt: this.now().toISOString(),
    });
    return Object.freeze({
      conversationId,
      message: turn.message,
      citations: turn.citations,
      toolResults,
    });
  }
  private message(
    role: "user" | "assistant",
    content: string,
    conversationId: string,
  ): AIMessage {
    const now = this.now().toISOString();
    return Object.freeze({
      id: this.generateId("message"),
      conversationId,
      role,
      content,
      contentType: "text",
      status: "completed",
      createdAt: now,
      updatedAt: now,
    });
  }
  private requireAssistant(
    principal: ApiPrincipal,
    id: string,
  ): AssistantDescriptor {
    authorize(principal, "assistants:read", principal.tenantId, id);
    const value = this.dependencies.assistants.get(principal.tenantId, id);
    if (value === undefined || !value.enabled)
      throw new BackendApiError(
        "ASSISTANT_NOT_FOUND",
        "No existe el asistente solicitado.",
        404,
      );
    return value;
  }
  private toolContext(
    principal: ApiPrincipal,
    assistantId: string,
    conversationId: string,
    requestId: string,
    correlationId: string,
    signal: AbortSignal,
    confirmationIds: readonly string[],
  ): ToolExecutionContext {
    return Object.freeze({
      tenantId: principal.tenantId,
      assistantId,
      actorId: principal.actorId,
      conversationId,
      requestId,
      correlationId,
      roles: principal.roles,
      permissions: principal.permissions,
      allowedToolIds: Object.freeze(
        this.dependencies.tools?.registry
          .list({ tenantId: principal.tenantId })
          .map((item) => item.descriptor.id) ?? [],
      ),
      allowedCategories: Object.freeze<ToolCategory[]>([
        "knowledge",
        "business",
        "calculation",
        "text",
        "data",
        "memory",
        "runtime",
        "storage",
        "network",
        "system",
        "custom",
      ]),
      maximumRiskLevel: "critical",
      confirmationIds,
      signal,
    });
  }
  private async readJson(request: Request): Promise<unknown> {
    const contentType = request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim();
    if (contentType !== "application/json")
      throw new BackendApiError(
        "UNSUPPORTED_MEDIA_TYPE",
        "Content-Type debe ser application/json.",
        415,
      );
    const text = await request.text();
    if (
      new TextEncoder().encode(text).byteLength > this.config.maximumBodyBytes
    )
      throw new BackendApiError(
        "PAYLOAD_TOO_LARGE",
        "El cuerpo excede el tamaño permitido.",
        413,
      );
    if (text.trim().length === 0)
      throw new BackendApiError(
        "BAD_REQUEST",
        "El cuerpo JSON está vacío.",
        400,
      );
    let value: unknown;
    try {
      value = JSON.parse(text) as unknown;
    } catch (error) {
      throw new BackendApiError(
        "BAD_REQUEST",
        "El cuerpo no contiene JSON válido.",
        400,
        [],
        error,
      );
    }
    if (depth(value) > this.config.maximumJsonDepth)
      throw new BackendApiError(
        "BAD_REQUEST",
        "El JSON excede la profundidad permitida.",
        400,
      );
    return value;
  }
  private success<T>(
    data: T,
    requestId: string,
    correlationId: string,
    status = 200,
  ): Response {
    const body: ApiSuccessResponse<T> = Object.freeze({
      success: true,
      data,
      requestId,
      correlationId,
      metadata: Object.freeze({}),
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: this.headers(requestId, correlationId),
    });
  }
  private failure(
    error: BackendApiError,
    requestId: string,
    correlationId: string,
  ): Response {
    const body: ApiErrorResponse = Object.freeze({
      success: false,
      error: Object.freeze({
        code: error.code,
        message: error.message,
        details: error.details,
      }),
      requestId,
      correlationId,
    });
    return new Response(JSON.stringify(body), {
      status: error.status,
      headers: this.headers(requestId, correlationId),
    });
  }
  private headers(
    requestId: string,
    correlationId: string,
    contentType = "application/json; charset=utf-8",
  ): Headers {
    return new Headers({
      "content-type": contentType,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "x-request-id": requestId,
      "x-correlation-id": correlationId,
    });
  }
  private preflight(
    request: Request,
    requestId: string,
    correlationId: string,
  ): Response {
    const origin = request.headers.get("origin");
    if (origin !== null && !this.config.allowedOrigins.includes(origin))
      throw new BackendApiError(
        "FORBIDDEN",
        "El origen no está autorizado.",
        403,
      );
    const headers = this.headers(requestId, correlationId);
    if (origin !== null) headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
    headers.set(
      "access-control-allow-headers",
      "authorization,content-type,x-request-id,x-correlation-id",
    );
    return new Response(null, { status: 204, headers });
  }
}
export function createBackendApplication(
  dependencies: BackendDependencies,
  configuration: Partial<BackendConfiguration> = {},
): BackendApplication {
  return new BackendApplication(dependencies, configuration);
}
