import test from "node:test";
import assert from "node:assert/strict";
import { consultCatalog, createCatalogTools, CATALOG_TOOL_IDS, safeCatalogImageUrl } from "../apps/functions/dist/commerce/catalogTools.js";
import { createCommerceRuntimeFromEnv } from "../apps/functions/dist/commerce/runtime.js";
import { WhatsAppChannelAdapter } from "../apps/functions/dist/channels/whatsapp.js";
import { catalogConversationCall, catalogConversationResponse, commerceImageDecision } from "../scripts/floes-catalog-conversation.mjs";
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

function persistedAssistant(response, mediaKey) {
  return { role: "assistant", content: response.reply, metadata: { commerceSelection: JSON.stringify(response.selection), ...(mediaKey ? { commerceMediaKey: mediaKey } : {}) } };
}

test("mensaje inicial Meta y CTA storefront llegan al mismo modelo/color/talla reales", () => {
  assert.deepEqual(catalogConversationCall("Hola, quiero ver el modelo Daniela").arguments, { query: "Daniela" });
  assert.deepEqual(catalogConversationCall("Hola, estoy interesada en el Modelo Daniela color Vino talla M.").arguments, { query: "Daniela", color: "Vino", size: "M" });
  const welcome = catalogConversationCall("Hola, FLOES.ec. Visité su tienda online y quisiera información sobre sus productos. ¿Me pueden ayudar?");
  assert.equal(welcome.kind, "reply");
  assert.match(welcome.reply, /Bienvenida a FLOES/);
  assert.deepEqual(catalogConversationCall("¿Qué productos venden?").arguments, { query: "" });
  assert.deepEqual(catalogConversationCall("Hola, quiero Daniela blanco XS.").arguments, { query: "Daniela", color: "Blanco", size: "XS" });
});

test("una consulta por color sin modelo busca modelos reales que ofrecen ese color", async () => {
  const white = { ...wine, variantId: "daniela-blanco", color: "Blanco", sizes: ["XS", "S"] };
  const daniela = { ...product, variants: [white] };
  let searched = "";
  const port = fakePort({ async searchProducts(_context, input) { searched = input.query; return [{ productId: daniela.productId, name: daniela.name }]; }, async getProductDetails() { return daniela; } });
  const call = catalogConversationCall("Quiero ver el uniforme blanco.");
  assert.deepEqual(call.arguments, { query: "", color: "Blanco" });
  const response = catalogConversationResponse(await consultCatalog(port, context, call.arguments), "Quiero ver el uniforme blanco.");
  assert.equal(searched, "Blanco");
  assert.equal(response.image.url, white.images[0].url);
  assert.match(response.reply, /Modelo Daniela en Blanco/);
});

test("recupera una selección tras fallo comercial y evita reiniciar el catálogo", () => {
  const prior = { productId: "daniela", name: "Modelo Daniela", color: "Blanco", variantId: "daniela-blanco", size: "XS", pendingAction: "add_to_order", selectionVersion: "2", availableColors: '["Blanco","Vino"]' };
  for (const failed of [{ status: "failed", error: { code: "UPSTREAM_TIMEOUT" } }, { code: "UPSTREAM_TIMEOUT", message: "internal endpoint detail" }, { kind: "catalog", products: [] }]) {
    const response = catalogConversationResponse(failed, "En talla XS", prior);
    assert.equal(response.selection.productId, prior.productId);
    assert.equal(response.selection.color, prior.color);
    assert.equal(response.selection.size, prior.size);
    assert.equal(response.selection.pendingAction, prior.pendingAction);
    assert.doesNotMatch(response.reply, /trece|colores disponibles/i);
    assert.doesNotMatch(response.reply, /internal endpoint detail/);
  }
});

test("Daniela → Blanco → En talla XS/XS conserva contexto y no repite descripción ni imagen", async () => {
  const white = { ...wine, variantId: "daniela-blanco", color: "Blanco", sizes: ["XS", "S", "M"] };
  const daniela = { ...product, variants: [white] };
  const port = fakePort({ async searchProducts() { return [daniela]; }, async getProductDetails() { return daniela; } });
  const initial = catalogConversationResponse(await consultCatalog(port, context, { query: "Daniela" }), "Daniela");
  const colorCall = catalogConversationCall("Color blanco.", [persistedAssistant(initial)]);
  assert.deepEqual(colorCall.arguments, { productId: "daniela", color: "Blanco" });
  const colorResult = await consultCatalog(port, context, colorCall.arguments);
  const colorResponse = catalogConversationResponse(colorResult, "Color blanco", initial.selection);
  assert.match(colorResponse.reply, /Modelo Daniela en Blanco/);
  assert.doesNotMatch(colorResponse.reply, /Scrub con pantalón recto|Colores disponibles/);
  assert.equal(colorResponse.image.url, white.images[0].url);
  const sizeCall = catalogConversationCall("En talla XS.", [persistedAssistant(colorResponse)]);
  assert.deepEqual(sizeCall.arguments, { productId: "daniela", color: "Blanco", size: "XS" });
  const sizeResult = await consultCatalog(port, context, sizeCall.arguments);
  const sizeResponse = catalogConversationResponse(sizeResult, "En talla XS", colorResponse.selection);
  assert.match(sizeResponse.reply, /talla XS/);
  assert.doesNotMatch(sizeResponse.reply, /Scrub con pantalón recto|Colores disponibles|Tallas disponibles/);
  const sent = commerceImageDecision(colorResponse.image, colorResponse.selection, [], "Color blanco", { tenantId: "tenant-floes", conversationId: "conversation-1" });
  const decision = commerceImageDecision(colorResponse.image, colorResponse.selection, [persistedAssistant(colorResponse, sent.key)], "En talla XS", { tenantId: "tenant-floes", conversationId: "conversation-1" });
  assert.equal(decision.send, false);
  assert.deepEqual(catalogConversationCall("XS", [persistedAssistant(sizeResponse)]).arguments, { productId: "daniela", color: "Blanco", size: "XS" });
});

test("el provider conserva identidad Live verificada para preparar el borrador", () => {
  const metadata = mergeHostedCommerceMetadata(
    { metadata: { correlationId: "whatsapp-message-1", channel: "WHATSAPP" } },
    { customerId: "customer-1", customerPhone: "15550100100", customerName: "Cliente piloto Preview" },
  );
  const call = catalogConversationCall("Lo quiero", history({ productId: "daniela", variantId: "daniela-vino", color: "Vino", size: "M" }), metadata);
  assert.deepEqual(call.arguments, { productId: "daniela", variantId: "daniela-vino", size: "M", quantity: 1, customerId: "customer-1", phone: "15550100100", name: "Cliente piloto Preview", channel: "WHATSAPP", source: "WHATSAPP" });
});

test("catálogo conserva colores activos documentados sin prometer stock", async () => {
  const result = await consultCatalog(fakePort(), context, { query: "Daniela" });
  const response = catalogConversationResponse(result, "Quiero Daniela");
  assert.match(response.reply, /Vino/); assert.doesNotMatch(response.reply, /Negro|pegar notas internas/); assert.match(response.reply, /Caqui/);
  assert.deepEqual(response.selection, { productId: "daniela", name: "Modelo Daniela", selectionVersion: "1", availableColors: '["Vino","Caqui"]' });
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
  assert.match(response.reply, /Colores del catálogo/);
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
  assert.match(response.image.caption, /Tallas del modelo; disponibilidad por confirmar: S, M/);
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
  assert.match(response.reply, /Tallas con stock confirmado: XS, M, L, XL/);
  assert.doesNotMatch(response.reply, /SKU:|FLOES-DAN-/);
  assert.doesNotMatch(response.image.caption, /SKU:|FLOES-DAN-/);
  assert.match(response.image.caption, /Tallas con stock confirmado: XS, M, L, XL/);
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
  const sizeResponse = catalogConversationResponse(await consultCatalog(fakePort({ async getProductDetails() { return pending; } }), context, { productId: "daniela", color: "Vino", size: "M" }), "M");
  assert.notEqual(sizeResponse.selection.pendingAction, "add_to_order");
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
  assert.deepEqual(catalogConversationCall("Envío mi comprobante de pago", history(selection), { paymentProofReference: "meta-whatsapp://123456789/media/987654321" }).arguments, { orderId: "order-1", customerId: "customer-1", externalReference: "meta-whatsapp://123456789/media/987654321" });
  const proof = catalogConversationResponse({ proofId: "proof-1", orderId: "order-1", status: "pending_review" }, "Comprobante", selection);
  assert.match(proof.reply, /pendiente de revisión/);
  for (const status of ["preparing", "ready-for-dispatch", "dispatched", "delivered"]) {
    const response = catalogConversationResponse({ orderId: "order-1", status, paymentStatus: "approved", trackingCode: "tracking-123" }, "Estado", selection);
    assert.ok(response.reply.length > 15); assert.equal(response.selection.orderId, "order-1");
  }
});

test("Daniela → Blanco → XS → Sí conserva contexto en carrito y prepara borrador validado al finalizar", async () => {
  let draftWrites = 0;
  const white = { ...wine, variantId: "daniela-blanco", color: "Blanco", sizes: ["XS", "S", "M"], images: [{ url: "https://storage.example.test/daniela/blanco.jpg", alt: "Daniela Blanco" }] };
  const whiteProduct = { ...product, variants: [white] };
  const port = fakePort({
    async getProductDetails() { return whiteProduct; },
    async createOrderDraft(c, input) { draftWrites += 1; return { orderId: "draft-fixture-1", status: "draft", customerId: input.customerId, total: { amount: 37, currency: "USD" } }; },
  });
  const customerContext = { ...context, actorId: "customer-fixture" };

  const modelResult = await consultCatalog(port, customerContext, { query: "Daniela" });
  const modelReply = catalogConversationResponse(modelResult, "Quiero ver Daniela");
  let transcript = [persistedAssistant(modelReply)];
  assert.equal(modelReply.selection.name, "Modelo Daniela");

  const colorCall = catalogConversationCall("Blanco", transcript);
  assert.deepEqual(colorCall.arguments, { productId: "daniela", color: "Blanco" });
  const colorReply = catalogConversationResponse(await consultCatalog(port, customerContext, colorCall.arguments), "Blanco", modelReply.selection);
  const firstImage = commerceImageDecision(colorReply.image, colorReply.selection, transcript, "Blanco");
  assert.equal(firstImage.send, true);
  transcript.push(persistedAssistant(colorReply, firstImage.key));

  const sizeCall = catalogConversationCall("XS", transcript);
  assert.deepEqual(sizeCall.arguments, { productId: "daniela", color: "Blanco", size: "XS" });
  const sizeReply = catalogConversationResponse(await consultCatalog(port, customerContext, sizeCall.arguments), "XS", colorReply.selection);
  assert.equal(sizeReply.selection.pendingAction, "add_to_order");
  assert.match(sizeReply.reply, /Perfecto, talla XS/);
  assert.doesNotMatch(sizeReply.reply, /Scrub con pantalón recto|Precio:|Promoción:|Tallas disponibles/);
  const repeatImage = commerceImageDecision(sizeReply.image, sizeReply.selection, transcript, "XS");
  assert.equal(repeatImage.send, false);
  assert.match(sizeReply.reply, /¿Quieres agregarlo al pedido\?/);
  transcript.push(persistedAssistant(sizeReply, repeatImage.key));

  const confirmation = catalogConversationCall("Sí", transcript, { customerId: "customer-fixture", customerPhone: "15550001111" });
  assert.equal(confirmation.kind, "reply");
  assert.match(confirmation.reply, /tengo anotado Modelo Daniela.*Blanco.*XS/);
  assert.doesNotMatch(confirmation.reply, /añadí|agregué/i);
  assert.equal(draftWrites, 0);
  transcript.push(persistedAssistant(confirmation));
  const finalize = catalogConversationCall("No, gracias", transcript, { customerId: "customer-fixture", customerPhone: "15550001111" });
  assert.equal(finalize.name, CATALOG_TOOL_IDS.prepareCustomerOrder);
  assert.deepEqual(finalize.arguments, { productId: "daniela", variantId: "daniela-blanco", size: "XS", quantity: 1, items: [{ productId: "daniela", variantId: "daniela-blanco", size: "XS", color: "Blanco", name: "Modelo Daniela", quantity: 1 }], customerId: "customer-fixture", phone: "15550001111", channel: "WHATSAPP", source: "WHATSAPP" });
  const tool = createCatalogTools(port, customerContext.tenantId, customerContext.assistantId).find(item => item.descriptor.id === finalize.name);
  const orderReply = catalogConversationResponse(await tool.handler.execute(finalize.arguments, customerContext), "No, gracias", confirmation.selection);
  assert.equal(draftWrites, 1);
  assert.equal(orderReply.selection.pendingAction, "");
  assert.match(orderReply.reply, /borrador/);
});

test("un No contextual cancela agregar sin consultar variante ni crear borrador", () => {
  const transcript = history({ productId: "daniela", name: "Daniela", color: "Blanco", variantId: "daniela-blanco", size: "XS", quantity: "1", pendingAction: "add_to_order", selectionVersion: "2" });
  const result = catalogConversationCall("No, gracias", transcript);
  assert.equal(result.kind, "reply");
  assert.match(result.reply, /No lo agrego/);
  assert.equal(result.selection.pendingAction, "");
  assert.equal(catalogConversationCall("Sí", [persistedAssistant(result)]).kind, "reply");
});

test("borrador de varias prendas revalida cada variante y stock antes de escribir", async () => {
  const white = { ...wine, variantId: "daniela-blanco", color: "Blanco", sizes: ["XS", "S"] };
  const black = { ...wine, variantId: "daniela-negro-activo", color: "Negro", sizes: ["M", "L"] };
  const multiProduct = { ...product, variants: [white, black] };
  const checked = [];
  const saved = [];
  const port = fakePort({
    async getProductDetails() { return multiProduct; },
    async checkAvailability(_context, input) { checked.push(input); return { available: true, availableQuantity: 3 }; },
    async createOrderDraft(_context, input) { saved.push(input); return { orderId: "multi-draft-fixture", status: "draft", customerId: input.customerId }; },
  });
  const tool = createCatalogTools(port, context.tenantId, context.assistantId).find(item => item.descriptor.id === CATALOG_TOOL_IDS.prepareCustomerOrder);
  const items = [
    { productId: "daniela", variantId: "daniela-blanco", size: "XS", quantity: 1 },
    { productId: "daniela", variantId: "daniela-negro-activo", size: "M", quantity: 2 },
  ];
  const result = await tool.handler.execute({ productId: items[0].productId, variantId: items[0].variantId, size: items[0].size, quantity: items[0].quantity, items, customerId: "customer-fixture" }, context);
  assert.equal(checked.length, 2);
  assert.deepEqual(saved[0].lines, items);
  assert.equal(result.items.length, 2);
  assert.equal(result.order.orderId, "multi-draft-fixture");
});

test("si una línea del carrito pierde stock, no crea customer, oportunidad ni borrador", async () => {
  let customerWrites = 0;
  let opportunityWrites = 0;
  let draftWrites = 0;
  const white = { ...wine, variantId: "daniela-blanco", color: "Blanco", sizes: ["XS"] };
  const black = { ...wine, variantId: "daniela-negro-activo", color: "Negro", sizes: ["M"] };
  const port = fakePort({
    async getProductDetails() { return { ...product, variants: [white, black] }; },
    async checkAvailability(_context, input) { return { available: input.variantId !== "daniela-negro-activo", availableQuantity: input.variantId === "daniela-negro-activo" ? 0 : 2 }; },
    async createOrUpdateCustomer() { customerWrites += 1; return { customerId: "customer-fixture" }; },
    async createOpportunity() { opportunityWrites += 1; return { opportunityId: "opp-fixture", customerId: "customer-fixture", status: "new" }; },
    async createOrderDraft() { draftWrites += 1; return { orderId: "should-not-exist", status: "draft", customerId: "customer-fixture" }; },
  });
  const tool = createCatalogTools(port, context.tenantId, context.assistantId).find(item => item.descriptor.id === CATALOG_TOOL_IDS.prepareCustomerOrder);
  const items = [{ productId: "daniela", variantId: "daniela-blanco", size: "XS", quantity: 1 }, { productId: "daniela", variantId: "daniela-negro-activo", size: "M", quantity: 1 }];
  await assert.rejects(() => tool.handler.execute({ ...items[0], items, customerId: "customer-fixture" }, context), /unavailable/);
  assert.equal(customerWrites + opportunityWrites + draftWrites, 0);
});

test("el carrito persistido admite una segunda prenda y finaliza con ambas líneas", async () => {
  const firstSelection = { productId: "daniela", name: "Modelo Daniela", color: "Blanco", variantId: "daniela-blanco", size: "XS", quantity: "1", pendingAction: "add_to_order", selectionVersion: "2" };
  const addFirst = catalogConversationCall("Sí", history(firstSelection));
  let transcript = [persistedAssistant(addFirst)];
  const askAnother = catalogConversationCall("Sí", transcript);
  assert.match(askAnother.reply, /otro modelo/);
  transcript = [persistedAssistant(askAnother)];

  const mariaVariant = { ...wine, variantId: "maria-palo-rosa", color: "Palo Rosa", sizes: ["M", "L"] };
  const mariaProduct = { ...product, productId: "maria-jose", name: "Modelo María José", variants: [mariaVariant] };
  const mariaPort = fakePort({
    async searchProducts() { return [mariaProduct]; },
    async getProductDetails(_context, { productId }) { return productId === "maria-jose" ? mariaProduct : product; },
  });
  const modelCall = catalogConversationCall("Quiero ver María José", transcript);
  assert.equal(modelCall.arguments.query, "María José");
  const modelReply = catalogConversationResponse(await consultCatalog(mariaPort, context, modelCall.arguments), "Quiero ver María José", askAnother.selection);
  assert.equal(JSON.parse(modelReply.selection.basketItems).length, 1);
  transcript = [persistedAssistant(modelReply)];

  const colorCall = catalogConversationCall("Palo Rosa", transcript);
  const colorReply = catalogConversationResponse(await consultCatalog(mariaPort, context, colorCall.arguments), "Palo Rosa", modelReply.selection);
  transcript = [persistedAssistant(colorReply)];
  const sizeCall = catalogConversationCall("M", transcript);
  const sizeReply = catalogConversationResponse(await consultCatalog(mariaPort, context, sizeCall.arguments), "M", colorReply.selection);
  transcript = [persistedAssistant(sizeReply)];
  const addSecond = catalogConversationCall("Sí", transcript);
  assert.equal(JSON.parse(addSecond.selection.basketItems).length, 2);
  transcript = [persistedAssistant(addSecond)];
  const finalize = catalogConversationCall("No, gracias", transcript, { customerId: "customer-fixture" });
  assert.equal(finalize.name, CATALOG_TOOL_IDS.prepareCustomerOrder);
  assert.equal(finalize.arguments.items.length, 2);
  assert.deepEqual(finalize.arguments.items.map(item => [item.name, item.color, item.size]), [["Modelo Daniela", "Blanco", "XS"], ["Modelo María José", "Palo Rosa", "M"]]);
});

test("un afirmativo fuera de confirmación no se interpreta como color o talla", () => {
  const result = catalogConversationCall("Sí", history({ productId: "daniela", name: "Daniela", color: "Blanco", variantId: "daniela-blanco", size: "XS" }));
  assert.equal(result.kind, "reply");
  assert.doesNotMatch(JSON.stringify(result), /consultCatalog|prepareCustomerOrder/);
});

test("la imagen se envía una vez por selección y vuelve a enviarse al cambiarla o pedirla", () => {
  const image = { type: "image", url: "https://storage.example.test/daniela/blanco.jpg" };
  const selection = { productId: "daniela", color: "Blanco", selectionVersion: "3" };
  const scope = { tenantId: "tenant-floes", conversationId: "conversation-1" };
  const sent = commerceImageDecision(image, selection, [], "Blanco", scope);
  assert.equal(sent.send, true);
  const transcript = [{ role: "assistant", metadata: { commerceMediaKey: sent.key } }];
  assert.equal(commerceImageDecision(image, selection, transcript, "XS", scope).send, false);
  assert.equal(commerceImageDecision(image, selection, transcript, "¿Me mandas la foto otra vez?", scope).send, true);
  assert.equal(commerceImageDecision(image, { ...selection, selectionVersion: "4" }, transcript, "Ahora sí", scope).send, true);
  assert.equal(commerceImageDecision(image, selection, transcript, "XS", { tenantId: "tenant-other", conversationId: "conversation-1" }).send, true);
  assert.equal(commerceImageDecision(image, selection, transcript, "XS", { tenantId: "tenant-floes", conversationId: "conversation-2" }).send, true);
});
