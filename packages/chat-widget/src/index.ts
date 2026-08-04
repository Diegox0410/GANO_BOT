/**
 * @package @gano-bot/chat-widget
 * @version 0.2.0
 *
 * Núcleo reutilizable y agnóstico de interfaz para el chat de GANO_BOT.
 *
 * Responsabilidades:
 * - Administrar el estado de la conversación.
 * - Enviar mensajes mediante un transporte configurable.
 * - Controlar estados de carga y errores.
 * - Cancelar solicitudes activas.
 * - Reintentar mensajes fallidos.
 * - Mantener contexto empresarial.
 * - Persistir conversaciones opcionalmente.
 * - Notificar cambios mediante suscripciones.
 *
 * Este paquete no depende directamente de React, Firebase ni del navegador.
 * La interfaz visual se conectará posteriormente desde apps/web.
 */

/* ============================================================================
 * TIPOS BASE
 * ========================================================================== */

export type ChatWidgetStatus =
  | "idle"
  | "sending"
  | "receiving"
  | "error";

export type ChatWidgetRole =
  | "system"
  | "user"
  | "assistant";

export type ChatMessageStatus =
  | "pending"
  | "completed"
  | "failed"
  | "cancelled";

export type ChatMessageContentType =
  | "text"
  | "markdown";

export type ChatWidgetErrorCode =
  | "EMPTY_MESSAGE"
  | "MESSAGE_TOO_LONG"
  | "TRANSPORT_ERROR"
  | "REQUEST_CANCELLED"
  | "PERSISTENCE_ERROR"
  | "INVALID_RESPONSE"
  | "UNKNOWN_ERROR";

export type ChatWidgetMetadataValue =
  | string
  | number
  | boolean
  | null;

export type ChatWidgetMetadata =
  Readonly<Record<string, ChatWidgetMetadataValue>>;

export interface ChatSourceReference {
  readonly id: string;
  readonly title: string;
  readonly type?: string;
  readonly url?: string;
  readonly excerpt?: string;
  readonly metadata?: ChatWidgetMetadata;
}

export interface ChatAttachment {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly size?: number;
  readonly url?: string;
  readonly metadata?: ChatWidgetMetadata;
}

export interface ChatMessage {
  readonly id: string;
  readonly role: ChatWidgetRole;
  readonly content: string;
  readonly contentType: ChatMessageContentType;
  readonly status: ChatMessageStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sources: readonly ChatSourceReference[];
  readonly attachments: readonly ChatAttachment[];
  readonly metadata: ChatWidgetMetadata;
  readonly error?: ChatWidgetError;
}

export interface ChatWidgetError {
  readonly code: ChatWidgetErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly cause?: unknown;
}

export interface ChatWidgetContext {
  readonly userId?: string;
  readonly distributorId?: string;
  readonly conversationId?: string;
  readonly sessionId?: string;
  readonly locale?: string;
  readonly timezone?: string;
  readonly currentModule?: string;
  readonly currentRoute?: string;
  readonly rank?: string;
  readonly packageCode?: string;
  readonly metadata?: ChatWidgetMetadata;
}

export interface ChatSuggestion {
  readonly id: string;
  readonly label: string;
  readonly prompt: string;
  readonly category?: string;
  readonly metadata?: ChatWidgetMetadata;
}

export interface ChatWidgetState {
  readonly status: ChatWidgetStatus;
  readonly messages: readonly ChatMessage[];
  readonly context: ChatWidgetContext;
  readonly suggestions: readonly ChatSuggestion[];
  readonly activeRequestId: string | null;
  readonly error: ChatWidgetError | null;
  readonly isOpen: boolean;
  readonly isMinimized: boolean;
  readonly unreadCount: number;
  readonly initialized: boolean;
}

/* ============================================================================
 * TRANSPORTE
 * ========================================================================== */

export interface ChatTransportMessage {
  readonly id: string;
  readonly role: ChatWidgetRole;
  readonly content: string;
  readonly createdAt: string;
  readonly metadata: ChatWidgetMetadata;
}

export interface ChatTransportRequest {
  readonly requestId: string;
  readonly message: ChatTransportMessage;
  readonly history: readonly ChatTransportMessage[];
  readonly context: ChatWidgetContext;
  readonly signal: AbortSignal;
}

export interface ChatTransportResponse {
  readonly id?: string;
  readonly content: string;
  readonly contentType?: ChatMessageContentType;
  readonly sources?: readonly ChatSourceReference[];
  readonly attachments?: readonly ChatAttachment[];
  readonly suggestions?: readonly ChatSuggestion[];
  readonly metadata?: ChatWidgetMetadata;
}

export interface ChatTransport {
  send(
    request: ChatTransportRequest,
  ): Promise<ChatTransportResponse>;
}

/* ============================================================================
 * PERSISTENCIA
 * ========================================================================== */

export interface ChatPersistenceSnapshot {
  readonly version: 1;
  readonly savedAt: string;
  readonly messages: readonly ChatMessage[];
  readonly context: ChatWidgetContext;
  readonly suggestions: readonly ChatSuggestion[];
}

export interface ChatPersistenceAdapter {
  load(): Promise<ChatPersistenceSnapshot | null>;

  save(
    snapshot: ChatPersistenceSnapshot,
  ): Promise<void>;

  clear(): Promise<void>;
}

/* ============================================================================
 * CONFIGURACIÓN
 * ========================================================================== */

export interface ChatWidgetConfig {
  readonly transport: ChatTransport;
  readonly persistence?: ChatPersistenceAdapter;
  readonly initialContext?: ChatWidgetContext;
  readonly initialMessages?: readonly ChatMessage[];
  readonly initialSuggestions?: readonly ChatSuggestion[];
  readonly systemPrompt?: string;
  readonly maximumMessageLength?: number;
  readonly maximumHistoryMessages?: number;
  readonly persistAutomatically?: boolean;
  readonly generateId?: () => string;
  readonly now?: () => string;
  readonly onError?: (
    error: ChatWidgetError,
  ) => void;
}

export interface SendMessageOptions {
  readonly metadata?: ChatWidgetMetadata;
  readonly attachments?: readonly ChatAttachment[];
  readonly contentType?: ChatMessageContentType;
}

export interface AddMessageInput {
  readonly id?: string;
  readonly role: ChatWidgetRole;
  readonly content: string;
  readonly contentType?: ChatMessageContentType;
  readonly status?: ChatMessageStatus;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly sources?: readonly ChatSourceReference[];
  readonly attachments?: readonly ChatAttachment[];
  readonly metadata?: ChatWidgetMetadata;
  readonly error?: ChatWidgetError;
}

export type ChatWidgetListener = (
  state: ChatWidgetState,
) => void;

export type ChatWidgetUnsubscribe = () => void;

/* ============================================================================
 * CONSTANTES
 * ========================================================================== */

export const CHAT_WIDGET_DEFAULT_MAXIMUM_MESSAGE_LENGTH =
  8_000;

export const CHAT_WIDGET_DEFAULT_MAXIMUM_HISTORY_MESSAGES =
  30;

export const CHAT_WIDGET_PERSISTENCE_VERSION = 1 as const;

export const EMPTY_CHAT_WIDGET_CONTEXT: ChatWidgetContext =
  Object.freeze({});

export const EMPTY_CHAT_WIDGET_METADATA: ChatWidgetMetadata =
  Object.freeze({});

export const DEFAULT_CHAT_SUGGESTIONS:
  readonly ChatSuggestion[] = Object.freeze([
    Object.freeze({
      id: "business-summary",
      label: "Resumen de mi negocio",
      prompt:
        "Analiza el estado actual de mi negocio y dame un resumen claro.",
      category: "business",
    }),
    Object.freeze({
      id: "rank-progress",
      label: "Progreso de rango",
      prompt:
        "Analiza mi progreso de rango y dime qué requisitos me faltan.",
      category: "rank",
    }),
    Object.freeze({
      id: "binary-analysis",
      label: "Analizar organización",
      prompt:
        "Analiza mi organización binaria, identifica desequilibrios y oportunidades.",
      category: "organization",
    }),
    Object.freeze({
      id: "next-action",
      label: "Siguiente mejor acción",
      prompt:
        "Según mis datos actuales, ¿cuál debería ser mi siguiente mejor acción?",
      category: "recommendation",
    }),
  ]);

/* ============================================================================
 * UTILIDADES
 * ========================================================================== */

function defaultNow(): string {
  return new Date().toISOString();
}

function defaultGenerateId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random()
    .toString(36)
    .slice(2, 12);

  return `chat_${timestamp}_${randomPart}`;
}

function normalizeText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .trim();
}

function isAbortError(error: unknown): boolean {
  if (
    typeof DOMException !== "undefined" &&
    error instanceof DOMException
  ) {
    return error.name === "AbortError";
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error
  ) {
    return (
      (error as { readonly name?: unknown }).name ===
      "AbortError"
    );
  }

  return false;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Ocurrió un error desconocido.";
}

function freezeArray<T>(
  values: readonly T[],
): readonly T[] {
  return Object.freeze([...values]);
}

function freezeMetadata(
  metadata?: ChatWidgetMetadata,
): ChatWidgetMetadata {
  if (metadata === undefined) {
    return EMPTY_CHAT_WIDGET_METADATA;
  }

  return Object.freeze({
    ...metadata,
  });
}

function freezeContext(
  context: ChatWidgetContext,
): ChatWidgetContext {
  const nextContext: ChatWidgetContext = {
    ...context,
  };

  return Object.freeze(nextContext);
}

function freezeSuggestion(
  suggestion: ChatSuggestion,
): ChatSuggestion {
  const frozenSuggestion: ChatSuggestion = {
    id: suggestion.id,
    label: suggestion.label,
    prompt: suggestion.prompt,
    ...(suggestion.category !== undefined
      ? {
          category: suggestion.category,
        }
      : {}),
    ...(suggestion.metadata !== undefined
      ? {
          metadata: freezeMetadata(
            suggestion.metadata,
          ),
        }
      : {}),
  };

  return Object.freeze(frozenSuggestion);
}

function freezeSource(
  source: ChatSourceReference,
): ChatSourceReference {
  const frozenSource: ChatSourceReference = {
    id: source.id,
    title: source.title,
    ...(source.type !== undefined
      ? {
          type: source.type,
        }
      : {}),
    ...(source.url !== undefined
      ? {
          url: source.url,
        }
      : {}),
    ...(source.excerpt !== undefined
      ? {
          excerpt: source.excerpt,
        }
      : {}),
    ...(source.metadata !== undefined
      ? {
          metadata: freezeMetadata(
            source.metadata,
          ),
        }
      : {}),
  };

  return Object.freeze(frozenSource);
}

function freezeAttachment(
  attachment: ChatAttachment,
): ChatAttachment {
  const frozenAttachment: ChatAttachment = {
    id: attachment.id,
    name: attachment.name,
    type: attachment.type,
    ...(attachment.size !== undefined
      ? {
          size: attachment.size,
        }
      : {}),
    ...(attachment.url !== undefined
      ? {
          url: attachment.url,
        }
      : {}),
    ...(attachment.metadata !== undefined
      ? {
          metadata: freezeMetadata(
            attachment.metadata,
          ),
        }
      : {}),
  };

  return Object.freeze(frozenAttachment);
}

function freezeError(
  error: ChatWidgetError,
): ChatWidgetError {
  const frozenError: ChatWidgetError = {
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    ...(error.cause !== undefined
      ? {
          cause: error.cause,
        }
      : {}),
  };

  return Object.freeze(frozenError);
}

function freezeMessage(
  message: ChatMessage,
): ChatMessage {
  const frozenMessage: ChatMessage = {
    id: message.id,
    role: message.role,
    content: message.content,
    contentType: message.contentType,
    status: message.status,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    sources: freezeArray(
      message.sources.map(freezeSource),
    ),
    attachments: freezeArray(
      message.attachments.map(
        freezeAttachment,
      ),
    ),
    metadata: freezeMetadata(
      message.metadata,
    ),
    ...(message.error !== undefined
      ? {
          error: freezeError(
            message.error,
          ),
        }
      : {}),
  };

  return Object.freeze(frozenMessage);
}

function toTransportMessage(
  message: ChatMessage,
): ChatTransportMessage {
  return Object.freeze({
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    metadata: message.metadata,
  });
}

function createWidgetError(
  code: ChatWidgetErrorCode,
  message: string,
  retryable: boolean,
  cause?: unknown,
): ChatWidgetError {
  const error: ChatWidgetError = {
    code,
    message,
    retryable,
    ...(cause !== undefined
      ? {
          cause,
        }
      : {}),
  };

  return freezeError(error);
}

function createMessageFromInput(
  input: AddMessageInput,
  generateId: () => string,
  now: () => string,
): ChatMessage {
  const timestamp =
    input.createdAt ?? now();

  const message: ChatMessage = {
    id: input.id ?? generateId(),
    role: input.role,
    content: normalizeText(
      input.content,
    ),
    contentType:
      input.contentType ?? "text",
    status:
      input.status ?? "completed",
    createdAt: timestamp,
    updatedAt:
      input.updatedAt ?? timestamp,
    sources:
      input.sources ?? [],
    attachments:
      input.attachments ?? [],
    metadata:
      input.metadata ??
      EMPTY_CHAT_WIDGET_METADATA,
    ...(input.error !== undefined
      ? {
          error: input.error,
        }
      : {}),
  };

  return freezeMessage(message);
}

function createInitialState(
  config: ChatWidgetConfig,
): ChatWidgetState {
  const context = freezeContext(
    config.initialContext ??
      EMPTY_CHAT_WIDGET_CONTEXT,
  );

  const messages = (
    config.initialMessages ?? []
  ).map(freezeMessage);

  const suggestions = (
    config.initialSuggestions ??
    DEFAULT_CHAT_SUGGESTIONS
  ).map(freezeSuggestion);

  const state: ChatWidgetState = {
    status: "idle",
    messages: freezeArray(messages),
    context,
    suggestions:
      freezeArray(suggestions),
    activeRequestId: null,
    error: null,
    isOpen: false,
    isMinimized: false,
    unreadCount: 0,
    initialized: false,
  };

  return Object.freeze(state);
}

/* ============================================================================
 * CONTROLADOR
 * ========================================================================== */

export class ChatWidgetController {
  private readonly transport: ChatTransport;

  private readonly persistence:
    | ChatPersistenceAdapter
    | undefined;

  private readonly maximumMessageLength: number;

  private readonly maximumHistoryMessages: number;

  private readonly persistAutomatically: boolean;

  private readonly generateId: () => string;

  private readonly now: () => string;

  private readonly onError:
    | ((
        error: ChatWidgetError,
      ) => void)
    | undefined;

  private readonly listeners =
    new Set<ChatWidgetListener>();

  private abortController:
    | AbortController
    | null = null;

  private state: ChatWidgetState;

  public constructor(
    config: ChatWidgetConfig,
  ) {
    this.transport = config.transport;
    this.persistence =
      config.persistence;
    this.maximumMessageLength =
      config.maximumMessageLength ??
      CHAT_WIDGET_DEFAULT_MAXIMUM_MESSAGE_LENGTH;
    this.maximumHistoryMessages =
      config.maximumHistoryMessages ??
      CHAT_WIDGET_DEFAULT_MAXIMUM_HISTORY_MESSAGES;
    this.persistAutomatically =
      config.persistAutomatically ??
      true;
    this.generateId =
      config.generateId ??
      defaultGenerateId;
    this.now =
      config.now ??
      defaultNow;
    this.onError = config.onError;
    this.state =
      createInitialState(config);

    const systemPrompt =
      config.systemPrompt !== undefined
        ? normalizeText(
            config.systemPrompt,
          )
        : "";

    if (
      systemPrompt.length > 0 &&
      !this.state.messages.some(
        (message) =>
          message.role === "system",
      )
    ) {
      const systemMessage =
        createMessageFromInput(
          {
            role: "system",
            content: systemPrompt,
            contentType: "text",
            status: "completed",
          },
          this.generateId,
          this.now,
        );

      this.state = Object.freeze({
        ...this.state,
        messages: freezeArray([
          systemMessage,
          ...this.state.messages,
        ]),
      });
    }
  }

  public getState(): ChatWidgetState {
    return this.state;
  }

  public subscribe(
    listener: ChatWidgetListener,
  ): ChatWidgetUnsubscribe {
    this.listeners.add(listener);

    listener(this.state);

    return () => {
      this.listeners.delete(listener);
    };
  }

  public async initialize(): Promise<void> {
    if (this.state.initialized) {
      return;
    }

    if (this.persistence === undefined) {
      this.patchState({
        initialized: true,
      });

      return;
    }

    try {
      const snapshot =
        await this.persistence.load();

      if (
        snapshot !== null &&
        snapshot.version ===
          CHAT_WIDGET_PERSISTENCE_VERSION
      ) {
        this.state = Object.freeze({
          ...this.state,
          messages: freezeArray(
            snapshot.messages.map(
              freezeMessage,
            ),
          ),
          context: freezeContext(
            snapshot.context,
          ),
          suggestions: freezeArray(
            snapshot.suggestions.map(
              freezeSuggestion,
            ),
          ),
          initialized: true,
          error: null,
        });

        this.emit();
        return;
      }

      this.patchState({
        initialized: true,
      });
    } catch (error) {
      const widgetError =
        createWidgetError(
          "PERSISTENCE_ERROR",
          "No se pudo cargar la conversación guardada.",
          true,
          error,
        );

      this.patchState({
        initialized: true,
        error: widgetError,
        status: "error",
      });

      this.reportError(widgetError);
    }
  }

  public open(): void {
    this.patchState({
      isOpen: true,
      isMinimized: false,
      unreadCount: 0,
    });
  }

  public close(): void {
    this.patchState({
      isOpen: false,
      isMinimized: false,
    });
  }

  public minimize(): void {
    this.patchState({
      isOpen: true,
      isMinimized: true,
    });
  }

  public restore(): void {
    this.patchState({
      isOpen: true,
      isMinimized: false,
      unreadCount: 0,
    });
  }

  public toggle(): void {
    if (!this.state.isOpen) {
      this.open();
      return;
    }

    this.close();
  }

  public setContext(
    context: ChatWidgetContext,
  ): void {
    this.patchState({
      context: freezeContext(context),
    });

    void this.persist();
  }

  public updateContext(
    context: Partial<ChatWidgetContext>,
  ): void {
    const nextContext =
      freezeContext({
        ...this.state.context,
        ...context,
      });

    this.patchState({
      context: nextContext,
    });

    void this.persist();
  }

  public setSuggestions(
    suggestions:
      readonly ChatSuggestion[],
  ): void {
    this.patchState({
      suggestions: freezeArray(
        suggestions.map(
          freezeSuggestion,
        ),
      ),
    });

    void this.persist();
  }

  public addMessage(
    input: AddMessageInput,
  ): ChatMessage {
    const message =
      createMessageFromInput(
        input,
        this.generateId,
        this.now,
      );

    this.patchState({
      messages: freezeArray([
        ...this.state.messages,
        message,
      ]),
    });

    void this.persist();

    return message;
  }

  public async sendMessage(
    content: string,
    options: SendMessageOptions = {},
  ): Promise<ChatMessage | null> {
    const normalizedContent =
      normalizeText(content);

    const validationError =
      this.validateMessage(
        normalizedContent,
      );

    if (validationError !== null) {
      this.patchState({
        status: "error",
        error: validationError,
      });

      this.reportError(
        validationError,
      );

      return null;
    }

    this.cancelActiveRequest();

    const requestId =
      this.generateId();
    const timestamp = this.now();

    const userMessage =
      freezeMessage({
        id: this.generateId(),
        role: "user",
        content: normalizedContent,
        contentType:
          options.contentType ??
          "text",
        status: "completed",
        createdAt: timestamp,
        updatedAt: timestamp,
        sources: [],
        attachments:
          options.attachments ?? [],
        metadata:
          options.metadata ??
          EMPTY_CHAT_WIDGET_METADATA,
      });

    const pendingAssistantMessage =
      freezeMessage({
        id: this.generateId(),
        role: "assistant",
        content: "",
        contentType: "markdown",
        status: "pending",
        createdAt: timestamp,
        updatedAt: timestamp,
        sources: [],
        attachments: [],
        metadata:
          EMPTY_CHAT_WIDGET_METADATA,
      });

    const nextMessages = freezeArray([
      ...this.state.messages,
      userMessage,
      pendingAssistantMessage,
    ]);

    this.abortController =
      new AbortController();

    this.patchState({
      status: "sending",
      messages: nextMessages,
      activeRequestId: requestId,
      error: null,
    });

    try {
      const history =
        this.createTransportHistory(
          nextMessages.filter(
            (message) =>
              message.id !==
              pendingAssistantMessage.id,
          ),
        );

      this.patchState({
        status: "receiving",
      });

      const response =
        await this.transport.send({
          requestId,
          message:
            toTransportMessage(
              userMessage,
            ),
          history,
          context:
            this.state.context,
          signal:
            this.abortController.signal,
        });

      if (
        this.state.activeRequestId !==
        requestId
      ) {
        return null;
      }

      const responseContent =
        normalizeText(
          response.content,
        );

      if (responseContent.length === 0) {
        throw new Error(
          "El transporte devolvió una respuesta vacía.",
        );
      }

      const completedMessage =
        freezeMessage({
          id:
            response.id ??
            pendingAssistantMessage.id,
          role: "assistant",
          content: responseContent,
          contentType:
            response.contentType ??
            "markdown",
          status: "completed",
          createdAt:
            pendingAssistantMessage.createdAt,
          updatedAt: this.now(),
          sources:
            response.sources ?? [],
          attachments:
            response.attachments ??
            [],
          metadata:
            response.metadata ??
            EMPTY_CHAT_WIDGET_METADATA,
        });

      const completedMessages =
        this.state.messages.map(
          (message) =>
            message.id ===
            pendingAssistantMessage.id
              ? completedMessage
              : message,
        );

      const unreadCount =
        this.state.isOpen &&
        !this.state.isMinimized
          ? 0
          : this.state.unreadCount + 1;

      this.patchState({
        status: "idle",
        messages:
          freezeArray(
            completedMessages,
          ),
        suggestions:
          response.suggestions !==
          undefined
            ? freezeArray(
                response.suggestions.map(
                  freezeSuggestion,
                ),
              )
            : this.state.suggestions,
        activeRequestId: null,
        error: null,
        unreadCount,
      });

      this.abortController = null;

      await this.persist();

      return completedMessage;
    } catch (error) {
      if (
        this.state.activeRequestId !==
        requestId
      ) {
        return null;
      }

      const cancelled =
        isAbortError(error);

      const widgetError =
        cancelled
          ? createWidgetError(
              "REQUEST_CANCELLED",
              "La solicitud fue cancelada.",
              true,
              error,
            )
          : createWidgetError(
              "TRANSPORT_ERROR",
              getErrorMessage(error),
              true,
              error,
            );

      const failedStatus:
        ChatMessageStatus =
        cancelled
          ? "cancelled"
          : "failed";

      const failedMessages =
        this.state.messages.map(
          (message) => {
            if (
              message.id !==
              pendingAssistantMessage.id
            ) {
              return message;
            }

            return freezeMessage({
              ...message,
              status: failedStatus,
              updatedAt: this.now(),
              error: widgetError,
            });
          },
        );

      this.patchState({
        status: cancelled
          ? "idle"
          : "error",
        messages:
          freezeArray(
            failedMessages,
          ),
        activeRequestId: null,
        error: cancelled
          ? null
          : widgetError,
      });

      this.abortController = null;

      if (!cancelled) {
        this.reportError(
          widgetError,
        );
      }

      await this.persist();

      return null;
    }
  }

  public async sendSuggestion(
    suggestionId: string,
  ): Promise<ChatMessage | null> {
    const suggestion =
      this.state.suggestions.find(
        (item) =>
          item.id === suggestionId,
      );

    if (suggestion === undefined) {
      const widgetError =
        createWidgetError(
          "UNKNOWN_ERROR",
          `No existe una sugerencia con el identificador "${suggestionId}".`,
          false,
        );

      this.patchState({
        status: "error",
        error: widgetError,
      });

      this.reportError(
        widgetError,
      );

      return null;
    }

    return this.sendMessage(
      suggestion.prompt,
      {
        metadata: {
          suggestionId:
            suggestion.id,
          suggestionLabel:
            suggestion.label,
        },
      },
    );
  }

  public cancelActiveRequest(): void {
    if (
      this.abortController !== null
    ) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (
      this.state.activeRequestId !==
      null
    ) {
      const timestamp = this.now();

      const messages =
        this.state.messages.map(
          (message) => {
            if (
              message.status !==
              "pending"
            ) {
              return message;
            }

            return freezeMessage({
              ...message,
              status: "cancelled",
              updatedAt: timestamp,
            });
          },
        );

      this.patchState({
        status: "idle",
        messages:
          freezeArray(messages),
        activeRequestId: null,
        error: null,
      });
    }
  }

  public async retryLastFailedMessage():
    Promise<ChatMessage | null> {
    const failedAssistantIndex =
      this.findLastMessageIndex(
        (message) =>
          message.role ===
            "assistant" &&
          (message.status ===
            "failed" ||
            message.status ===
              "cancelled"),
      );

    if (
      failedAssistantIndex === -1
    ) {
      return null;
    }

    const userMessageIndex =
      this.findPreviousUserMessageIndex(
        failedAssistantIndex,
      );

    if (userMessageIndex === -1) {
      return null;
    }

    const userMessage =
      this.state.messages[
        userMessageIndex
      ];

    if (userMessage === undefined) {
      return null;
    }

    const trimmedMessages =
      this.state.messages.slice(
        0,
        userMessageIndex,
      );

    this.patchState({
      messages:
        freezeArray(
          trimmedMessages,
        ),
      status: "idle",
      error: null,
      activeRequestId: null,
    });

    return this.sendMessage(
      userMessage.content,
      {
        metadata:
          userMessage.metadata,
        attachments:
          userMessage.attachments,
        contentType:
          userMessage.contentType,
      },
    );
  }

  public removeMessage(
    messageId: string,
  ): boolean {
    const nextMessages =
      this.state.messages.filter(
        (message) =>
          message.id !== messageId,
      );

    if (
      nextMessages.length ===
      this.state.messages.length
    ) {
      return false;
    }

    this.patchState({
      messages:
        freezeArray(nextMessages),
    });

    void this.persist();

    return true;
  }

  public clearError(): void {
    this.patchState({
      error: null,
      status:
        this.state.activeRequestId ===
        null
          ? "idle"
          : this.state.status,
    });
  }

  public async clearConversation():
    Promise<void> {
    this.cancelActiveRequest();

    const systemMessages =
      this.state.messages.filter(
        (message) =>
          message.role === "system",
      );

    this.patchState({
      status: "idle",
      messages:
        freezeArray(systemMessages),
      activeRequestId: null,
      error: null,
      unreadCount: 0,
    });

    if (
      this.persistence !== undefined
    ) {
      try {
        await this.persistence.clear();
      } catch (error) {
        const widgetError =
          createWidgetError(
            "PERSISTENCE_ERROR",
            "No se pudo eliminar la conversación guardada.",
            true,
            error,
          );

        this.patchState({
          status: "error",
          error: widgetError,
        });

        this.reportError(
          widgetError,
        );
      }
    }
  }

  public destroy(): void {
    this.cancelActiveRequest();
    this.listeners.clear();
  }

  private validateMessage(
    content: string,
  ): ChatWidgetError | null {
    if (content.length === 0) {
      return createWidgetError(
        "EMPTY_MESSAGE",
        "El mensaje no puede estar vacío.",
        false,
      );
    }

    if (
      content.length >
      this.maximumMessageLength
    ) {
      return createWidgetError(
        "MESSAGE_TOO_LONG",
        `El mensaje supera el máximo permitido de ${this.maximumMessageLength} caracteres.`,
        false,
      );
    }

    return null;
  }

  private createTransportHistory(
    messages: readonly ChatMessage[],
  ): readonly ChatTransportMessage[] {
    const usableMessages =
      messages.filter(
        (message) =>
          message.status ===
            "completed" &&
          message.content.length > 0,
      );

    const systemMessages =
      usableMessages.filter(
        (message) =>
          message.role === "system",
      );

    const conversationMessages =
      usableMessages.filter(
        (message) =>
          message.role !== "system",
      );

    const limitedConversation =
      conversationMessages.slice(
        -this.maximumHistoryMessages,
      );

    return freezeArray([
      ...systemMessages.map(
        toTransportMessage,
      ),
      ...limitedConversation.map(
        toTransportMessage,
      ),
    ]);
  }

  private findLastMessageIndex(
    predicate: (
      message: ChatMessage,
    ) => boolean,
  ): number {
    for (
      let index =
        this.state.messages.length - 1;
      index >= 0;
      index -= 1
    ) {
      const message =
        this.state.messages[index];

      if (
        message !== undefined &&
        predicate(message)
      ) {
        return index;
      }
    }

    return -1;
  }

  private findPreviousUserMessageIndex(
    fromIndex: number,
  ): number {
    for (
      let index = fromIndex - 1;
      index >= 0;
      index -= 1
    ) {
      const message =
        this.state.messages[index];

      if (
        message?.role === "user"
      ) {
        return index;
      }
    }

    return -1;
  }

  private patchState(
    patch: Partial<ChatWidgetState>,
  ): void {
    this.state = Object.freeze({
      ...this.state,
      ...patch,
    });

    this.emit();
  }

  private emit(): void {
    for (const listener of [
      ...this.listeners,
    ]) {
      try {
        listener(this.state);
      } catch (error) {
        const widgetError =
          createWidgetError(
            "UNKNOWN_ERROR",
            "Un suscriptor del chat produjo un error.",
            false,
            error,
          );

        this.reportError(
          widgetError,
        );
      }
    }
  }

  private reportError(
    error: ChatWidgetError,
  ): void {
    if (
      this.onError === undefined
    ) {
      return;
    }

    try {
      this.onError(error);
    } catch {
      // Se evita que un error externo interrumpa el controlador.
    }
  }

  private async persist(): Promise<void> {
    if (
      !this.persistAutomatically ||
      this.persistence === undefined
    ) {
      return;
    }

    const snapshot:
      ChatPersistenceSnapshot = {
      version:
        CHAT_WIDGET_PERSISTENCE_VERSION,
      savedAt: this.now(),
      messages:
        this.state.messages,
      context:
        this.state.context,
      suggestions:
        this.state.suggestions,
    };

    try {
      await this.persistence.save(
        snapshot,
      );
    } catch (error) {
      const widgetError =
        createWidgetError(
          "PERSISTENCE_ERROR",
          "No se pudo guardar la conversación.",
          true,
          error,
        );

      this.patchState({
        error: widgetError,
      });

      this.reportError(
        widgetError,
      );
    }
  }
}

/* ============================================================================
 * TRANSPORTE FUNCIONAL
 * ========================================================================== */

export type ChatTransportHandler = (
  request: ChatTransportRequest,
) => Promise<ChatTransportResponse>;

export class FunctionalChatTransport
  implements ChatTransport
{
  private readonly handler:
    ChatTransportHandler;

  public constructor(
    handler: ChatTransportHandler,
  ) {
    this.handler = handler;
  }

  public send(
    request: ChatTransportRequest,
  ): Promise<ChatTransportResponse> {
    return this.handler(request);
  }
}

/* ============================================================================
 * PERSISTENCIA EN MEMORIA
 * ========================================================================== */

export class MemoryChatPersistence
  implements ChatPersistenceAdapter
{
  private snapshot:
    | ChatPersistenceSnapshot
    | null = null;

  public async load():
    Promise<ChatPersistenceSnapshot | null> {
    return this.snapshot;
  }

  public async save(
    snapshot: ChatPersistenceSnapshot,
  ): Promise<void> {
    this.snapshot =
      Object.freeze({
        ...snapshot,
        messages:
          freezeArray(
            snapshot.messages.map(
              freezeMessage,
            ),
          ),
        context: freezeContext(
          snapshot.context,
        ),
        suggestions:
          freezeArray(
            snapshot.suggestions.map(
              freezeSuggestion,
            ),
          ),
      });
  }

  public async clear(): Promise<void> {
    this.snapshot = null;
  }
}

/* ============================================================================
 * FACTORÍAS
 * ========================================================================== */

export function createChatWidgetController(
  config: ChatWidgetConfig,
): ChatWidgetController {
  return new ChatWidgetController(
    config,
  );
}

export function createFunctionalChatTransport(
  handler: ChatTransportHandler,
): FunctionalChatTransport {
  return new FunctionalChatTransport(
    handler,
  );
}

export function createMemoryChatPersistence():
  MemoryChatPersistence {
  return new MemoryChatPersistence();
}