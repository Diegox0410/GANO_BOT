import test from "node:test";
import assert from "node:assert/strict";
import { consultCatalog, createCatalogTools, CATALOG_TOOL_IDS, safeCatalogImageUrl } from "../apps/functions/dist/commerce/catalogTools.js";
import { createCommerceRuntimeFromEnv } from "../apps/functions/dist/commerce/runtime.js";
import { WhatsAppChannelAdapter } from "../apps/functions/dist/channels/whatsapp.js";
import { catalogConversationCall, catalogConversationResponse } from "../scripts/floes-catalog-conversation.mjs";
import { getGanoHostedRuntime, mergeHostedCommerceMetadata } from "../scripts/gano-hosted-runtime.mjs";

const context = { tenantId: "tenant-floes", assistantId: "commerce-assistant", actorId: "customer-1", conversationId: "conversation-1", requestId: "request-1", correlationId: "correlation-1" };

test("hosted commerce runtime rejects an omitted tenant instead of defaulting to FLOES", async () => {
  await assert.rejects(getGanoHostedRuntime(), /tenant is not allowed/i);
});
const wine = { variantId: "daniela-vino", name: "Vino", color: "Vino", available: true, active: true, sizes: ["S", "M"], availableQuantity: 4, price: { amount: 37, currency: "USD" }, pricingStatus: "READY", images: [{ url: "https://floes-commerce.vercel.app/catalogo/floes/daniela/vino.jpeg", alt: "Daniela Vino" }] };
const product = { productId: "daniela", name: "Modelo Daniela", description: "Scrub con pantalón recto.", characteristics: ["Porta credencial", "Bolsillo lateral derecho"], ganoBotNotes: "Comparar con otro modelo si necesita almacenamiento; no pegar notas internas", price: { amount: 40, currency: "USD" }, pricingStatus: "READY", available: true, variants: [wine, { ...wine, variantId: "daniela-negro", color: "Negro", active: false }, { ...wine, variantId: "daniela-caqui", color: "Caqui", available: false }], sizeGuide: { measurement: "FLAT_GARMENT_CM", instructions: "Medir prenda plana", blouse: [{ size: "M", measurementsCm: { pecho: 50 } }], trousers: [{ size: "M", measurementsCm: { cadera: 52 } }] } };
function fakePort(overrides = {}) {
  return { async searchProducts() { return [product]; }, async getProductDetails() { return product; }, async checkAvailability() { return { productId: product.productId, available: true, availableQuantity: 4 }; }, async createOrUpdateCustomer() { return { customerId: "customer-1" }; }, async createOpportunity() { return { opportunityId: "opportunity-1", customerId: "customer-1", status: "new" }; }, async createOrderDraft() { return { orderId: "order-1", status: "draft", customerId: "customer-1", total: { amount: 37, currency: "USD" } }; }, ...overrides };
}
function history(selection) { return [{ role: "assistant", content: "Modelo confirmado", metadata: { commerceSelection: JSON.stringify(selection) } }]; }

test("mensaje inicial Meta y CTA storefront llegan al mismo modelo/color/talla reales", () => {
  assert.deepEqual(catalogConversationCall("Hola, quiero ver el modelo Daniela").arguments, { query: "Daniela" });
  assert.deepEqual(catalogConversationCall("Hola, estoy interesada en el Modelo Daniela color Vino talla M.").arguments, { query: "Daniela", color: "Vino", size: "M" });
  assert.deepEqual(catalogConversationCall("Hola").arguments, { query: "" });
});

test("el provider conserva identidad Live verificada para preparar el borrador", () => {
  const metadata = mergeHostedCommerceMetadata(
    { metadata: { correlationId: "whatsapp-message-1", channel: "WHATSAPP" } },
    { customerId: "customer-1", customerPhone: "15550100100", customerName: "Cliente piloto Preview" },
  );
  const call = catalogConversationCall("Lo quiero", history({ productId: "daniela", variantId: "daniela-vino", color: "Vino", size: "M" }), metadata);
  assert.deepEqual(call.arguments, { productId: "daniela", variantId: "daniela-vino", size: "M", quantity: 1, customerId: "customer-1", phone: "15550100100", name: "Cliente piloto Preview", channel: "WHATSAPP", source: "WHATSAPP" });
});

test("catálogo resuelve modelo y muestra solamente colores activos disponibles", async () => {
  const result = await consultCatalog(fakePort(), context, { query: "Daniela" });
  const response = catalogConversationResponse(result, "Quiero Daniela");
  assert.match(response.reply, /Vino/); assert.doesNotMatch(response.reply, /Negro|Caqui|pegar notas internas/);
  assert.deepEqual(response.selection, { productId: "daniela", name: "Modelo Daniela" });
});

test("selecciona el único modelo con nombre exacto cuando Chopify devuelve la lista completa", async () => {
  const maria = { ...product, productId: "tenant-floes:model:maria-jose", name: "Modelo María José" };
  const daniela = { ...product, productId: "tenant-floes:model:daniela", name: "Modelo Daniela" };
  const elite = { ...product, productId: "tenant-floes:model:elite", name: "Modelo Elite" };
  const results = [maria, daniela, elite];
  const port = fakePort({
    async searchProducts() { return results; },
    async getProductDetails(_context, { productId }) { return results.find(item => item.productId === productId); },
  });
  const result = await consultCatalog(port, context, { query: "Daniela" });
  assert.equal(result.products.length, 3);
  assert.equal(result.selectedProduct?.productId, daniela.productId);
  const response = catalogConversationResponse(result, "Quiero Daniela");
  assert.match(response.reply, /Modelo Daniela/);
  assert.match(response.reply, /Colores disponibles/);
  assert.doesNotMatch(response.reply, /Modelo María José|Modelo Elite/);
  assert.equal(response.selection.productId, daniela.productId);
});

test("selección contextual normaliza color, devuelve imagen real y precio de la variante", async () => {
  const result = await consultCatalog(fakePort(), context, { productId: "daniela", color: "VINO" });
  const response = catalogConversationResponse(result, "Vino");
  assert.equal(response.image.url, wine.images[0].url); assert.match(response.reply, /37\.00 USD/); assert.match(response.reply, /S, M/);
  const call = catalogConversationCall("Soy talla M", history(response.selection));
  assert.deepEqual(call.arguments, { productId: "daniela", color: "Vino", size: "M" });
  assert.deepEqual(catalogConversationCall("Muéstrame la guía de tallas y medidas planas", history(response.selection)).arguments, { productId: "daniela", color: "Vino" });
  for (const size of ["XS", "S", "M", "L", "XL"]) assert.deepEqual(catalogConversationCall(size, history(response.selection)).arguments, { productId: "daniela", color: "Vino", size });
  assert.match(response.image.caption, /Modelo Daniela.*Vino/);
  assert.match(response.image.caption, /37\.00 USD/);
  assert.match(response.image.caption, /Tallas disponibles: S, M/);
});

test("imagen y respuesta muestran precio regular y promoción reales", async () => {
  const promotionalWine = { ...wine, price: { amount: 34.99, currency: "USD" }, regularPrice: { amount: 39.99, currency: "USD" }, promotionalPrice: { amount: 34.99, currency: "USD" } };
  const promotionalProduct = { ...product, price: { amount: 39.99, currency: "USD" }, promotionalPrice: { amount: 34.99, currency: "USD" }, variants: [promotionalWine] };
  const result = await consultCatalog(fakePort({ async getProductDetails() { return promotionalProduct; } }), context, { productId: "daniela", color: "Vino" });
  const response = catalogConversationResponse(result, "Vino");
  assert.match(response.reply, /Precio: 39\.99 USD/);
  assert.match(response.reply, /Promoción: 34\.99 USD/);
  assert.match(response.image.caption, /Precio: 39\.99 USD/);
  assert.match(response.image.caption, /Promoción: 34\.99 USD/);
});

test("stock de talla se consulta en Chopify y nunca se sustituye por el total del color", async () => {
  const calls = [];
  const port = fakePort({ async checkAvailability(c, input) { calls.push(input); return { productId: input.productId, variantId: input.variantId, size: input.size, available: true, availableQuantity: 9 }; } });
  const result = await consultCatalog(port, context, { productId: "daniela", color: "Vino", size: "M" });
  assert.deepEqual(calls, [{ productId: "daniela", variantId: wine.variantId, size: "M", quantity: 1 }]);
  const response = catalogConversationResponse(result, "M");
  assert.match(response.reply, /Disponibilidad talla M: 9 unidades/);
  assert.doesNotMatch(response.reply, /4 unidades/);
  const unavailable = catalogConversationResponse({ ...result, availability: { ...result.availability, available: false, availableQuantity: 0 } }, "M");
  assert.match(unavailable.reply, /no tiene disponibilidad para reservar/);
  assert.doesNotMatch(unavailable.reply, /agregarlo al pedido/);
});

test("tallas disponibles usan sizeAvailability autoritativo y omiten agotadas", async () => {
  const actualStock = { ...product, variants: [{ ...wine, sku: "FLOES-DAN-11", sizes: ["XS", "S", "M", "L", "XL"], sizeAvailability: [{ size: "XS", availableQuantity: 10, available: true }, { size: "S", availableQuantity: 0, available: false }, { size: "M", availableQuantity: 9, available: true }, { size: "L", availableQuantity: 10, available: true }, { size: "XL", availableQuantity: 10, available: true }] }] };
  const result = await consultCatalog(fakePort({ async getProductDetails() { return actualStock; } }), context, { productId: "daniela", color: "Vino" });
  const response = catalogConversationResponse(result, "Vino");
  assert.match(response.reply, /Tallas disponibles: XS, M, L, XL/);
  assert.doesNotMatch(response.reply, /SKU:|FLOES-DAN-/);
  assert.doesNotMatch(response.image.caption, /SKU:|FLOES-DAN-/);
  assert.match(response.image.caption, /Tallas disponibles: XS, M, L, XL/);
  const exhausted = await consultCatalog(fakePort({ async getProductDetails() { return actualStock; } }), context, { productId: "daniela", color: "Vino", size: "S" });
  assert.equal(exhausted.selectionError, "size-unavailable");
});

test("Maria Jose and Elite colors resolve their own authoritative variant photos", async () => {
  for (const [name, productId, color] of [["Modelo María José", "maria-jose", "Palo Rosa"], ["Modelo Élite", "elite", "Lila"]]) {
    const variant = { ...wine, variantId: `${productId}-${color.toLowerCase().replaceAll(" ", "-")}`, color,
      images: [{ url: `https://storage.example.test/floes/${productId}/${color.toLowerCase().replaceAll(" ", "-")}.webp`, alt: `${name} ${color}` }] };
    const model = { ...product, productId, name, variants: [variant] };
    const result = await consultCatalog(fakePort({ async getProductDetails() { return model; } }), context, { productId, color });
    const response = catalogConversationResponse(result, color);
    assert.equal(response.image.url, variant.images[0].url);
    assert.match(response.reply, new RegExp(color));
    assert.match(response.reply, /37\.00 USD/);
  }
});

test("un color o talla inexistente jamás produce una variante o foto inventada", async () => {
  const missingColor = catalogConversationResponse(await consultCatalog(fakePort(), context, { productId: "daniela", color: "Lila" }), "Lila");
  assert.equal(missingColor.image, undefined); assert.match(missingColor.reply, /No encuentro Lila/); assert.equal(missingColor.selection.variantId, undefined);
  const missingSize = catalogConversationResponse(await consultCatalog(fakePort(), context, { productId: "daniela", color: "Vino", size: "XL" }), "Soy talla XL");
  assert.equal(missingSize.image, undefined); assert.equal(missingSize.selection.size, undefined);
});

test("talla recomendada responde progresivamente sin imprimir la tabla", async () => {
  const response = catalogConversationResponse(await consultCatalog(fakePort(), context, { productId: "daniela", color: "Vino", size: "M" }), "¿Qué talla me recomiendas?");
  assert.equal(response.reply, "📏 ¿Dudas con tu talla?\n\nDime qué talla usas normalmente o puedo ayudarte comparando las medidas de una prenda que te quede bien.\n\nSi quieres, también puedo mostrarte nuestra guía de tallas 💙");
});

test("no saber la talla pide comparar una prenda plana sin mostrar tabla completa", async () => {
  const response = catalogConversationResponse(await consultCatalog(fakePort(), context, { productId: "daniela", color: "Vino" }), "No sé mi talla");
  assert.equal(response.reply, "No necesitas saber tu talla de memoria 💙 Toma una prenda que te quede bien, extiéndela sobre una superficie plana y mide de lado a lado. ¿Prefieres comparar una blusa o un pantalón?");
});

test("si pide medidas de M, solo devuelve filas de M y explica medición plana", async () => {
  const response = catalogConversationResponse(await consultCatalog(fakePort(), context, { productId: "daniela", color: "Vino", size: "M" }), "¿Me das las medidas de la talla M?");
  assert.match(response.reply, /Blusa · talla M: pecho 50 cm/);
  assert.match(response.reply, /Pantalón · talla M: cadera 52 cm/);
  assert.match(response.reply, /sin multiplicar por dos/);
  assert.doesNotMatch(response.reply, /XS:|S:|L:|XL:|pecho 48 cm|pecho 53 cm/);
});

test("petición explícita de la guía comparte imagen móvil y caption corto", async () => {
  const response = catalogConversationResponse(await consultCatalog(fakePort(), context, { productId: "daniela", color: "Vino" }), "Muéstrame las medidas");
  assert.equal(response.image.url, "https://floes-commerce.vercel.app/images/guia-tallas-floes.png");
  assert.match(response.image.caption, /Daniela.*Vino/);
  assert.match(response.image.caption, /prenda en plano/);
  assert.doesNotMatch(response.reply, /XS:|S: pecho|M: pecho|Blusa:|Pantalón:/);
});

test("recomendación entre dos tallas utiliza medida plana documentada", async () => {
  const between = { ...product, sizeGuide: { ...product.sizeGuide, blouse: [{ size: "S", measurementsCm: { pecho: 48 } }, { size: "M", measurementsCm: { pecho: 50 } }] } };
  const response = catalogConversationResponse(await consultCatalog(fakePort({ async getProductDetails() { return between; } }), context, { productId: "daniela", color: "Vino" }), "Mi prenda plana: pecho 49 cm");
  assert.match(response.reply, /49 cm queda entre S \(48 cm\) y M \(50 cm\)/);
  const call = catalogConversationCall("Mi prenda plana: pecho 49 cm", history({ productId: "daniela", color: "Vino" }));
  assert.equal(call.arguments.productId, "daniela"); assert.equal(call.arguments.color, "Vino");
});

test("precio pendiente de una variante nunca se reemplaza por precio padre", async () => {
  const pending = { ...product, variants: [{ ...wine, pricingStatus: "PENDING", price: null }] };
  const response = catalogConversationResponse(await consultCatalog(fakePort({ async getProductDetails() { return pending; } }), context, { productId: "daniela", color: "Vino" }), "Precio");
  assert.match(response.reply, /pendiente de confirmación/); assert.doesNotMatch(response.reply, /40\.00 USD/);
});

test("consulta no sustituye imágenes ausentes por imagen de otro color", async () => {
  const noPhoto = { ...product, imageUrl: "https://storage.example.test/otro-color.jpeg", variants: [{ ...wine, images: [] }] };
  const response = catalogConversationResponse(await consultCatalog(fakePort({ async getProductDetails() { return noPhoto; } }), context, { productId: "daniela", color: "Vino" }), "Vino");
  assert.equal(response.image, undefined);
});

test("comparación usa características documentadas y notas como contexto sin exponerlas", async () => {
  const other = { ...product, productId: "elite", name: "Modelo Élite", characteristics: ["Muchos bolsillos"], ganoBotNotes: "Útil cuando necesita muchos bolsillos" };
  const response = catalogConversationResponse({ kind: "catalog", products: [product, other] }, "Quiero muchos bolsillos");
  assert.match(response.reply, /Modelo Élite/); assert.match(response.reply, /Muchos bolsillos/); assert.doesNotMatch(response.reply, /Útil cuando/);
});

test("borrador verifica precio, talla y disponibilidad antes de escrituras y conserva talla", async () => {
  const calls = [];
  const availabilityCalls = [];
  const port = fakePort({ async checkAvailability(c, input) { availabilityCalls.push(input); return { productId: input.productId, available: true, availableQuantity: 4 }; }, async createOrderDraft(c, input) { calls.push({ c, input }); return { orderId: "order-1", customerId: input.customerId, status: "draft" }; } });
  const tool = createCatalogTools(port, context.tenantId, context.assistantId).find(item => item.descriptor.id === CATALOG_TOOL_IDS.prepareCustomerOrder);
  const result = await tool.handler.execute({ productId: "daniela", variantId: wine.variantId, size: "M", quantity: 1, customerId: "customer-1" }, context);
  assert.equal(result.order.status, "draft"); assert.equal(calls[0].input.lines[0].size, "M"); assert.match(calls[0].c.idempotencyKey, /draft$/);
  assert.deepEqual(availabilityCalls, [{ productId: "daniela", variantId: wine.variantId, size: "M", quantity: 1 }]);
  await assert.rejects(() => tool.handler.execute({ productId: "daniela", variantId: wine.variantId, size: "XL", quantity: 1, customerId: "customer-1" }, context), /unavailable/);
  assert.equal(calls.length, 1);
});

test("borrador rechaza talla agotada aunque otras tallas tengan stock, antes de crear customer", async () => {
  let customerCalls = 0;
  const port = fakePort({ async checkAvailability(c, input) { assert.equal(input.size, "M"); return { productId: input.productId, size: input.size, available: false, availableQuantity: 0 }; }, async createOrUpdateCustomer() { customerCalls++; return { customerId: "customer-1" }; } });
  const tool = createCatalogTools(port, context.tenantId, context.assistantId).find(item => item.descriptor.id === CATALOG_TOOL_IDS.prepareCustomerOrder);
  await assert.rejects(() => tool.handler.execute({ productId: "daniela", variantId: wine.variantId, size: "M", quantity: 1, customerId: "customer-1" }, context), /quantity is unavailable/);
  assert.equal(customerCalls, 0);
});

test("tools de catálogo y canal rechazan cruces de tenant", async () => {
  const tool = createCatalogTools(fakePort(), context.tenantId, context.assistantId)[0];
  await assert.rejects(() => tool.handler.execute({ productId: "daniela" }, { ...context, tenantId: "tenant-mg" }), /authorized scope/);
  const adapter = new WhatsAppChannelAdapter(context.tenantId, { async send() { return { messageId: "message-1" }; } });
  assert.throws(() => adapter.sendText({ tenantId: "tenant-mg", recipient: "593999999999", correlationId: "correlation-1" }, "Hola"), /scope/);
});

test("WhatsApp adapter envía texto, imagen y caption por transport inyectable", async () => {
  const messages = [];
  const adapter = new WhatsAppChannelAdapter(context.tenantId, { async send(c, message) { messages.push({ c, message }); return { messageId: `message-${messages.length}` }; } });
  const c = { tenantId: context.tenantId, recipient: "593999999999", correlationId: "correlation-1" };
  await adapter.sendText(c, "Hola"); await adapter.sendImage(c, wine.images[0].url); await adapter.sendImageWithCaption(c, wine.images[0].url, "Modelo Daniela · Vino");
  assert.deepEqual(messages.map(item => item.message.type), ["text", "image", "image"]); assert.equal(messages[2].message.caption, "Modelo Daniela · Vino"); assert.equal(messages[2].message.url, "https://floes-commerce.vercel.app/catalogo/floes/daniela/vino.jpeg");
  assert.throws(() => adapter.sendImage(c, "C:\\Users\\User\\vino.jpeg"), /HTTPS/);
  for (const url of ["http://public.example/image.jpg", "https://localhost/a.jpg", "https://127.0.0.1/a.jpg", "https://u:p@public.example/a.jpg"]) assert.equal(safeCatalogImageUrl(url), undefined);
});

test("tools de catálogo se activan por defecto solo para FLOES y admiten desactivación explícita", () => {
  const env = { CHOPIFY_COMMERCE_BASE_URL: "https://chopify.example.test", CHOPIFY_COMMERCE_API_TOKEN: "test", FLOES_CATALOG_V2: "true" };
  const floes = createCommerceRuntimeFromEnv("tenant-floes", env); const mg = createCommerceRuntimeFromEnv("tenant-mg", env);
  assert.equal(floes.tools.length, 14); assert.equal(mg.tools.length, 10);
  assert.ok(floes.tools.every(item => !/approvePayment|rejectPayment|markOrder/.test(item.descriptor.id)));
  assert.equal(createCommerceRuntimeFromEnv("tenant-floes", { ...env, FLOES_CATALOG_V2: undefined }).tools.length, 14);
  assert.equal(createCommerceRuntimeFromEnv("tenant-floes", { ...env, FLOES_CATALOG_V2: "false" }).tools.length, 10);
});

test("cambio de modelo y de color limpia selección obsoleta y los colores ambiguos preguntan", () => {
  const selected = { productId: "daniela", name: "Daniela", variantId: "daniela-vino", color: "Vino", size: "M" };
  assert.deepEqual(catalogConversationCall("Mejor Elite", history(selected)).arguments, { query: "Elite" });
  assert.deepEqual(catalogConversationCall("Mejor negro", history(selected)).arguments, { productId: "daniela", color: "Negro", size: "M" });
  assert.deepEqual(catalogConversationCall("Quiero azul", history(selected)).arguments, { productId: "daniela", size: "M" });
  assert.deepEqual(catalogConversationCall("Danela").arguments, { query: "Daniela" });
  assert.deepEqual(catalogConversationCall("vinno", history(selected)).arguments, { productId: "daniela", color: "Vino", size: "M" });
  assert.deepEqual(catalogConversationCall("Qué características tiene?", history(selected)).arguments, { productId: "daniela", color: "Vino", size: "M" });
  assert.deepEqual(catalogConversationCall("Qué talla me recomiendas?", history(selected)).arguments, { productId: "daniela", color: "Vino", size: "M" });
  assert.deepEqual(catalogConversationCall("Soy M", history({ productId: "daniela", name: "Daniela", color: "Vino", variantId: "daniela-vino" })).arguments, { productId: "daniela", color: "Vino", size: "M" });
  assert.deepEqual(catalogConversationCall("Talla extra small", history(selected)).arguments, { productId: "daniela", color: "Vino", size: "XS" });
});

test("la respuesta a azul ambiguo ofrece solo los azules reales y pide elegir", () => {
  const blueProduct = { ...product, variants: [
    { ...wine, color: "Azul marino" },
    { ...wine, variantId: "daniela-blue-electric", color: "Azul Electrico" },
    { ...wine, variantId: "daniela-celeste", color: "Celeste" },
    { ...wine, variantId: "daniela-negro-real", color: "Negro" },
  ] };
  const response = catalogConversationResponse({ kind: "catalog", products: [blueProduct], selectedProduct: blueProduct }, "Quiero azul");
  assert.match(response.reply, /Azul marino/);
  assert.match(response.reply, /Azul Electrico/);
  assert.match(response.reply, /Celeste/);
  assert.doesNotMatch(response.reply, /Negro/);
  assert.match(response.reply, /¿Cuál buscas\?/);
  assert.deepEqual(catalogConversationCall("Quiero azul").arguments, { query: "" });
  const noModel = catalogConversationResponse({ kind: "catalog", products: [blueProduct] }, "Quiero azul");
  assert.match(noModel.reply, /Azul marino/);
  assert.match(noModel.reply, /¿Cuál prefieres y para qué modelo\?/);
});

test("talla antes de color queda como preferencia y se valida al elegir variante", async () => {
  const response = catalogConversationResponse(await consultCatalog(fakePort(), context, { productId: "daniela", size: "M" }), "Soy talla M");
  assert.equal(response.selection.size, "M"); assert.equal(response.selection.variantId, undefined);
  assert.deepEqual(catalogConversationCall("Vino", history(response.selection)).arguments, { productId: "daniela", color: "Vino", size: "M" });
});

test("elegir talla M no repite la guía ni vuelve a preguntar la talla", async () => {
  const result = await consultCatalog(fakePort(), context, { productId: "daniela", color: "Vino", size: "M" });
  const response = catalogConversationResponse(result, "Talla M");
  assert.match(response.reply, /Seleccionaste M/);
  assert.match(response.reply, /¿Quieres agregarlo al pedido\?/);
  assert.doesNotMatch(response.reply, /¿Qué talla te interesa revisar\?/);
});

test("colores con SKUs por talla agrupan medidas y resuelven SKU exacto", async () => {
  const perSize = { ...product, variants: [{ ...wine, variantId: "wine-s", sizes: undefined, size: "S" }, { ...wine, variantId: "wine-m", sizes: undefined, size: "M" }] };
  const port = fakePort({ async getProductDetails() { return perSize; } });
  const color = await consultCatalog(port, context, { productId: "daniela", color: "Vino" });
  assert.deepEqual(color.selectedVariant.sizes, ["S", "M"]);
  assert.equal((await consultCatalog(port, context, { productId: "daniela", color: "Vino", size: "M" })).selectedVariant.variantId, "wine-m");
});

test("entrega usa datos existentes y pide únicamente los campos faltantes", async () => {
  const saved = [];
  const snapshot = { orderId: "order-1", customerId: "customer-1", status: "ready-for-dispatch", deliveryAddress: { name: "Ana", phone: "593999999999", city: "Quito" } };
  const port = fakePort({ async getOrderStatus() { return snapshot; }, async updateOrderDelivery(c, input) { saved.push(input); return { ...snapshot, ...input }; } });
  const tool = createCatalogTools(port, context.tenantId, context.assistantId).find(item => item.descriptor.id === CATALOG_TOOL_IDS.updateOrderDelivery);
  const result = await tool.handler.execute({ orderId: "order-1", customerId: "customer-1", deliveryMode: "SERVIENTREGA" }, context);
  assert.deepEqual(result.missingFields, ["province", "address"]); assert.equal(saved.length, 0);
  const response = catalogConversationResponse(result, "Servientrega", { productId: "daniela", orderId: "order-1" });
  assert.doesNotMatch(response.reply, /falta confirmar: nombre|teléfono|ciudad/);
  const call = catalogConversationCall("Provincia: Pichincha, Dirección: Calle Real 42", history(response.selection));
  const completed = await tool.handler.execute(call.arguments, context);
  assert.equal(completed.kind, "delivery-updated"); assert.equal(saved[0].deliveryAddress.city, "Quito"); assert.equal(saved[0].deliveryAddress.address, "Calle Real 42");
  await assert.rejects(() => tool.handler.execute({ orderId: "order-1", customerId: "customer-other", deliveryMode: "PICKUP" }, context), /belong/);
});

test("postventa solo registra sobre pedido entregado del propio cliente", async () => {
  const saved = [];
  const snapshot = { orderId: "order-1", customerId: "customer-1", status: "delivered", exchangePolicy: { allowed: true, conditions: "Consultar FLOES antes de enviar una prenda." } };
  const port = fakePort({ async getOrderStatus() { return snapshot; }, async recordOrderFollowUp(c, input) { saved.push(input); return snapshot; } });
  const tool = createCatalogTools(port, context.tenantId, context.assistantId).find(item => item.descriptor.id === CATALOG_TOOL_IDS.recordOrderFollowUp);
  const call = catalogConversationCall("Ya recibí mi pedido y estoy contenta", history({ productId: "daniela", orderId: "order-1", orderStatus: "delivered", customerId: "customer-1" }));
  assert.equal(call.name, CATALOG_TOOL_IDS.recordOrderFollowUp);
  assert.equal(call.arguments.outcome, "SATISFIED");
  const response = catalogConversationResponse(await tool.handler.execute(call.arguments, context), "Contenta", { productId: "daniela", orderId: "order-1" });
  assert.match(response.reply, /Registramos tu seguimiento/); assert.equal(saved.length, 1);
  await assert.rejects(() => tool.handler.execute({ ...call.arguments, customerId: "other" }, context), /delivered order/);
});

test("flujo piloto conserva modelo, color, talla, draft, comprobante y estados Owner", async () => {
  let selection = catalogConversationResponse(await consultCatalog(fakePort(), context, { query: "Daniela" }), "Quiero Daniela").selection;
  assert.equal(catalogConversationCall("Vino", history(selection)).arguments.color, "Vino");
  selection = catalogConversationResponse(await consultCatalog(fakePort(), context, { productId: "daniela", color: "Vino", size: "M" }), "Soy talla M", selection).selection;
  const call = catalogConversationCall("Lo quiero", history(selection), { customerId: "customer-1" });
  assert.equal(call.name, CATALOG_TOOL_IDS.prepareCustomerOrder);
  const tool = createCatalogTools(fakePort(), context.tenantId, context.assistantId).find(item => item.descriptor.id === call.name);
  const draft = catalogConversationResponse(await tool.handler.execute(call.arguments, context), "Lo quiero", selection); selection = draft.selection;
  assert.equal(selection.orderId, "order-1"); assert.match(draft.reply, /borrador/);
  const proofCall = catalogConversationCall("Comprobante", history(selection), { paymentProofUrl: "https://storage.example.test/proof.jpg" });
  assert.equal(proofCall.name, "commerce.attachPaymentProof");
  assert.equal(catalogConversationCall("Ya pagué, aquí está el comprobante", history(selection), { paymentProofUrl: "https://storage.example.test/proof.jpg" }).name, "commerce.attachPaymentProof");
  assert.notEqual(catalogConversationCall("Me gusta esta foto", history(selection), { paymentProofReference: "meta-whatsapp://123456789/media/987654321" }).name, "commerce.attachPaymentProof");
  assert.deepEqual(catalogConversationCall("Envío mi comprobante de pago", history(selection), { paymentProofReference: "meta-whatsapp://123456789/media/987654321" }).arguments, { orderId: "order-1", externalReference: "meta-whatsapp://123456789/media/987654321" });
  const proof = catalogConversationResponse({ proofId: "proof-1", orderId: "order-1", status: "pending_review" }, "Comprobante", selection);
  assert.match(proof.reply, /pendiente de revisión/);
  for (const status of ["preparing", "ready-for-dispatch", "dispatched", "delivered"]) {
    const response = catalogConversationResponse({ orderId: "order-1", status, paymentStatus: "approved", trackingCode: "tracking-123" }, "Estado", selection);
    assert.ok(response.reply.length > 15); assert.equal(response.selection.orderId, "order-1");
  }
});
