import assert from "node:assert/strict";
import type {
  CommercePort,
  CommerceRequestContext,
} from "../commerce/contracts.js";
import {
  COMMERCE_TOOL_IDS,
  createCommerceTools,
} from "../commerce/tools.js";

const calls: Array<{ name: string; context: CommerceRequestContext; input: unknown }> = [];

const port: CommercePort = {
  async searchProducts(context, input) {
    calls.push({ name: "searchProducts", context, input });
    return Object.freeze([{ productId: "p1", name: "Producto", price: { amount: 10, currency: "USD" }, available: true }]);
  },
  async getProductDetails(context, input) {
    calls.push({ name: "getProductDetails", context, input });
    return { productId: input.productId, name: "Producto", price: { amount: 10, currency: "USD" }, available: true };
  },
  async checkAvailability(context, input) {
    calls.push({ name: "checkAvailability", context, input });
    return { productId: input.productId, available: true, availableQuantity: 5 };
  },
  async createOrUpdateCustomer(context, input) {
    calls.push({ name: "createOrUpdateCustomer", context, input });
    return { customerId: input.customerId ?? "c1", name: input.name };
  },
  async createOpportunity(context, input) {
    calls.push({ name: "createOpportunity", context, input });
    return { opportunityId: "o1", customerId: input.customerId, status: "new" };
  },
  async createOrderDraft(context, input) {
    calls.push({ name: "createOrderDraft", context, input });
    return { orderId: "ord1", customerId: input.customerId, status: "draft", total: { amount: 20, currency: "USD" } };
  },
  async attachPaymentProof(context, input) {
    calls.push({ name: "attachPaymentProof", context, input });
    return { proofId: "proof1", orderId: input.orderId, status: "pending_review" };
  },
  async getOrderStatus(context, input) {
    calls.push({ name: "getOrderStatus", context, input });
    return { orderId: input.orderId, status: "payment-under-review", paymentStatus: "pending_review" };
  },
};

const tools = createCommerceTools(port, "floes", "commerce-assistant");
assert.equal(tools.length, 8);
assert.equal(new Set(tools.map((tool) => tool.descriptor.id)).size, 8);
assert.ok(tools.every((tool) => tool.descriptor.tenantId === "floes"));
assert.ok(tools.every((tool) => tool.descriptor.assistantId === "commerce-assistant"));
assert.ok(tools.every((tool) => tool.descriptor.requiredPermissions.includes("tools:execute")));

const search = tools.find((tool) => tool.descriptor.id === COMMERCE_TOOL_IDS.searchProducts);
assert.ok(search);
await search.handler.execute(
  { query: "", limit: 5 },
  {
    tenantId: "floes",
    assistantId: "commerce-assistant",
    actorId: "customer-1",
    conversationId: "conv-1",
    requestId: "req-catalog",
    correlationId: "corr-catalog",
    roles: ["user"],
    permissions: ["tools:execute"],
    allowedToolIds: tools.map((tool) => tool.descriptor.id),
    allowedCategories: ["business"],
    maximumRiskLevel: "safe",
  },
);
assert.deepEqual(calls.at(-1)?.input, { query: "", limit: 5 });

const proof = tools.find((tool) => tool.descriptor.id === COMMERCE_TOOL_IDS.attachPaymentProof);
assert.ok(proof);
const result = await proof.handler.execute(
  { orderId: "ord1", proofUrl: "https://example.invalid/proof" },
  {
    tenantId: "floes",
    assistantId: "commerce-assistant",
    actorId: "customer-1",
    conversationId: "conv-1",
    requestId: "req-1",
    correlationId: "corr-1",
    roles: ["user"],
    permissions: ["tools:execute"],
    allowedToolIds: tools.map((tool) => tool.descriptor.id),
    allowedCategories: ["business"],
    maximumRiskLevel: "medium",
  },
);
assert.deepEqual(result, {
  proofId: "proof1",
  orderId: "ord1",
  status: "pending_review",
});
assert.equal(calls.at(-1)?.context.tenantId, "floes");
assert.equal(
  calls.at(-1)?.context.idempotencyKey,
  "floes:req-1:commerce.attachPaymentProof",
);

const order = tools.find((tool) => tool.descriptor.id === COMMERCE_TOOL_IDS.createOrderDraft);
assert.ok(order);
assert.equal(order.descriptor.riskLevel, "medium");
const draft = await order.handler.execute(
  {
    customerId: "c1",
    lines: [{ productId: "p1", quantity: 2 }],
  },
  {
    tenantId: "floes",
    assistantId: "commerce-assistant",
    actorId: "customer-1",
    conversationId: "conv-1",
    requestId: "req-2",
    correlationId: "corr-2",
    roles: ["user"],
    permissions: ["tools:execute"],
    allowedToolIds: tools.map((tool) => tool.descriptor.id),
    allowedCategories: ["business"],
    maximumRiskLevel: "medium",
  },
);
assert.equal((draft as { status: string }).status, "draft");

console.log("Commerce H2: contratos, aislamiento, idempotencia y PaymentProof pendiente OK");
