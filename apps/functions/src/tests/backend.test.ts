import {
  createOfflineBuiltinTools,
  createToolRegistry,
  createToolServices,
} from "@gano-bot/ai-core/tools-engine";
import { createBackendApplication } from "../application.js";
import {
  InMemoryAssistantRepository,
  InMemoryKnowledgeCatalog,
} from "../repositories.js";
import { InMemoryRequestAuditSink, RedactingLogger } from "../services.js";
import type { AIMessage, AssistantDescriptor } from "@gano-bot/ai-core";
import type { BackendChatGateway } from "../services.js";

let assertions = 0;
function assert(condition: boolean, message: string): void {
  assertions += 1;
  if (!condition) throw new Error(message);
}
async function json(
  response: Response,
): Promise<Readonly<Record<string, unknown>>> {
  return (await response.json()) as Readonly<Record<string, unknown>>;
}
const descriptor: AssistantDescriptor = Object.freeze({
  id: "assistant-a",
  tenantId: "tenant-a",
  name: "Asistente de prueba",
  version: "1.0.0",
  locale: "es",
  enabled: true,
  capabilities: Object.freeze({
    conversation: true,
    intentDetection: true,
    contextBuilding: true,
    promptBuilding: true,
    responseValidation: true,
    chatFallback: false,
    embeddings: false,
    memory: true,
    knowledge: true,
    tools: true,
    streaming: false,
  }),
});
const assistants = new InMemoryAssistantRepository();
assistants.register(descriptor);
const registry = createToolRegistry();
registry.registerMany(
  createOfflineBuiltinTools({
    clock: () => new Date("2026-08-04T12:00:00.000Z"),
    generateUuid: () => "fixed-uuid",
  }),
);
const tools = createToolServices({
  registry,
  now: () => "2026-08-04T12:00:00.000Z",
  generateId: (prefix) => `${prefix}-fixed`,
});
let generationCalls = 0;
const gateway: BackendChatGateway = Object.freeze({
  async generate(input: Parameters<BackendChatGateway["generate"]>[0]) {
    generationCalls += 1;
    const now = "2026-08-04T12:00:00.000Z";
    const message: AIMessage = Object.freeze({
      id: `answer-${generationCalls}`,
      conversationId: input.conversationId,
      role: "assistant",
      content:
        input.toolResults.length > 0
          ? "Resultado verificado."
          : `Eco: ${input.request.message}`,
      contentType: "text",
      status: "completed",
      createdAt: now,
      updatedAt: now,
    });
    const toolCalls =
      input.request.message === "tool" && input.toolResults.length === 0
        ? Object.freeze([
            {
              id: "call-1",
              name: "calculator",
              arguments: Object.freeze({ expression: "2 + 2" }),
            },
          ])
        : Object.freeze([]);
    return Object.freeze({
      message,
      toolCalls,
      citations: input.request.message.includes("fuente")
        ? Object.freeze([
            {
              id: "chunk-1",
              title: "Documento",
              documentId: "document-1",
              score: 1,
            },
          ])
        : Object.freeze([]),
    });
  },
});
const audit = new InMemoryRequestAuditSink();
const logger = new RedactingLogger();
let sequence = 0;
const app = createBackendApplication(
  {
    chat: gateway,
    assistants,
    tools,
    audit,
    logger,
    knowledge: new InMemoryKnowledgeCatalog(
      Object.freeze([
        {
          id: "kb-1",
          tenantId: "tenant-a",
          assistantId: "assistant-a",
          name: "Base",
          status: "active",
        },
      ]),
      Object.freeze([
        {
          id: "document-1",
          tenantId: "tenant-a",
          assistantId: "assistant-a",
          knowledgeBaseId: "kb-1",
          title: "Documento",
          mediaType: "text/plain",
          status: "ready",
        },
      ]),
    ),
    now: () => new Date("2026-08-04T12:00:00.000Z"),
    generateId: (prefix) => `${prefix}-${++sequence}`,
  },
  {
    rateLimit: { limit: 50, windowMilliseconds: 60000 },
    allowedOrigins: Object.freeze(["https://allowed.example"]),
  },
);
const auth = Object.freeze({
  authorization: "Bearer dev:tenant-a:user-a",
  "content-type": "application/json",
});
async function run(): Promise<void> {
  const health = await app.handle(new Request("http://local/health"));
  assert(health.status === 200, "health debe responder");
  const unauthorized = await app.handle(new Request("http://local/ready"));
  assert(unauthorized.status === 401, "ready debe autenticar");
  const ready = await app.handle(
    new Request("http://local/ready", { headers: auth }),
  );
  assert(ready.status === 200, "ready debe comprobar dependencias");
  const ids = await app.handle(
    new Request("http://local/v1/assistants", {
      headers: {
        ...auth,
        "x-request-id": "request-known",
        "x-correlation-id": "correlation-known",
      },
    }),
  );
  assert(
    ids.headers.get("x-request-id") === "request-known" &&
      ids.headers.get("x-correlation-id") === "correlation-known",
    "debe propagar IDs",
  );
  const assistantBody = await json(ids);
  assert(
    Array.isArray(assistantBody.data) && assistantBody.data.length === 1,
    "debe listar asistentes del tenant",
  );
  const otherTenant = await app.handle(
    new Request("http://local/v1/assistants/assistant-a", {
      headers: { authorization: "Bearer dev:tenant-b:user-b" },
    }),
  );
  assert(
    otherTenant.status === 404,
    "no debe filtrar asistentes de otro tenant",
  );
  const invalidType = await app.handle(
    new Request("http://local/v1/chat", {
      method: "POST",
      headers: {
        authorization: auth.authorization,
        "content-type": "text/plain",
      },
      body: "{}",
    }),
  );
  assert(invalidType.status === 415, "debe rechazar content-type inválido");
  const invalidBody = await app.handle(
    new Request("http://local/v1/chat", {
      method: "POST",
      headers: auth,
      body: "{}",
    }),
  );
  assert(invalidBody.status === 400, "debe validar body");
  const chat = await app.handle(
    new Request("http://local/v1/chat", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        assistantId: "assistant-a",
        message: "hola fuente",
      }),
    }),
  );
  assert(chat.status === 200, "chat debe responder");
  const chatBody = await json(chat);
  const chatData = chatBody.data as Readonly<Record<string, unknown>>;
  assert(
    Array.isArray(chatData.citations) && chatData.citations.length === 1,
    "chat debe conservar citas",
  );
  const conversationId = String(chatData.conversationId);
  const conversation = await app.handle(
    new Request(
      `http://local/v1/conversations/${conversationId}?assistantId=assistant-a`,
      { headers: auth },
    ),
  );
  assert(conversation.status === 200, "debe persistir conversación");
  const tool = await app.handle(
    new Request("http://local/v1/chat", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ assistantId: "assistant-a", message: "tool" }),
    }),
  );
  assert(
    tool.status === 200 && generationCalls >= 3,
    "debe reenviar tool-result al provider",
  );
  const stream = await app.handle(
    new Request("http://local/v1/chat/stream", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ assistantId: "assistant-a", message: "stream" }),
    }),
  );
  const streamText = await stream.text();
  assert(
    stream.headers.get("content-type")?.startsWith("text/event-stream") ===
      true &&
      streamText.includes("message.completed") &&
      streamText.includes("done"),
    "debe emitir eventos SSE sin fingir deltas",
  );
  const bases = await app.handle(
    new Request("http://local/v1/knowledge-bases", { headers: auth }),
  );
  assert(bases.status === 200, "debe listar knowledge bases");
  const base = await app.handle(
    new Request("http://local/v1/knowledge-bases/kb-1", { headers: auth }),
  );
  assert(base.status === 200, "debe obtener knowledge base autorizada");
  const documents = await app.handle(
    new Request("http://local/v1/documents", { headers: auth }),
  );
  assert(documents.status === 200, "debe listar documentos seguros");
  const document = await app.handle(
    new Request("http://local/v1/documents/document-1", { headers: auth }),
  );
  assert(document.status === 200, "debe obtener metadata documental segura");
  const ingestion = await app.handle(
    new Request("http://local/v1/ingestion/jobs", {
      method: "POST",
      headers: {
        authorization: "Bearer dev:tenant-a:admin:tenant-admin",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        assistantId: "assistant-a",
        fixtureId: "sample.txt",
      }),
    }),
  );
  assert(ingestion.status === 202, "debe ejecutar ingesta autorizada");
  const traversal = await app.handle(
    new Request("http://local/v1/ingestion/jobs", {
      method: "POST",
      headers: {
        authorization: "Bearer dev:tenant-a:admin:tenant-admin",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        assistantId: "assistant-a",
        fixtureId: "../secret",
      }),
    }),
  );
  assert(traversal.status === 400, "debe bloquear traversal");
  const listTools = await app.handle(
    new Request("http://local/v1/tools", { headers: auth }),
  );
  assert(listTools.status === 200, "debe listar tools autorizadas");
  const directTool = await app.handle(
    new Request("http://local/v1/tools/calculator/execute", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        assistantId: "assistant-a",
        arguments: { expression: "3 * 3" },
      }),
    }),
  );
  assert(directTool.status === 200, "debe ejecutar tool mediante Tools Engine");
  const deleted = await app.handle(
    new Request(
      `http://local/v1/conversations/${conversationId}?assistantId=assistant-a`,
      { method: "DELETE", headers: auth },
    ),
  );
  assert(deleted.status === 200, "debe eliminar conversación propia");
  const preflight = await app.handle(
    new Request("http://local/v1/chat", {
      method: "OPTIONS",
      headers: { origin: "https://allowed.example" },
    }),
  );
  assert(
    preflight.status === 204 &&
      preflight.headers.get("access-control-allow-origin") ===
        "https://allowed.example",
    "debe aplicar CORS configurable",
  );
  logger.log("info", "redaction", { token: "secret", safe: "visible" });
  assert(
    !("token" in (logger.entries.at(-1)?.metadata ?? {})),
    "debe redactar logs",
  );
  assert(audit.list().length >= 15, "debe auditar requests autenticadas");
  console.log(
    `Backend/API: ${assertions} verificaciones deterministas correctas.`,
  );
}
await run();
