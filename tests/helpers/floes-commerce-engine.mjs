import { AIChatProviderRegistry } from "../../packages/ai-core/dist/chat/registry.js";
import { AssistantManager } from "../../packages/ai-core/dist/runtime/manager.js";
import { createToolRegistry, createToolServices } from "../../packages/ai-core/dist/tools-engine/index.js";
import { AssistantManagerChatGateway, InMemoryAssistantRepository, InMemoryConversationRepository, InMemoryRequestAuditSink, RedactingLogger, createBackendApplication, COMMERCE_ASSISTANT_ID, COMMERCE_PROMPT_CONFIG } from "../../apps/functions/dist/index.js";
import { createCatalogTools, createCommerceTools, createIdentityTools, createSupervisorTools } from "../../apps/functions/dist/commerce/index.js";
import { createHostedCommerceProvider, createLiveOmnichannelProcessor, createLiveWhatsAppProcessor } from "../../scripts/gano-hosted-runtime.mjs";
import { createLiveHandler } from "../../api/live.mjs";

/** Test-only: hosted provider, manager, API and tools are real; external storage/provider ports are isolated. */
export function createFloesEngineFixture({ port, tenantId = "tenant-floes", now = () => "2026-10-13T04:00:00.000Z" }) {
  const activeLiveCommerceMetadata = new Map();
  const environment = { FLOES_CATALOG_V2: "true", FLOES_WHATSAPP_MEDIA: "true", GANOBOT_LIVE_BEARER_TOKEN: "fixture-live-only" };
  const provider = createHostedCommerceProvider({ commerceTenantId: tenantId, activeLiveCommerceMetadata, now, environment });
  const definitions = Object.freeze([...createCommerceTools(port, tenantId, COMMERCE_ASSISTANT_ID), ...createCatalogTools(port, tenantId, COMMERCE_ASSISTANT_ID), ...createIdentityTools(port, tenantId, COMMERCE_ASSISTANT_ID), ...createSupervisorTools(port, tenantId, COMMERCE_ASSISTANT_ID)]);
  const registry = createToolRegistry();
  registry.registerMany(definitions);
  const descriptor = Object.freeze({ id: COMMERCE_ASSISTANT_ID, tenantId, name: "FLOES test boundary", version: "1.0.0", locale: "es", enabled: true, capabilities: Object.freeze({ conversation: true, intentDetection: true, contextBuilding: true, promptBuilding: true, responseValidation: true, chatFallback: false, embeddings: false, memory: false, knowledge: false, tools: true, streaming: false }) });
  const manager = new AssistantManager();
  manager.create({ definition: Object.freeze({ descriptor, configuration: Object.freeze({ primaryChatProviderId: provider.descriptor.id, prompt: COMMERCE_PROMPT_CONFIG, tools: Object.freeze(definitions.map(tool => Object.freeze({ name: tool.descriptor.id, description: tool.descriptor.description, parameters: tool.descriptor.inputSchema }))), persistMessages: true, rejectInvalidResponse: true }) }), dependencies: Object.freeze({ chatProviders: new AIChatProviderRegistry({ providers: [provider], defaultProviderId: provider.descriptor.id }) }) });
  const assistants = new InMemoryAssistantRepository();
  assistants.register(descriptor);
  const conversations = new InMemoryConversationRepository();
  const audit = new InMemoryRequestAuditSink();
  const principal = Object.freeze({ actorId: "chopify-whatsapp-live", tenantId, roles: Object.freeze(["user"]), permissions: Object.freeze(["assistants:read", "conversations:read", "conversations:write", "chat:execute", "tools:execute"]), assistantIds: Object.freeze([COMMERCE_ASSISTANT_ID]), authenticated: true });
  const liveApplication = createBackendApplication({ chat: new AssistantManagerChatGateway(manager), assistants, conversations, audit, logger: new RedactingLogger(), tools: createToolServices({ registry }), now: () => new Date(now()), authentication: Object.freeze({ async authenticate() { return Object.freeze({ principal }); } }) }, { maximumBodyBytes: 32 * 1024 });
  const runtime = { processLiveWhatsApp: createLiveWhatsAppProcessor({ commerceTenantId: tenantId, liveApplication, activeLiveCommerceMetadata, environment }), processLiveOmnichannel: createLiveOmnichannelProcessor({ commerceTenantId: tenantId, liveApplication, activeLiveCommerceMetadata, environment }) };
  const handler = createLiveHandler({ environment, runtimeFactory: async requestedTenantId => { if (requestedTenantId !== tenantId) throw new Error("Fixture tenant mismatch"); return runtime; } });
  let messageNumber = 0;
  const send = async (text, overrides = {}) => {
    const body = { tenantId, channel: "WHATSAPP", providerMessageId: `wamid.fixture-${++messageNumber}`, conversationId: "conversation_fixture_canonical", customer: { phone: "15550001111", name: "Synthetic customer" }, text, ...overrides };
    const result = {};
    await handler({ method: "POST", headers: { authorization: "Bearer fixture-live-only" }, body }, { set statusCode(status) { result.status = status; }, setHeader() {}, end(value) { result.body = JSON.parse(value); } });
    return result;
  };
  return Object.freeze({ runtime, handler, send, conversations, audit, manager, liveApplication, registry });
}
