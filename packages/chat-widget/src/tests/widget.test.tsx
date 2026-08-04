import { renderToString } from "react-dom/server";
import { AssistantWidget } from "../AssistantWidget.js";
import {
  createChatWidgetController,
  createFunctionalChatTransport,
  createMemoryChatPersistence,
} from "../index.js";
import { InMemoryStorageAdapter } from "../storage.js";
import {
  DirectApiTransport,
  HttpChatTransport,
  MockChatTransport,
  WidgetTransportError,
  parseSsePayload,
} from "../transport.js";
import type {
  WidgetTransportRequest,
  WidgetTransportResponse,
} from "../universal.types.js";
let assertions = 0;
function assert(condition: boolean, message: string): void {
  assertions += 1;
  if (!condition) throw new Error(message);
}
const now = "2026-08-04T12:00:00.000Z";
const oldTransport = createFunctionalChatTransport(async (request) => ({
  id: `answer-${request.requestId}`,
  content: `Respuesta: ${request.message.content}`,
  sources: Object.freeze([{ id: "source", title: "Fuente" }]),
}));
const persistence = createMemoryChatPersistence();
let callbackErrors = 0;
const controller = createChatWidgetController({
  transport: oldTransport,
  persistence,
  persistAutomatically: true,
  initialSuggestions: Object.freeze([
    { id: "suggestion", label: "Pregunta", prompt: "Contenido sugerido" },
  ]),
  generateId: (() => {
    let id = 0;
    return () => `id-${++id}`;
  })(),
  now: () => now,
  onError: () => {
    callbackErrors += 1;
  },
});
function request(signal: AbortSignal): WidgetTransportRequest {
  return Object.freeze({
    assistantId: "assistant-a",
    tenantId: "tenant-a",
    message: "Hola",
    locale: "es",
    requestId: "request-a",
    correlationId: "correlation-a",
    signal,
  });
}
const widgetResponse: WidgetTransportResponse = Object.freeze({
  conversationId: "conversation-a",
  message: Object.freeze({
    id: "answer",
    role: "assistant",
    content: "Respuesta",
    timestamp: now,
    status: "completed",
    citations: Object.freeze([]),
    warnings: Object.freeze([]),
    metadata: Object.freeze({}),
  }),
  citations: Object.freeze([]),
});
async function run(): Promise<void> {
  await controller.initialize();
  assert(controller.getState().initialized, "debe inicializar");
  controller.open();
  assert(controller.getState().isOpen, "debe abrir");
  controller.minimize();
  assert(controller.getState().isMinimized, "debe minimizar");
  controller.restore();
  assert(!controller.getState().isMinimized, "debe restaurar");
  controller.close();
  assert(!controller.getState().isOpen, "debe cerrar");
  controller.open();
  const message = await controller.sendMessage("Hola");
  assert(message?.content === "Respuesta: Hola", "debe enviar mensajes");
  assert(message?.sources.length === 1, "debe conservar fuentes");
  await controller.sendSuggestion("suggestion");
  assert(
    controller
      .getState()
      .messages.some((item) => item.content === "Contenido sugerido"),
    "debe enviar sugerencias",
  );
  const restored = createChatWidgetController({
    transport: oldTransport,
    persistence,
  });
  await restored.initialize();
  assert(
    restored.getState().messages.length > 0,
    "debe restaurar persistencia",
  );
  await controller.clearConversation();
  assert(
    controller.getState().messages.length === 0,
    "debe limpiar conversación",
  );
  assert(callbackErrors === 0, "no debe producir errores inesperados");
  const storage = new InMemoryStorageAdapter();
  await storage.save("tenant:assistant", {
    conversationId: "conversation-a",
    state: "active",
    theme: "dark",
    savedAt: now,
  });
  assert(
    (await storage.load("tenant:assistant"))?.conversationId ===
      "conversation-a",
    "debe persistir sólo estado seguro",
  );
  await storage.remove("tenant:assistant");
  assert(
    (await storage.load("tenant:assistant")) === undefined,
    "debe eliminar persistencia",
  );
  const sse = parseSsePayload(
    `event: request.accepted\ndata: {"step":1}\n\nevent: done\ndata: {}\n\n`,
  );
  assert(
    sse.length === 2 && sse[1]?.type === "done",
    "debe analizar SSE por etapas",
  );
  let invalidSse = false;
  try {
    parseSsePayload("event: error\ndata: {bad}\n\n");
  } catch {
    invalidSse = true;
  }
  assert(invalidSse, "debe rechazar SSE inválido");
  const mock = new MockChatTransport(() => widgetResponse);
  assert(
    (await mock.send(request(new AbortController().signal))).conversationId ===
      "conversation-a",
    "mock explícito debe ser determinista",
  );
  const api = {
    handle: async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: {
            conversationId: "conversation-a",
            message: { id: "answer", content: "Respuesta", updatedAt: now },
            citations: [],
          },
          requestId: "request-a",
          correlationId: "correlation-a",
          metadata: {},
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  };
  const direct = new DirectApiTransport(api, {
    apiUrl: "http://direct",
    tokenProvider: { getAccessToken: async () => "dev-token" },
  });
  assert(
    (await direct.send(request(new AbortController().signal))).message
      .content === "Respuesta",
    "DirectApiTransport debe consumir Backend API",
  );
  let capturedAuthorization = "";
  const http = new HttpChatTransport({
    apiUrl: "http://api",
    tokenProvider: { getAccessToken: async () => "token" },
    customHeaders: { "x-client-version": "1", "x-secret": "blocked" },
    fetchImplementation: async (_input, init) => {
      const sent = new Headers(init?.headers);
      capturedAuthorization = sent.get("authorization") ?? "";
      assert(!sent.has("x-secret"), "debe bloquear headers sensibles");
      return api.handle();
    },
  });
  await http.send(request(new AbortController().signal));
  assert(
    capturedAuthorization === "Bearer token",
    "debe usar TokenProvider sin persistir token",
  );
  const markup = renderToString(
    <AssistantWidget
      config={{
        assistantId: "assistant-a",
        apiUrl: "/api",
        transport: mock,
      assistantName: "Asistente seguro",
      welcomeMessage: "<script>alert(1)</script>",
      logoUrl: "javascript:alert(1)",
      autoOpen: true,
      }}
    />,
  );
  assert(markup.includes("Asistente seguro"), "debe integrar React");
  assert(!markup.includes("javascript:alert"), "debe bloquear URL insegura");
  assert(
    markup.includes("&lt;script&gt;"),
    "debe escapar contenido no confiable",
  );
  assert(
    typeof DirectApiTransport === "function" &&
      typeof HttpChatTransport === "function",
    "debe exportar transportes estables",
  );
  assert(
    new WidgetTransportError("OFFLINE", "Sin red", true).retryable,
    "debe normalizar error offline",
  );
  controller.destroy();
  restored.destroy();
  console.log(
    `Universal Widget: ${assertions} verificaciones deterministas correctas.`,
  );
}
await run();
