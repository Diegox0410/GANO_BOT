import type {
  ChatTransport,
  TokenProvider,
  WidgetMessage,
  WidgetStreamEvent,
  WidgetStreamEventType,
  WidgetTransportRequest,
  WidgetTransportResponse,
} from "./universal.types.js";
export class WidgetTransportError extends Error {
  public constructor(
    public readonly code:
      | "OFFLINE"
      | "UNAUTHORIZED"
      | "TIMEOUT"
      | "CANCELLED"
      | "INVALID_RESPONSE"
      | "HTTP_ERROR",
    message: string,
    public readonly retryable: boolean,
    public override readonly cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "WidgetTransportError";
  }
}
export interface HttpChatTransportConfig {
  readonly apiUrl: string;
  readonly tokenProvider?: TokenProvider;
  readonly customHeaders?: Readonly<Record<string, string>>;
  readonly timeoutMilliseconds?: number;
  readonly fetchImplementation?: typeof fetch;
}
const ALLOWED_HEADERS = new Set(["accept-language", "x-client-version"]);
function combineAbortSignals(
  signals: readonly AbortSignal[],
): AbortSignal {
  const availableSignals = signals.filter(
    (signal) => signal !== undefined,
  );

  if (
    typeof AbortSignal.any === "function"
  ) {
    return AbortSignal.any(availableSignals);
  }

  const controller = new AbortController();

  const abortFromSignal = (
    signal: AbortSignal,
  ): void => {
    if (controller.signal.aborted) {
      return;
    }

    controller.abort(signal.reason);
  };

  for (const signal of availableSignals) {
    if (signal.aborted) {
      abortFromSignal(signal);
      break;
    }

    signal.addEventListener(
      "abort",
      () => abortFromSignal(signal),
      { once: true },
    );
  }

  return controller.signal;
}
function headers(
  config: HttpChatTransportConfig,
  token: string | undefined,
  request: WidgetTransportRequest,
): Headers {
  const result = new Headers({
    "content-type": "application/json",
    "x-request-id": request.requestId,
    "x-correlation-id": request.correlationId,
  });
  if (token !== undefined) result.set("authorization", `Bearer ${token}`);
  for (const [name, value] of Object.entries(config.customHeaders ?? {})) {
    if (ALLOWED_HEADERS.has(name.toLowerCase())) result.set(name, value);
  }
  return result;
}
function endpoint(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}${path}`;
}
function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new WidgetTransportError(
      "INVALID_RESPONSE",
      "La API devolvió una respuesta inválida.",
      false,
    );
  return value as Readonly<Record<string, unknown>>;
}
function parseMessage(value: unknown): WidgetMessage {
  const item = record(value);
  if (typeof item.id !== "string" || typeof item.content !== "string")
    throw new WidgetTransportError(
      "INVALID_RESPONSE",
      "La API devolvió un mensaje inválido.",
      false,
    );
  return Object.freeze({
    id: item.id,
    role: "assistant",
    content: item.content,
    timestamp:
      typeof item.updatedAt === "string"
        ? item.updatedAt
        : new Date().toISOString(),
    status: "completed",
    citations: Object.freeze([]),
    warnings: Object.freeze([]),
    metadata: Object.freeze({}),
  });
}
function parseResponse(value: unknown): WidgetTransportResponse {
  const root = record(value);
  if (root.success !== true)
    throw new WidgetTransportError(
      "HTTP_ERROR",
      "La API rechazó la solicitud.",
      false,
    );
  const data = record(root.data);
  if (typeof data.conversationId !== "string" || !Array.isArray(data.citations))
    throw new WidgetTransportError(
      "INVALID_RESPONSE",
      "La respuesta de chat está incompleta.",
      false,
    );
  const citations = Object.freeze(
    data.citations.map((raw) => {
      const item = record(raw);
      if (typeof item.id !== "string" || typeof item.title !== "string")
        throw new WidgetTransportError(
          "INVALID_RESPONSE",
          "La cita recibida no es válida.",
          false,
        );
      return Object.freeze({
        id: item.id,
        title: item.title,
        ...(typeof item.documentId === "string"
          ? { documentId: item.documentId }
          : {}),
        ...(typeof item.page === "number" ? { page: item.page } : {}),
        ...(typeof item.section === "string" ? { section: item.section } : {}),
        ...(typeof item.score === "number" ? { score: item.score } : {}),
      });
    }),
  );
  const message = parseMessage(data.message);
  return Object.freeze({
    conversationId: data.conversationId,
    message: Object.freeze({ ...message, citations }),
    citations,
  });
}
export function parseSsePayload(payload: string): readonly WidgetStreamEvent[] {
  const events: WidgetStreamEvent[] = [];
  for (const block of payload.replace(/\r\n/g, "\n").split("\n\n")) {
    if (block.trim().length === 0) continue;
    let type: WidgetStreamEventType | undefined;
    let dataText = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: "))
        type = line.slice(7) as WidgetStreamEventType;
      if (line.startsWith("data: ")) dataText += line.slice(6);
    }
    if (type === undefined) continue;
    let data: unknown;
    try {
      data =
        dataText.length === 0 ? undefined : (JSON.parse(dataText) as unknown);
    } catch {
      throw new WidgetTransportError(
        "INVALID_RESPONSE",
        "El stream contiene JSON inválido.",
        false,
      );
    }
    events.push(
      Object.freeze({
        type,
        timestamp: new Date().toISOString(),
        ...(data !== undefined ? { data } : {}),
      }),
    );
  }
  return Object.freeze(events);
}
export class HttpChatTransport implements ChatTransport {
  private readonly fetcher: typeof fetch;
  private readonly timeout: number;
  public constructor(private readonly config: HttpChatTransportConfig) {
  this.fetcher =
    config.fetchImplementation ??
    ((input, init) => globalThis.fetch(input, init));

  this.timeout =
    config.timeoutMilliseconds ?? 30000;
  }
  public async send(
    request: WidgetTransportRequest,
  ): Promise<WidgetTransportResponse> {
    const token = await this.config.tokenProvider?.getAccessToken(
      request.signal,
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("timeout"), this.timeout);
    const signal = combineAbortSignals([
  request.signal,
  controller.signal,
]);

    try {
      const response = await this.fetcher(
        endpoint(this.config.apiUrl, "/v1/chat"),
        {
          method: "POST",
          headers: headers(this.config, token, request),
          body: JSON.stringify({
            assistantId: request.assistantId,
            conversationId: request.conversationId,
            message: request.message,
            locale: request.locale,
            metadata: request.metadata,
            toolConfirmationIds: request.confirmationIds,
          }),
          signal,
        },
      );
      const text = await response.text();
      if (!response.ok)
        throw new WidgetTransportError(
          response.status === 401 ? "UNAUTHORIZED" : "HTTP_ERROR",
          `La API respondió con estado ${response.status}.`,
          response.status >= 500,
        );
      let value: unknown;
      try {
        value = JSON.parse(text) as unknown;
      } catch (error) {
        throw new WidgetTransportError(
          "INVALID_RESPONSE",
          "La API devolvió JSON inválido.",
          false,
          error,
        );
      }
      return parseResponse(value);
    } catch (error) {
      if (error instanceof WidgetTransportError) throw error;
      if (request.signal.aborted)
        throw new WidgetTransportError(
          "CANCELLED",
          "La solicitud fue cancelada.",
          true,
          error,
        );
      if (controller.signal.aborted)
        throw new WidgetTransportError(
          "TIMEOUT",
          "La solicitud excedió el tiempo permitido.",
          true,
          error,
        );
      if (globalThis.navigator !== undefined && !globalThis.navigator.onLine)
        throw new WidgetTransportError(
          "OFFLINE",
          "No hay conexión de red.",
          true,
          error,
        );
      throw new WidgetTransportError(
        "HTTP_ERROR",
        "No se pudo conectar con la API.",
        true,
        error,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  public async *stream(
    request: WidgetTransportRequest,
  ): AsyncIterable<WidgetStreamEvent> {
    const token = await this.config.tokenProvider?.getAccessToken(
      request.signal,
    );
    const response = await this.fetcher(
      endpoint(this.config.apiUrl, "/v1/chat/stream"),
      {
        method: "POST",
        headers: headers(this.config, token, request),
        body: JSON.stringify({
          assistantId: request.assistantId,
          conversationId: request.conversationId,
          message: request.message,
          locale: request.locale,
          metadata: request.metadata,
        }),
        signal: request.signal,
      },
    );
    const text = await response.text();
    if (!response.ok)
      throw new WidgetTransportError(
        "HTTP_ERROR",
        `La API respondió con estado ${response.status}.`,
        response.status >= 500,
      );
    for (const event of parseSsePayload(text)) yield event;
  }
  public async createConversation(
    request: Omit<WidgetTransportRequest, "message">,
  ): Promise<string> {
    const value = await this.conversationRequest(
      "/v1/conversations",
      "POST",
      request,
    );
    const root = record(value);
    const data = record(root.data);
    if (typeof data.id !== "string")
      throw new WidgetTransportError(
        "INVALID_RESPONSE",
        "La API no devolvió conversationId.",
        false,
      );
    return data.id;
  }
  public async loadConversation(
    request: Omit<WidgetTransportRequest, "message">,
  ): Promise<import("./universal.types.js").WidgetConversation | undefined> {
    if (request.conversationId === undefined) return undefined;
    const value = await this.conversationRequest(
      `/v1/conversations/${encodeURIComponent(request.conversationId)}?assistantId=${encodeURIComponent(request.assistantId)}`,
      "GET",
      request,
    );
    const root = record(value);
    const data = record(root.data);
    const rawMessages = Array.isArray(data.messages) ? data.messages : [];
    return Object.freeze({
      id: request.conversationId,
      messages: Object.freeze(rawMessages.map(parseMessage)),
    });
  }
  public async deleteConversation(
    request: Omit<WidgetTransportRequest, "message">,
  ): Promise<void> {
    if (request.conversationId === undefined) return;
    await this.conversationRequest(
      `/v1/conversations/${encodeURIComponent(request.conversationId)}?assistantId=${encodeURIComponent(request.assistantId)}`,
      "DELETE",
      request,
    );
  }
  private async conversationRequest(
    path: string,
    method: "GET" | "POST" | "DELETE",
    request: Omit<WidgetTransportRequest, "message">,
  ): Promise<unknown> {
    const token = await this.config.tokenProvider?.getAccessToken(
      request.signal,
    );
    const response = await this.fetcher(endpoint(this.config.apiUrl, path), {
      method,
      headers: headers(this.config, token, { ...request, message: "" }),
      ...(method === "POST"
        ? { body: JSON.stringify({ assistantId: request.assistantId }) }
        : {}),
      signal: request.signal,
    });
    const text = await response.text();
    if (!response.ok)
      throw new WidgetTransportError(
        response.status === 401 ? "UNAUTHORIZED" : "HTTP_ERROR",
        `La API respondió con estado ${response.status}.`,
        response.status >= 500,
      );
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new WidgetTransportError(
        "INVALID_RESPONSE",
        "La API devolvió JSON inválido.",
        false,
        error,
      );
    }
  }
}
export interface DirectApiHandler {
  handle(request: Request): Promise<Response>;
}
export class DirectApiTransport extends HttpChatTransport {
  public constructor(
    api: DirectApiHandler,
    config: Omit<HttpChatTransportConfig, "fetchImplementation">,
  ) {
    super({
      ...config,
      fetchImplementation: (input, init) =>
        api.handle(new Request(input, init)),
    });
  }
}
/** Transporte determinista exclusivo para demostración y pruebas. */
export class MockChatTransport implements ChatTransport {
  public constructor(
    private readonly responder: (
      request: WidgetTransportRequest,
    ) => WidgetTransportResponse | Promise<WidgetTransportResponse>,
  ) {}
  public send(
    request: WidgetTransportRequest,
  ): Promise<WidgetTransportResponse> {
    return Promise.resolve(this.responder(request));
  }
}
