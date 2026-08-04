import { useMemo, useState } from "react";
import {
  AssistantWidget,
  InMemoryStorageAdapter,
  MockChatTransport,
} from "@gano-bot/chat-widget";
import type {
  AssistantWidgetConfig,
  WidgetTransportResponse,
} from "@gano-bot/chat-widget";
function response(
  content: string,
  conversationId: string,
): WidgetTransportResponse {
  return Object.freeze({
    conversationId,
    message: Object.freeze({
      id: `reply-${conversationId}-${content.length}`,
      role: "assistant",
      content,
      timestamp: new Date().toISOString(),
      status: "completed",
      citations: Object.freeze([
        {
          id: "demo-source",
          title: "Guía de demostración",
          excerpt: "Fuente determinista disponible sin conexión.",
          section: "Inicio",
          page: 1,
          url: "https://example.com/reference",
        },
      ]),
      warnings: Object.freeze([]),
      metadata: Object.freeze({}),
    }),
    citations: Object.freeze([
      {
        id: "demo-source",
        title: "Guía de demostración",
        excerpt: "Fuente determinista disponible sin conexión.",
        section: "Inicio",
        page: 1,
        url: "https://example.com/reference",
      },
    ]),
  });
}
export function App() {
  const [dark, setDark] = useState(false);
  const storage = useMemo(() => new InMemoryStorageAdapter(), []);
  const transport = useMemo(
    () =>
      new MockChatTransport(async (request) => {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(resolve, 350);
          request.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timeout);
              reject(new DOMException("Cancelado", "AbortError"));
            },
            { once: true },
          );
        });
        if (request.message.toLowerCase().includes("error"))
          throw new Error("Error determinista de demostración.");
        if (
          request.message.toLowerCase().includes("acción") &&
          request.confirmationIds === undefined
        )
          return Object.freeze({
            ...response(
              "Necesito tu confirmación para continuar.",
              request.conversationId ?? "demo-conversation",
            ),
            confirmation: Object.freeze({
              confirmationRequestId: "confirmation-demo",
              toolId: "demo-action",
              name: "Acción de demostración",
              description: "Ejecuta una acción local de ejemplo.",
              risk: "bajo",
              reason: "Esta acción requiere autorización explícita.",
            }),
          });
        return response(
          request.confirmationIds !== undefined
            ? "Acción confirmada y completada."
            : `Respuesta offline: ${request.message}`,
          request.conversationId ?? "demo-conversation",
        );
      }),
    [],
  );
  const config: AssistantWidgetConfig = {
    assistantId: "assistant-demo",
    apiUrl: "/api",
    transport,
    storage,
    persistenceEnabled: true,
    theme: dark ? "dark" : "light",
    assistantName: "Asistente universal",
    welcomeTitle: "Hola, soy tu asistente",
    welcomeMessage: "Esta demostración funciona completamente offline.",
    placeholder: "Escribe una pregunta…",
    suggestedQuestions: Object.freeze([
      "Muéstrame una respuesta con fuentes",
      "Ejecuta una acción de demostración",
      "Simula un error",
    ]),
    citationsEnabled: true,
    toolsEnabled: true,
    streamingEnabled: false,
    fullscreenEnabled: true,
    primaryColor: dark ? "#8b5cf6" : "#2563eb",
  };
  return (
    <main className="app-shell">
      <section className="app-shell__content">
        <div className="foundation-card">
          <div className="foundation-card__badge">Hito 9 · Demo offline</div>
          <h1 className="foundation-card__title">Universal Chat Widget</h1>
          <p className="foundation-card__description">
            Widget embebible con citas, confirmaciones, persistencia visual,
            accesibilidad y transporte inyectable.
          </p>
          <button type="button" onClick={() => setDark((value) => !value)}>
            Cambiar a tema {dark ? "claro" : "oscuro"}
          </button>
        </div>
      </section>
      <AssistantWidget config={config} />
    </main>
  );
}
