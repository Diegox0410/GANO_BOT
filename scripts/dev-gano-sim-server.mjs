import { createServer } from "node:http";
import { Readable } from "node:stream";
import { AIChatProviderRegistry } from "../packages/ai-core/dist/chat/registry.js";
import { AssistantManager } from "../packages/ai-core/dist/runtime/manager.js";
import {
  createToolRegistry,
  createToolServices,
} from "../packages/ai-core/dist/tools-engine/index.js";
import {
  AssistantManagerChatGateway,
  DevelopmentGanoSimAffiliateProfileProvider,
  InMemoryAssistantRepository,
  createBackendApplication,
  createGanoSimAffiliateProfileTool,
} from "../apps/functions/dist/index.js";

const tenantId = "gano-sim";
const assistantId = "gano-assistant";
const now = () => new Date().toISOString();
const descriptor = Object.freeze({
  id: assistantId,
  tenantId,
  name: "Asistente Gano Sim",
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
    memory: false,
    knowledge: false,
    tools: true,
    streaming: false,
  }),
});
const provider = Object.freeze({
  name: "development",
  descriptor: Object.freeze({
    id: "gano-sim-development",
    name: "development",
    displayName: "Gano Sim Development Provider",
    defaultModel: "deterministic-mvp",
    enabled: true,
    capabilities: Object.freeze({
      supportsStreaming: false,
      supportsTools: true,
      supportsJson: false,
      supportsMultimodal: false,
      supportsSeed: true,
    }),
  }),
  async generate(request) {
    const createdAt = now();
    const last = request.messages.at(-1);
    const toolMessage = request.messages.findLast((message) => message.role === "tool");
    const personal = /perfil|rango|progreso/i.test(last?.content ?? "");
    const tool = toolMessage === undefined ? undefined : JSON.parse(toolMessage.content);
    const content = tool?.authenticated === true
      ? `${tool.profile.displayName}, tu rango actual es ${tool.profile.currentRank}, acumulas ${tool.profile.personalVolume} PV y tu siguiente objetivo es ${tool.profile.nextRank}.`
      : tool?.authenticated === false
        ? tool.message
        : personal
          ? "Consultando tu perfil autorizado…"
          : "Puedo orientarte con información pública de Gano Sim. Inicia sesión para consultar datos personales.";
    const toolCalls = personal && tool === undefined
      ? Object.freeze([{ id: `call-${Date.now()}`, name: "gano.getCurrentAffiliateProfile", arguments: Object.freeze({}) }])
      : Object.freeze([]);
    const message = Object.freeze({ id: `message-${Date.now()}`, role: "assistant", content, contentType: "text", status: "completed", createdAt, updatedAt: createdAt });
    return Object.freeze({ id: `response-${Date.now()}`, requestId: request.requestId, provider: "development", model: "deterministic-mvp", content, message, toolCalls, finishReason: toolCalls.length > 0 ? "tool_calls" : "stop", createdAt });
  },
});
const chatProviders = new AIChatProviderRegistry({ providers: [provider], defaultProviderId: provider.descriptor.id });
const manager = new AssistantManager();
manager.create({
  definition: Object.freeze({
    descriptor,
    configuration: Object.freeze({
      primaryChatProviderId: provider.descriptor.id,
      tools: Object.freeze([{ name: "gano.getCurrentAffiliateProfile", description: "Obtiene el perfil del afiliado autenticado.", parameters: Object.freeze({ type: "object", additionalProperties: false, properties: Object.freeze({}) }) }]),
      persistMessages: false,
    }),
  }),
  dependencies: Object.freeze({ chatProviders }),
});
const assistants = new InMemoryAssistantRepository();
assistants.register(descriptor);
const profileProvider = new DevelopmentGanoSimAffiliateProfileProvider(Object.freeze({
  [`${tenantId}:affiliate-demo`]: Object.freeze({ affiliateId: "affiliate-demo", displayName: "Afiliada Demo", currentRank: "Bronce", personalVolume: 860, nextRank: "Plata" }),
}));
const registry = createToolRegistry();
registry.register(createGanoSimAffiliateProfileTool(profileProvider, tenantId, assistantId));
const runtimeGateway = new AssistantManagerChatGateway(manager);
const application = createBackendApplication({
  chat: Object.freeze({
    async generate(input) {
      try {
        return await runtimeGateway.generate(input);
      } catch (error) {
        console.error("Gano Sim runtime error", error);
        throw error;
      }
    },
  }),
  assistants,
  tools: createToolServices({ registry }),
});
const server = createServer(async (incoming, outgoing) => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  const method = incoming.method ?? "GET";
  const request = new Request(`http://127.0.0.1:8788${incoming.url ?? "/"}`, {
    method,
    headers,
    ...(method === "GET" || method === "HEAD" ? {} : { body: Readable.toWeb(incoming), duplex: "half" }),
  });
  const response = await application.handle(request);
  outgoing.statusCode = response.status;
  response.headers.forEach((value, name) => outgoing.setHeader(name, value));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
});
server.listen(8788, "127.0.0.1", () => console.log("Gano Sim MVP Backend: http://127.0.0.1:8788"));
