import assert from "node:assert/strict";
import test from "node:test";
import { createFloesEngineFixture } from "./helpers/floes-commerce-engine.mjs";
import { createCommerceTools, createCatalogTools, CATALOG_TOOL_IDS, COMMERCE_TOOL_IDS } from "../apps/functions/dist/commerce/index.js";
import { consultCatalog } from "../apps/functions/dist/commerce/catalogTools.js";
import { catalogConversationResponse } from "../scripts/floes-catalog-conversation.mjs";

const variant = { variantId: "fixture-daniela-white", sku: "FLOES-FIXTURE-WHITE", name: "Blanco", color: "Blanco", active: true, available: true, sizes: ["XS", "S", "M"], sizeAvailability: [{ size: "XS", availableQuantity: 2, available: true }, { size: "S", availableQuantity: 0, available: false }, { size: "M", availableQuantity: 1, available: true }], price: { amount: 39.99, currency: "USD" }, pricingStatus: "READY", images: [{ url: "https://images.example.test/daniela/blanco.jpg", alt: "Synthetic Daniela Blanco" }] };
const product = { productId: "fixture-daniela", name: "Daniela", description: "Synthetic contract description, not production.", available: true, variants: [variant], price: { amount: 39.99, currency: "USD" }, pricingStatus: "READY" };
const context = { tenantId: "tenant-floes", assistantId: "commerce-assistant", actorId: "fixture-customer", conversationId: "memory-fixture", requestId: "fixture-request", correlationId: "fixture-correlation", metadata: { customerId: "fixture-customer", originConversationId: "conversation_fixture_canonical" } };
function createPort(overrides = {}) {
  const writes = [];
  const port = {
    async resolveCustomerIdentity() { return { customerId: "fixture-customer", identityId: "fixture-identity", channel: "WHATSAPP", externalIdentifier: "15550001111", createdCustomer: false, createdIdentity: false }; },
    async searchProducts() { return [product]; },
    async getProductDetails() { return product; },
    async checkAvailability(_context, input) { const size = variant.sizeAvailability.find(item => item.size === input.size); return { productId: product.productId, variantId: variant.variantId, size: input.size, available: Boolean(size?.available), availableQuantity: size?.availableQuantity }; },
    async createOrUpdateCustomer(_context, input) { writes.push({ operation: "createOrUpdateCustomer", input }); return { customerId: "fixture-customer" }; },
    async createOpportunity(_context, input) { writes.push({ operation: "createOpportunity", input }); return { opportunityId: "fixture-opportunity", customerId: "fixture-customer", status: "new" }; },
    async createOrderDraft(c, input) { writes.push({ operation: "createOrderDraft", context: c, input }); return { orderId: "fixture-order", customerId: "fixture-customer", status: "draft", total: { amount: 39.99, currency: "USD" } }; },
    async getOrderStatus() { return { orderId: "fixture-order", customerId: "fixture-customer", status: "draft", paymentStatus: "unpaid" }; },
    async attachPaymentProof(c, input) { writes.push({ operation: "attachPaymentProof", context: c, input }); return { proofId: "fixture-proof", orderId: input.orderId, status: "pending_review" }; },
    async requestHumanEscalation(c, input) { writes.push({ operation: "requestHumanEscalation", context: c, input }); return { escalationId: "fixture-case", conversationId: c.originConversationId ?? c.conversationId, reason: input.reason, status: "OPEN", priority: input.priority ?? "NORMAL" }; },
    ...overrides,
  };
  return { port, writes };
}

test("motor hosted real conserva contexto/foto y solo crea draft al finalizar", async () => {
  const { port, writes } = createPort();
  const engine = createFloesEngineFixture({ port });
  const first = await engine.send("Hola, quiero ver Daniela.");
  assert.equal(first.status, 200);
  assert.equal(first.body.commerce.customerId, "fixture-customer");
  assert.equal(first.body.commerce.conversationId, "conversation_fixture_canonical");
  assert.equal(first.body.commerce.productId, product.productId);
  const color = await engine.send("Blanco.");
  assert.equal(color.status, 200);
  assert.equal(color.body.messages?.filter(item => item.type === "image").length, 1);
  assert.equal(color.body.commerce.color, "Blanco");
  const size = await engine.send("XS.");
  assert.equal(size.status, 200);
  assert.equal(size.body.commerce.size, "XS");
  assert.equal(size.body.messages, undefined);
  assert.match(size.body.reply, /Quieres agregarlo/);
  const confirmed = await engine.send("Sí.");
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.commerce.color, "Blanco");
  assert.equal(confirmed.body.commerce.size, "XS");
  assert.match(confirmed.body.reply, /anotado/);
  assert.equal(writes.length, 0);
  const draft = await engine.send("Finalizar pedido");
  assert.equal(draft.status, 200);
  assert.equal(draft.body.commerce.orderId, "fixture-order");
  assert.equal(writes.filter(item => item.operation === "createOrderDraft").length, 1);
  const request = writes.find(item => item.operation === "createOrderDraft");
  assert.equal(request.context.originConversationId, "conversation_fixture_canonical");
  assert.equal(request.input.lines[0].size, "XS");
  assert.match(draft.body.reply, /borrador/);
  assert.doesNotMatch(draft.body.reply, /pago confirmado|Servientrega, retiro/);
  const history = await engine.conversations.list("tenant-floes", "chopify-whatsapp-live");
  assert.equal(history.length, 1);
  assert.ok(history[0].messages.some(item => item.content === "Blanco."));
  assert.ok(history[0].messages.some(item => item.role === "assistant" && item.metadata?.commerceSelection));
  assert.equal((await engine.conversations.list("tenant-mg", "chopify-whatsapp-live")).length, 0);
});

test("motor hosted registra proof del pedido propio solo como pending_review", async () => {
  const { port, writes } = createPort();
  const engine = createFloesEngineFixture({ port });
  for (const text of ["Hola, quiero ver Daniela", "Blanco", "XS", "Sí", "Finalizar pedido"]) assert.equal((await engine.send(text)).status, 200);
  const proof = await engine.send("Adjunto mi comprobante", { paymentProofReference: "meta-whatsapp://123456789/media/fixture-proof" });
  assert.equal(proof.status, 200);
  assert.match(proof.body.reply, /pendiente de revisión/);
  const call = writes.find(item => item.operation === "attachPaymentProof");
  assert.equal(call.input.customerId, "fixture-customer");
  assert.equal(call.context.originConversationId, "conversation_fixture_canonical");
  assert.equal(call.input.orderId, "fixture-order");
  assert.equal(writes.some(item => /approve|inventory|dispatch/i.test(item.operation)), false);
});

test("motor hosted escala al humano sin perder identidad canónica", async () => {
  const { port, writes } = createPort();
  const engine = createFloesEngineFixture({ port });
  await engine.send("Hola, quiero ver Daniela");
  const response = await engine.send("Quiero hablar con una persona");
  assert.equal(response.status, 200);
  assert.equal(response.body.requiresHuman, true);
  assert.equal(response.body.commerce.customerId, "fixture-customer");
  assert.equal(response.body.commerce.conversationId, "conversation_fixture_canonical");
  assert.equal(writes.filter(item => item.operation === "requestHumanEscalation").length, 1);
});

test("color documentado no se oculta por stock de talla pendiente ni se vende", async () => {
  const grouped = { ...product, available: false, variants: [{ ...variant, available: false, sizeAvailability: undefined, availableQuantity: undefined }] };
  const { port, writes } = createPort({ async getProductDetails() { return grouped; }, async searchProducts() { return [grouped]; }, async checkAvailability() { return { available: false, reason: "size_stock_not_configured" }; } });
  const model = catalogConversationResponse(await consultCatalog(port, context, { productId: product.productId }), "Daniela");
  assert.match(model.reply, /Blanco/);
  const selected = catalogConversationResponse(await consultCatalog(port, context, { productId: product.productId, color: "Blanco", size: "XS" }), "Blanco XS");
  assert.equal(selected.selection.variantId, variant.variantId);
  assert.equal(selected.selection.pendingAction, undefined);
  assert.equal(selected.image.url, variant.images[0].url);
  assert.match(selected.reply, /no tiene disponibilidad confirmada/);
  assert.doesNotMatch(selected.image.caption, /Tallas disponibles/);
  const tool = createCatalogTools(port, "tenant-floes", "commerce-assistant").find(item => item.descriptor.id === CATALOG_TOOL_IDS.prepareCustomerOrder);
  await assert.rejects(() => tool.handler.execute({ productId: product.productId, variantId: variant.variantId, size: "XS", quantity: 1, customerId: "fixture-customer" }, context), /unavailable/);
  assert.equal(writes.length, 0);
});

test("herramientas rechazan cliente y tenant ajenos aunque el modelo los solicite", async () => {
  const { port, writes } = createPort();
  const tools = createCommerceTools(port, "tenant-floes", "commerce-assistant");
  for (const operation of [COMMERCE_TOOL_IDS.createOrUpdateCustomer, COMMERCE_TOOL_IDS.createOpportunity, COMMERCE_TOOL_IDS.createOrderDraft, COMMERCE_TOOL_IDS.attachPaymentProof]) {
    const tool = tools.find(item => item.descriptor.id === operation);
    await assert.rejects(() => tool.handler.execute({ customerId: "other-customer", orderId: "fixture-order", title: "test", lines: [] }, context), /outside the authorized conversation/);
  }
  const read = tools.find(item => item.descriptor.id === COMMERCE_TOOL_IDS.getProductDetails);
  await assert.rejects(() => read.handler.execute({ productId: product.productId }, { ...context, tenantId: "tenant-mg" }), /outside the authorized scope/);
  assert.equal(writes.length, 0);
});

test("estado y postventa no revelan un pedido de otro cliente", async () => {
  const { port, writes } = createPort({ async getOrderStatus() { return { orderId: "fixture-other", customerId: "other-customer", status: "delivered" }; }, async recordOrderFollowUp() { writes.push({ operation: "recordOrderFollowUp" }); } });
  const read = createCommerceTools(port, "tenant-floes", "commerce-assistant").find(item => item.descriptor.id === COMMERCE_TOOL_IDS.getOrderStatus);
  await assert.rejects(() => read.handler.execute({ orderId: "fixture-other" }, context), /outside the authorized customer conversation/);
  const follow = createCatalogTools(port, "tenant-floes", "commerce-assistant").find(item => item.descriptor.id === CATALOG_TOOL_IDS.recordOrderFollowUp);
  await assert.rejects(() => follow.handler.execute({ orderId: "fixture-other", customerId: "other-customer", outcome: "ISSUE" }, context), /outside the authorized conversation/);
  assert.equal(writes.length, 0);
});
