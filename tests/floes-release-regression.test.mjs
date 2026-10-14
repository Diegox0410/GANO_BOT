import assert from "node:assert/strict";
import test from "node:test";
import { consultCatalog, createCatalogTools, CATALOG_TOOL_IDS } from "../apps/functions/dist/commerce/catalogTools.js";
import { ChopifyHttpAdapter } from "../apps/functions/dist/commerce/chopifyHttpAdapter.js";
import { createSupervisorTools } from "../apps/functions/dist/commerce/supervisorTools.js";
import { catalogConversationCall, catalogConversationResponse, commerceImageDecision } from "../scripts/floes-catalog-conversation.mjs";
import { createLiveHandler, validateLivePayload } from "../api/live.mjs";
import { readHumanEscalation } from "../scripts/gano-hosted-runtime.mjs";

const models = ["Daniela", "María José", "Elite", "Maemi", "Esperanza", "Klit", "Florma", "Girasol", "Bruni", "Laly", "Esencial", "Mabe"];
const context = { tenantId: "tenant-floes", assistantId: "commerce-assistant", actorId: "fixture-customer", conversationId: "whatsapp-fixture-memory", requestId: "fixture-request", correlationId: "fixture-correlation", metadata: { customerId: "fixture-customer", originConversationId: "conversation_fixture_source" } };
const variant = { variantId: "fixture-daniela-blue", name: "Azul marino", color: "Azul marino", active: true, available: true, sizes: ["XS"], availableQuantity: 50, price: { amount: 39.99, currency: "USD" }, pricingStatus: "READY", images: [{ url: "https://images.example.test/daniela/azul.jpg", alt: "Daniela Azul marino" }] };
const product = { productId: "fixture-daniela", name: "Daniela", description: "Descripción procedente de fixture de contrato.", pricingStatus: "READY", price: { amount: 39.99, currency: "USD" }, available: true, variants: [variant] };
const history = selection => [{ role: "assistant", content: "Fixture", metadata: { commerceSelection: JSON.stringify(selection) } }];
const defaultPort = () => ({
  async searchProducts() { return [product]; },
  async getProductDetails() { return product; },
  async checkAvailability() { return { productId: product.productId, variantId: variant.variantId, size: "XS", available: true, availableQuantity: 2 }; },
  async createOrUpdateCustomer() { return { customerId: "fixture-customer" }; },
  async createOpportunity() { return { opportunityId: "fixture-opportunity", customerId: "fixture-customer", status: "new" }; },
  async createOrderDraft() { return { orderId: "fixture-order", customerId: "fixture-customer", status: "draft" }; },
});

test("los doce modelos se consultan sin perder el nombre tras un saludo", () => {
  for (const name of models) assert.deepEqual(catalogConversationCall(`Hola, quiero ver ${name}.`).arguments, { query: name });
});

test("la consulta general recupera los doce modelos del contrato, sin truncarlos a ocho", async () => {
  const products = models.map((name, index) => ({ ...product, productId: `fixture-${index}`, name }));
  let requestedLimit;
  let detailReads = 0;
  const port = { ...defaultPort(), async searchProducts(_context, input) { requestedLimit = input.limit; return products; }, async getProductDetails(_context, input) { detailReads += 1; return products.find(item => item.productId === input.productId); } };
  const result = await consultCatalog(port, context, { query: "" });
  assert.equal(requestedLimit, 20);
  assert.equal(result.products.length, 12);
  assert.equal(detailReads, 0);
  for (const name of models) assert.match(catalogConversationResponse(result, "Qué modelos tienen").reply, new RegExp(name));
});

test("stock agrupado o cantidad ausente no ofrecen agregar ni crean un borrador", async () => {
  let writes = 0;
  const port = { ...defaultPort(), async checkAvailability() { return { productId: product.productId, available: true }; }, async createOrUpdateCustomer() { writes += 1; return { customerId: "fixture-customer" }; } };
  const result = await consultCatalog(port, context, { productId: product.productId, color: variant.color, size: "XS" });
  const reply = catalogConversationResponse(result, "XS");
  assert.equal(reply.selection.pendingAction, undefined);
  assert.match(reply.reply, /pendiente de confirmación/);
  assert.doesNotMatch(reply.reply, /Quieres agregarlo/);
  const tool = createCatalogTools(port, context.tenantId, context.assistantId).find(item => item.descriptor.id === CATALOG_TOOL_IDS.prepareCustomerOrder);
  await assert.rejects(() => tool.handler.execute({ productId: product.productId, variantId: variant.variantId, size: "XS", quantity: 1, customerId: "fixture-customer" }, context), /unavailable/);
  assert.equal(writes, 0);
});

test("modelo informativo sin variantes utiliza su galería general sin inventar color o precio", () => {
  const model = { ...product, productId: "fixture-maemi", name: "Maemi", variants: [], price: null, pricingStatus: "PENDING", images: [{ url: "https://images.example.test/maemi/general.jpg", alt: "Maemi" }] };
  const response = catalogConversationResponse({ kind: "catalog", products: [model], selectedProduct: model }, "Quiero ver Maemi");
  assert.equal(response.image.url, model.images[0].url);
  assert.match(response.image.caption, /Fotografía general/);
  assert.match(response.reply, /precio está pendiente/);
  assert.equal(response.selection.variantId, undefined);
  assert.equal(response.selection.pendingAction, undefined);
  assert.equal(catalogConversationResponse({ kind: "catalog", products: [model], selectedProduct: model }, "Muéstrame la guía de tallas").image.alt, "Maemi");
});

test("precio inválido no permite crear cliente, oportunidad ni borrador", async () => {
  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) {
    let writes = 0;
    const port = { ...defaultPort(), async getProductDetails() { return { ...product, variants: [{ ...variant, price: { amount: invalid, currency: "USD" } }] }; }, async createOrUpdateCustomer() { writes += 1; } };
    const tool = createCatalogTools(port, context.tenantId, context.assistantId).find(item => item.descriptor.id === CATALOG_TOOL_IDS.prepareCustomerOrder);
    await assert.rejects(() => tool.handler.execute({ productId: product.productId, variantId: variant.variantId, size: "XS", quantity: 1, customerId: "fixture-customer" }, context), /price requires human/);
    assert.equal(writes, 0);
  }
});

test("el adapter enlaza borrador, comprobante y escalación al thread canónico", async () => {
  const calls = [];
  const adapter = new ChopifyHttpAdapter({ baseUrl: "https://chopify.example.test", bearerToken: "fixture-only", async fetchImpl(_url, init) { calls.push(JSON.parse(init.body)); return Response.json({ ok: true, data: {} }); } });
  const commerceContext = { ...context, originConversationId: context.metadata.originConversationId };
  await adapter.createOrderDraft(commerceContext, { customerId: "fixture-customer", lines: [] });
  await adapter.attachPaymentProof(commerceContext, { orderId: "fixture-order", customerId: "fixture-customer", externalReference: "meta-whatsapp://123456789/media/fixture" });
  await adapter.requestHumanEscalation(commerceContext, { reason: "CUSTOMER_REQUEST" });
  for (const call of calls) assert.equal(call.input.conversationId, "conversation_fixture_source");
  assert.equal(calls[1].input.customerId, "fixture-customer");
});

test("el fixture inbound real atraviesa auth/validación y conserva thread de origen", async () => {
  const body = { tenantId: "tenant-floes", channel: "WHATSAPP", providerMessageId: "wamid.fixture-new", conversationId: "conversation_fixture_source", customer: { phone: "15550001111", name: "Fixture Owner" }, text: "Hola, quiero ver el modelo Daniela." };
  const validated = validateLivePayload(body);
  assert.equal(validated.value.conversationId, body.conversationId);
  assert.equal(validateLivePayload({ ...body, conversationId: "../wrong" }).status, 400);
  const result = {};
  const handler = createLiveHandler({ environment: { GANOBOT_LIVE_BEARER_TOKEN: "fixture-only" }, runtimeFactory: async tenantId => ({ async processLiveWhatsApp(input) {
    assert.equal(tenantId, "tenant-floes");
    const call = catalogConversationCall(input.text);
    const consultation = await consultCatalog(defaultPort(), context, call.arguments);
    const response = catalogConversationResponse(consultation, input.text);
    assert.equal(response.selection.productId, product.productId);
    return { reply: response.reply, commerce: { tenantId, productId: response.selection.productId, correlationId: "fixture-correlation", conversationId: input.conversationId } };
  } }) });
  await handler({ method: "POST", headers: { authorization: "Bearer fixture-only" }, body }, { set statusCode(value) { result.status = value; }, setHeader() {}, end(value) { result.payload = JSON.parse(value); } });
  assert.equal(result.status, 200);
  assert.match(result.payload.reply, /Daniela/);
  assert.equal(result.payload.commerce.conversationId, body.conversationId);
  assert.equal(result.payload.requiresHuman, undefined);
});

test("escalación natural usa el enum real y no resuelve automáticamente la incidencia", async () => {
  const call = catalogConversationCall("Quiero hablar con una persona", history({ productId: product.productId }));
  assert.equal(call.arguments.reason, "CUSTOMER_REQUEST");
  const saved = [];
  const tool = createSupervisorTools({ async requestHumanEscalation(c, input) { saved.push({ c, input }); return { escalationId: "fixture-escalation", conversationId: "conversation_fixture_source", status: "OPEN", reason: input.reason, priority: "NORMAL" }; } }, context.tenantId, context.assistantId)[0];
  const result = await tool.handler.execute(call.arguments, context);
  assert.equal(result.status, "OPEN");
  assert.equal(saved[0].c.originConversationId, "conversation_fixture_source");
});

test("postventa de incidencia exige pedido entregado propio y pausa para revisión humana", async () => {
  const calls = [];
  const order = { orderId: "fixture-order", customerId: "fixture-customer", status: "delivered" };
  const port = { ...defaultPort(), async getOrderStatus() { return order; }, async recordOrderFollowUp(_c, input) { calls.push(input); return order; }, async requestHumanEscalation(c, input) { return { escalationId: "fixture-case", conversationId: c.conversationId, status: "OPEN", reason: input.reason, priority: "NORMAL" }; } };
  const tool = createCatalogTools(port, context.tenantId, context.assistantId).find(item => item.descriptor.id === CATALOG_TOOL_IDS.recordOrderFollowUp);
  const output = await tool.handler.execute({ orderId: "fixture-order", customerId: "fixture-customer", outcome: "ISSUE", note: "Fixture: revisar prenda" }, context);
  assert.equal(output.escalation.status, "OPEN");
  assert.equal(output.escalation.conversationId, "conversation_fixture_source");
  assert.deepEqual(readHumanEscalation([{ toolId: tool.descriptor.id, status: "completed", output }]), { requiresHuman: true, escalationReason: "COMPLAINT" });
  await assert.rejects(() => tool.handler.execute({ orderId: "fixture-order", customerId: "other-customer", outcome: "ISSUE" }, context), /outside the authorized conversation/);
  assert.equal(calls.length, 1);
});

test("memoria y deduplicación de fotografía no se mezclan con una conversación nueva", () => {
  const image = { type: "image", url: variant.images[0].url };
  const selection = { productId: product.productId, variantId: variant.variantId, color: variant.color, size: "XS", selectionVersion: "1" };
  const first = commerceImageDecision(image, selection, [], "Azul marino", { tenantId: "tenant-floes", conversationId: "fixture-a" });
  const previous = [{ ...history(selection)[0], metadata: { ...history(selection)[0].metadata, commerceMediaKey: first.key } }];
  assert.equal(commerceImageDecision(image, selection, previous, "XS", { tenantId: "tenant-floes", conversationId: "fixture-a" }).send, false);
  assert.equal(commerceImageDecision(image, selection, [], "Hola", { tenantId: "tenant-floes", conversationId: "fixture-b" }).send, true);
  assert.equal(catalogConversationCall("Hola").selection.productId, undefined);
});
