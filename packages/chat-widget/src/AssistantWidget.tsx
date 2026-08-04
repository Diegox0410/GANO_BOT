import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ASSISTANT_WIDGET_CSS } from "./styles.js";
import { HttpChatTransport, WidgetTransportError } from "./transport.js";
import type {
  AssistantWidgetProps,
  ChatTransport,
  StoredWidgetState,
  WidgetCitation,
  WidgetEventType,
  WidgetMessage,
  WidgetState,
  WidgetToolConfirmation,
  WidgetTransportRequest,
} from "./universal.types.js";
const EMPTY_MESSAGES: readonly WidgetMessage[] = Object.freeze([]);
function safeUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value, globalThis.location?.href);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
function userMessage(content: string, now: string): WidgetMessage {
  return Object.freeze({
    id: createId("message"),
    role: "user",
    content,
    timestamp: now,
    status: "completed",
    citations: Object.freeze([]),
    warnings: Object.freeze([]),
    metadata: Object.freeze({}),
  });
}
export function AssistantWidget({ config, className }: AssistantWidgetProps) {
  const transport: ChatTransport = useMemo(
    () =>
      config.transport ??
      new HttpChatTransport({
        apiUrl: config.apiUrl,
        tokenProvider: config.tokenProvider,
        customHeaders: config.customHeaders,
      }),
    [
      config.transport,
      config.apiUrl,
      config.tokenProvider,
      config.customHeaders,
    ],
  );
  const storageKey = `${config.tenantId ?? "default"}:${config.assistantId}`;
  const [state, setState] = useState<WidgetState>(
    config.initialState ?? (config.autoOpen ? "welcome" : "launcher"),
  );
  const [messages, setMessages] =
    useState<readonly WidgetMessage[]>(EMPTY_MESSAGES);
  const [conversationId, setConversationId] = useState<string | undefined>(
    config.initialConversationId,
  );
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [confirmation, setConfirmation] = useState<
    WidgetToolConfirmation | undefined
  >();
  const abortRef = useRef<AbortController | undefined>(undefined);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const maxLength = config.maximumMessageLength ?? 8000;
  const theme = config.theme ?? "system";
  const emit = (type: WidgetEventType, data?: unknown): void => {
    try {
      if (type === "open") config.onOpen?.();
      else if (type === "close") config.onClose?.();
      else if (type === "minimize") config.onMinimize?.();
      else if (type === "ready") config.onReady?.();
      else if (type === "error" && data instanceof Error)
        config.onError?.(data);
    } catch {
      /* Aislamiento de callbacks externos. */
    }
  };
  useEffect(() => {
    let active = true;
    void (async () => {
      if (config.persistenceEnabled && config.storage !== undefined) {
        const stored = await config.storage.load(storageKey);
        if (active && stored !== undefined) {
          setConversationId(stored.conversationId);
          setState(stored.state);
        }
      }
      if (active) emit("ready");
    })();
    return () => {
      active = false;
      abortRef.current?.abort();
    };
  }, [config.persistenceEnabled, config.storage, storageKey]);
  useEffect(() => {
    if (!config.persistenceEnabled || config.storage === undefined) return;
    const persistentState: StoredWidgetState = {
      ...(conversationId !== undefined ? { conversationId } : {}),
      state:
        state === "closed" ||
        state === "launcher" ||
        state === "minimized" ||
        state === "welcome" ||
        state === "active"
          ? state
          : "active",
      theme,
      savedAt: new Date().toISOString(),
    };
    void config.storage.save(storageKey, persistentState);
  }, [
    config.persistenceEnabled,
    config.storage,
    conversationId,
    state,
    storageKey,
    theme,
  ]);
  useEffect(() => {
    if (state !== "launcher" && state !== "closed") panelRef.current?.focus();
  }, [state]);
  const open = (): void => {
    setState(messages.length === 0 ? "welcome" : "active");
    emit("open");
  };
  const close = (): void => {
    abortRef.current?.abort();
    setState("launcher");
    emit("close");
    queueMicrotask(() => launcherRef.current?.focus());
  };
  const minimize = (): void => {
    setState("minimized");
    emit("minimize");
  };
  const fullscreen = (): void => {
    const enabled = state !== "fullscreen";
    setState(enabled ? "fullscreen" : "active");
    try {
      config.onFullscreenChange?.(enabled);
    } catch {
      /* Callback externo aislado. */
    }
  };
  const send = async (
    content = draft,
    confirmationIds?: readonly string[],
  ): Promise<void> => {
    const normalized = content.trim();
    if (
      normalized.length === 0 ||
      normalized.length > maxLength ||
      state === "loading" ||
      state === "streaming"
    )
      return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const now = new Date().toISOString();
    const user = userMessage(normalized, now);
    if (confirmationIds === undefined) {
      setMessages((current) => Object.freeze([...current, user]));
      setDraft("");
      try {
        config.onMessageSent?.(user);
      } catch {
        /* Callback externo aislado. */
      }
    }
    setError(undefined);
    setConfirmation(undefined);
    setState(
      config.streamingEnabled && transport.stream !== undefined
        ? "streaming"
        : "loading",
    );
    const request: WidgetTransportRequest = {
      assistantId: config.assistantId,
      ...(config.tenantId !== undefined ? { tenantId: config.tenantId } : {}),
      ...(conversationId !== undefined ? { conversationId } : {}),
      message: normalized,
      locale: config.locale ?? "es",
      metadata: config.metadata,
      ...(confirmationIds !== undefined ? { confirmationIds } : {}),
      requestId: createId("request"),
      correlationId: createId("correlation"),
      signal: controller.signal,
    };
    try {
      let response;
      if (config.streamingEnabled && transport.stream !== undefined) {
        let completed;
        try {
          for await (const event of transport.stream(request)) {
            if (
              event.type === "message.completed" &&
              event.data !== undefined
            ) {
              const root = event.data as Readonly<Record<string, unknown>>;
              const data = (root.data ?? root) as Readonly<
                Record<string, unknown>
              >;
              if (
                typeof data.conversationId === "string" &&
                typeof data.message === "object" &&
                data.message !== null
              ) {
                const raw = data.message as Readonly<Record<string, unknown>>;
                completed = {
                  conversationId: data.conversationId,
                  message: Object.freeze({
                    id: String(raw.id),
                    role: "assistant" as const,
                    content: String(raw.content),
                    timestamp:
                      typeof raw.updatedAt === "string"
                        ? raw.updatedAt
                        : new Date().toISOString(),
                    status: "completed" as const,
                    citations: Object.freeze([]),
                    warnings: Object.freeze([]),
                    metadata: Object.freeze({}),
                  }),
                  citations: Object.freeze([]),
                };
              }
            }
            if (
              event.type === "tool.confirmation-required" &&
              typeof event.data === "object" &&
              event.data !== null
            )
              setState("awaiting-confirmation");
          }
        } catch (streamError) {
          if (request.signal.aborted) throw streamError;
        }
        response = completed ?? (await transport.send(request));
      } else response = await transport.send(request);
      setConversationId(response.conversationId);
      setMessages((current) =>
        Object.freeze([
          ...current,
          Object.freeze({ ...response.message, citations: response.citations }),
        ]),
      );
      setConfirmation(response.confirmation);
      setState(
        response.confirmation !== undefined
          ? "awaiting-confirmation"
          : "active",
      );
      try {
        config.onMessageReceived?.(response.message);
        if (conversationId === undefined)
          config.onConversationCreated?.(response.conversationId);
      } catch {
        /* Callback externo aislado. */
      }
    } catch (cause) {
      if (controller.signal.aborted) {
        setState("active");
        return;
      }
      const next =
        cause instanceof Error ? cause : new Error("Error de comunicación.");
      setError(next.message);
      setState(
        cause instanceof WidgetTransportError && cause.code === "OFFLINE"
          ? "offline"
          : "error",
      );
      emit("error", next);
    } finally {
      if (abortRef.current === controller) abortRef.current = undefined;
    }
  };
  const confirmTool = (accepted: boolean): void => {
    if (confirmation === undefined) return;
    try {
      config.onToolConfirmation?.(confirmation, accepted);
    } catch {
      /* Callback externo aislado. */
    }
    if (accepted)
      void send(
        messages.filter((item) => item.role === "user").at(-1)?.content ??
          "Confirmar",
        [confirmation.confirmationRequestId],
      );
    else {
      setConfirmation(undefined);
      setState("active");
    }
  };
  const position = config.position ?? "bottom-right";
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches === true);
  const style = {
    "--eaw-primary": config.primaryColor ?? "#2563eb",
    "--eaw-secondary": config.secondaryColor ?? "#7c3aed",
    "--eaw-bg": config.backgroundColor ?? (dark ? "#111827" : "#ffffff"),
    "--eaw-text": config.textColor ?? (dark ? "#f8fafc" : "#172033"),
    "--eaw-z": String(config.zIndex ?? 9999),
    "--eaw-height": config.maximumHeight ?? "650px",
    "--eaw-width": config.maximumWidth ?? "390px",
  } as React.CSSProperties;
  if (state === "closed") return null;
  if (state === "launcher" || state === "minimized")
    return (
      <div
        className={`eaw-root eaw-${position} ${className ?? ""}`}
        style={style}
      >
        <style>{ASSISTANT_WIDGET_CSS}</style>
        <button
          ref={launcherRef}
          className="eaw-launcher"
          type="button"
          onClick={open}
          aria-label={`Abrir ${config.assistantName ?? "asistente"}`}
          title={`Abrir ${config.assistantName ?? "asistente"}`}
        >
          {safeUrl(config.logoUrl) !== undefined ? (
            <img className="eaw-avatar" src={safeUrl(config.logoUrl)} alt="" />
          ) : (
            "✦"
          )}
        </button>
      </div>
    );
  return (
    <div
      className={`eaw-root eaw-${position} ${dark ? "eaw-dark" : ""} ${state === "fullscreen" ? "eaw-fullscreen" : ""} ${className ?? ""}`}
      style={style}
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
    >
      <style>{ASSISTANT_WIDGET_CSS}</style>
      <section
        ref={panelRef}
        className={`eaw-panel ${state === "fullscreen" ? "eaw-fullscreen" : ""}`}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="eaw-header">
          {safeUrl(config.avatarUrl ?? config.logoUrl) !== undefined ? (
            <img
              className="eaw-avatar"
              src={safeUrl(config.avatarUrl ?? config.logoUrl)}
              alt=""
            />
          ) : (
            <span className="eaw-avatar" aria-hidden="true" />
          )}
          <div className="eaw-title">
            <strong id={titleId}>{config.assistantName ?? "Asistente"}</strong>
            <small>
              {state === "offline"
                ? "Sin conexión"
                : state === "loading" || state === "streaming"
                  ? "Procesando…"
                  : "Disponible"}
            </small>
          </div>
          <button
            className="eaw-button"
            type="button"
            onClick={minimize}
            aria-label="Minimizar"
          >
            —
          </button>
          {config.fullscreenEnabled !== false && (
            <button
              className="eaw-button"
              type="button"
              onClick={fullscreen}
              aria-label={
                state === "fullscreen"
                  ? "Salir de pantalla completa"
                  : "Pantalla completa"
              }
            >
              ⛶
            </button>
          )}
          <button
            className="eaw-button"
            type="button"
            onClick={close}
            aria-label="Cerrar"
          >
            ×
          </button>
        </header>
        <div className="eaw-body" aria-live="polite">
          {messages.length === 0 ? (
            <div className="eaw-welcome">
              <h2>{config.welcomeTitle ?? "¿En qué puedo ayudarte?"}</h2>
              <p>
                {config.welcomeMessage ?? "Escribe una pregunta para comenzar."}
              </p>
              <div className="eaw-suggestions">
                {(config.suggestedQuestions ?? []).map((question) => (
                  <button
                    key={question}
                    className="eaw-suggestion"
                    type="button"
                    onClick={() => void send(question)}
                  >
                    {question}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <article
                key={message.id}
                className={`eaw-message eaw-message-${message.role}`}
              >
                <span className="eaw-visually-hidden">
                  {message.role === "user" ? "Tú" : "Asistente"}:{" "}
                </span>
                {message.content}
                {config.citationsEnabled !== false &&
                  message.citations.length > 0 && (
                    <div className="eaw-citations">
                      {message.citations.map((citation, index) => (
                        <Citation
                          key={citation.id}
                          citation={citation}
                          number={index + 1}
                          onOpen={() => {
                            try {
                              config.onCitationOpened?.(citation);
                            } catch {
                              /* Callback externo aislado. */
                            }
                          }}
                        />
                      ))}
                    </div>
                  )}
              </article>
            ))
          )}
          {confirmation !== undefined && (
            <div className="eaw-confirmation" role="alert">
              <strong>{confirmation.name}</strong>
              <p>{confirmation.reason}</p>
              <p>Riesgo: {confirmation.risk}</p>
              <button type="button" onClick={() => confirmTool(true)}>
                Confirmar
              </button>
              <button type="button" onClick={() => confirmTool(false)}>
                Cancelar
              </button>
            </div>
          )}
          {error !== undefined && (
            <p className="eaw-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="eaw-composer">
          <div className="eaw-status">
            {state === "loading"
              ? "Generando respuesta…"
              : state === "streaming"
                ? "Procesando etapas…"
                : state === "offline"
                  ? "Comprueba tu conexión."
                  : `${draft.length}/${maxLength}`}
          </div>
          <div className="eaw-composer-row">
            <textarea
              value={draft}
              maxLength={maxLength}
              placeholder={config.placeholder ?? "Escribe tu mensaje…"}
              aria-label="Mensaje"
              disabled={state === "loading" || state === "streaming"}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            {state === "loading" || state === "streaming" ? (
              <button
                className="eaw-button eaw-send"
                type="button"
                onClick={() => abortRef.current?.abort()}
              >
                Cancelar
              </button>
            ) : (
              <button
                className="eaw-button eaw-send"
                type="button"
                disabled={draft.trim().length === 0}
                onClick={() => void send()}
              >
                Enviar
              </button>
            )}
          </div>
          {config.footer}
        </footer>
      </section>
    </div>
  );
}
function Citation({
  citation,
  number,
  onOpen,
}: {
  readonly citation: WidgetCitation;
  readonly number: number;
  readonly onOpen: () => void;
}) {
  const url = safeUrl(citation.url);
  return (
    <details>
      <summary>
        [{number}] {citation.title}
      </summary>
      {citation.excerpt !== undefined && <p>{citation.excerpt}</p>}
      <small>
        {citation.section !== undefined ? `Sección ${citation.section} ` : ""}
        {citation.page !== undefined ? `Página ${citation.page}` : ""}
      </small>
      {url !== undefined && (
        <p>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onOpen}
          >
            Abrir referencia
          </a>
        </p>
      )}
    </details>
  );
}
