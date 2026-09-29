import assert from "node:assert/strict";
import { createToolRegistry, createToolServices } from "@gano-bot/ai-core/tools-engine";
import type { ApiPrincipal } from "../contracts.js";
import {
  ChopifyHttpAdapter,
  COMMERCE_TOOL_IDS,
  createCommerceTools,
  createIdentityTools,
  createSupervisorTools,
  IDENTITY_TOOL_ID,
  SUPERVISOR_TOOL_ID,
} from "../commerce/index.js";
import {
  InMemoryStudioRepository,
  StudioControlPlane,
  StudioRuntimeConfigurationResolver,
  type StudioAssistantConfiguration,
} from "../studio/index.js";

const tenantId = "tenant-floes";
const assistantId = "commerce-assistant";
const calls: Array<Readonly<Record<string, unknown>>> = [];
const adapter = new ChopifyHttpAdapter({
  baseUrl: "https://chopify.example.test",
  bearerToken: "external-boundary-secret",
  fetchImpl: async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as Readonly<Record<string, unknown>>;
    calls.push(request);
    const operation = request.operation;
    const data = operation === "resolveCustomerIdentity"
      ? { customerId: "customer-1", identityId: "identity-1", channel: "WHATSAPP", externalIdentifier: "+573000000000", createdCustomer: true, createdIdentity: true }
      : operation === "createOpportunity"
        ? { opportunityId: "opportunity-1", customerId: "customer-1", status: "new" }
        : operation === "createOrderDraft"
          ? { orderId: "order-1", customerId: "customer-1", status: "draft" }
          : operation === "attachPaymentProof"
            ? { proofId: "proof-1", orderId: "order-1", status: "pending_review" }
            : operation === "requestHumanEscalation"
              ? { escalationId: "escalation-1", conversationId: "conversation-1", status: "OPEN", reason: "PAYMENT_ISSUE", priority: "HIGH" }
              : operation === "searchProducts"
                ? [{ productId: "product-1", name: "Producto FLOES", price: { amount: 25, currency: "USD" }, available: true }]
                : undefined;
    return new Response(JSON.stringify({ ok: true, data }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
});

const definitions = Object.freeze([
  ...createCommerceTools(adapter, tenantId, assistantId),
  ...createIdentityTools(adapter, tenantId, assistantId),
  ...createSupervisorTools(adapter, tenantId, assistantId),
]);
const backendAllowed = definitions.map((definition) => definition.descriptor.id);
const studio = new StudioControlPlane(new InMemoryStudioRepository(), () => backendAllowed);
const principal: ApiPrincipal = Object.freeze({
  actorId: "owner-floes",
  tenantId,
  roles: Object.freeze(["tenant-admin"] as const),
  permissions: Object.freeze(["assistants:create", "assistants:publish", "tools:execute"] as const),
  authenticated: true,
});
const now = "2026-09-28T20:00:00.000Z";
const publishedTools = Object.freeze([
  IDENTITY_TOOL_ID,
  COMMERCE_TOOL_IDS.searchProducts,
  COMMERCE_TOOL_IDS.createOpportunity,
  COMMERCE_TOOL_IDS.createOrderDraft,
  COMMERCE_TOOL_IDS.attachPaymentProof,
  SUPERVISOR_TOOL_ID,
]);
const configuration: StudioAssistantConfiguration = Object.freeze({
  id: assistantId, tenantId, version: 0, status: "draft",
  identity: Object.freeze({ name: "FLOES", description: "Ventas", purpose: "Venta asistida", locale: "es", allowedLocales: Object.freeze(["es"]), tone: "profesional", instructions: "Usa datos verificados.", welcomeMessage: "Hola" }),
  behavior: Object.freeze({ systemPrompt: "Asistente comercial FLOES.", restrictions: "No inventes precio, stock ni pago.", responseLength: "balanced", creativity: 0.2, insufficientPolicy: "ask-clarification" }),
  rag: Object.freeze({ enabled: false, groundingMode: "private-preferred", knowledgeBaseIds: Object.freeze([]), topK: 5, minimumScore: 0.25, citationsEnabled: true }),
  memory: Object.freeze({ enabled: false, shortTerm: true, longTerm: false, summary: true, retentionDays: 30, consentRequired: true }),
  tools: Object.freeze({ enabled: true, allowlist: publishedTools, maximumRisk: "medium", maximumCalls: 8, maximumRounds: 4 }),
  channels: Object.freeze(["WHATSAPP", "WEB"] as const),
  createdAt: now, updatedAt: now, createdBy: principal.actorId, updatedBy: principal.actorId,
});
await studio.saveDraft(configuration, { principal, now });
await studio.publish(tenantId, assistantId, { principal, now });
const runtimeConfiguration = await new StudioRuntimeConfigurationResolver(studio).resolve(
  tenantId,
  assistantId,
  backendAllowed,
);
assert.deepEqual(runtimeConfiguration.toolAllowlist, publishedTools);

const registry = createToolRegistry();
registry.registerMany(definitions);
const services = createToolServices({ registry });
const context = Object.freeze({
  tenantId, assistantId, actorId: "customer-1", conversationId: "conversation-1",
  requestId: "request-e2e", correlationId: "correlation-e2e",
  roles: Object.freeze(["user"]), permissions: Object.freeze(["tools:execute"]),
  allowedToolIds: runtimeConfiguration.toolAllowlist,
  allowedCategories: Object.freeze(["business"] as const), maximumRiskLevel: "medium" as const,
  metadata: Object.freeze({ idempotencyKey: "idem-e2e" }),
});
const execute = (name: string, argumentsValue: Readonly<Record<string, unknown>>) =>
  services.executor.execute({ call: { id: `call-${name}`, name, arguments: argumentsValue }, context });

assert.equal((await execute(IDENTITY_TOOL_ID, { channel: "WHATSAPP", externalIdentifier: "+573000000000" })).status, "completed");
assert.equal((await execute(COMMERCE_TOOL_IDS.createOpportunity, { customerId: "customer-1", title: "Compra FLOES" })).status, "completed");
const order = await execute(COMMERCE_TOOL_IDS.createOrderDraft, { customerId: "customer-1", lines: [{ productId: "product-1", quantity: 1 }] });
assert.equal((order.output as { readonly status: string }).status, "draft");
const proof = await execute(COMMERCE_TOOL_IDS.attachPaymentProof, { orderId: "order-1", proofUrl: "https://files.example.test/proof-1" });
assert.equal((proof.output as { readonly status: string }).status, "pending_review");
const escalation = await execute(SUPERVISOR_TOOL_ID, { reason: "PAYMENT_ISSUE", priority: "HIGH", orderId: "order-1" });
assert.equal((escalation.output as { readonly status: string }).status, "OPEN");
assert.ok(calls.every((call) => call.idempotencyKey === "idem-e2e"));
const unauthorizedTool = await execute(
  COMMERCE_TOOL_IDS.getProductDetails,
  { productId: "product-1" },
);
assert.equal(unauthorizedTool.status, "denied");
assert.equal(calls.some((call) => call.operation === "approvePayment"), false);
assert.equal(calls.some((call) => call.operation === "decrementInventory"), false);

console.log("FLOES E2E: identity, published Studio, typed Commerce, proof pending y human escalation OK");
