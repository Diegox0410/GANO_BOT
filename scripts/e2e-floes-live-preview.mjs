import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createChopifyHttpAdapterFromEnv } from "../apps/functions/dist/commerce/chopifyHttpAdapter.js";

const { values } = parseArgs({ options: {
  "preview-url": { type: "string" }, "customer-phone": { type: "string" },
  "run-id": { type: "string" }, "create-order": { type: "boolean", default: false },
  "expected-stock": { type: "string" },
  "attach-test-proof": { type: "boolean", default: false }, "report-path": { type: "string" },
} });
const url = new URL(values["preview-url"] ?? "");
assert.equal(url.protocol, "https:", "Preview URL must use HTTPS.");
assert.match(url.hostname, /^gano-bot(?:-web)?-[a-z0-9-]+\.vercel\.app$/, "Use an immutable GanoBot Preview deployment URL.");
const phone = values["customer-phone"]?.replace(/\D/g, "");
assert.match(phone ?? "", /^\d{8,15}$/, "Provide a controlled Preview customer phone.");
const runId = values["run-id"];
assert.match(runId ?? "", /^[A-Za-z0-9_-]{1,80}$/, "Provide a stable run ID to preserve request idempotency.");
const bearer = process.env.GANOBOT_LIVE_BEARER_TOKEN?.trim();
assert.ok(bearer, "GANOBOT_LIVE_BEARER_TOKEN is required.");
const transcript = [];
const commerceUrl = new URL(process.env.CHOPIFY_COMMERCE_BASE_URL ?? "");
assert.equal(commerceUrl.protocol, "https:");
assert.match(commerceUrl.hostname, /^chopify-[a-z0-9-]+\.vercel\.app$/, "Commerce must use an immutable Chopify Preview URL.");
const port = createChopifyHttpAdapterFromEnv();
let commerce;
async function send(step, text) {
  const response = await fetch(new URL("/api/live", url), {
    method: "POST", headers: {
      authorization: `Bearer ${bearer}`, "content-type": "application/json",
      ...(process.env.GANOBOT_VERCEL_PROTECTION_BYPASS_SECRET ? { "x-vercel-protection-bypass": process.env.GANOBOT_VERCEL_PROTECTION_BYPASS_SECRET } : {}),
    },
    body: JSON.stringify({ tenantId: "tenant-floes", channel: "WHATSAPP", providerMessageId: `preview-${runId}-${step}`, customer: { phone, name: "Cliente piloto Preview" }, text }),
    signal: AbortSignal.timeout(90_000),
  });
  assert.equal(response.status, 200, `Preview live step ${step} returned HTTP ${response.status}.`);
  const payload = await response.json();
  assert.equal(typeof payload.reply, "string");
  if (payload.commerce) commerce = payload.commerce;
  transcript.push({ step, text, reply: payload.reply, ...(payload.messages ? { messages: payload.messages } : {}) });
  return payload;
}

const model = await send("model", "Quiero Daniela");
assert.match(model.reply, /Daniela/);
assert.match(model.reply, /Colores disponibles/i);
assert.match(model.reply, /Vino/);
assert.equal((model.reply.match(/^• /gm) ?? []).length, 13, "Daniela must show all 13 real catalog colors.");
const color = await send("color", "Vino");
assert.match(color.reply, /FLOES-DAN-11/);
const image = color.messages?.find(message => message.type === "image");
assert.equal(image?.url, "https://floes-commerce.vercel.app/catalogo/floes/daniela/vino.jpeg");
assert.match(image.caption, /Daniela/);
assert.match(image.caption, /Vino/);
assert.match(image.caption, /Precio: 39\.99 USD/);
assert.match(image.caption, /Promoción: 34\.99 USD/);
assert.match(image.caption, /Tallas disponibles:/);
const size = await send("size", "M");
assert.match(size.reply, /Seleccionaste M/);
assert.match(size.reply, /Disponibilidad talla M: \d+ unidades/);
if (values["expected-stock"] !== undefined) assert.match(size.reply, new RegExp(`Disponibilidad talla M: ${Number(values["expected-stock"])} unidades`));
const guide = await send("guide", "Muéstrame la guía de tallas y medidas planas");
assert.match(guide.reply, /superficie plana/);
assert.match(guide.reply, /sin multiplicarla por dos/);
assert.match(guide.reply, /pecho 45 cm/);
assert.match(guide.reply, /cadera 61 cm/);
assert.ok(commerce?.productId && commerce?.variantId && commerce?.customerId, "The live API must provide commercial trace IDs.");
const context = { tenantId: "tenant-floes", assistantId: "commerce-assistant", actorId: "preview-smoke", conversationId: commerce.conversationId, requestId: `preview-${runId}-stock`, correlationId: `preview-${runId}` };
async function stock() {
  const entries = await Promise.all(["XS", "S", "M", "L", "XL"].map(async size => {
    const availability = await port.checkAvailability(context, { productId: commerce.productId, variantId: commerce.variantId, size, quantity: 1 });
    assert.equal(typeof availability.availableQuantity, "number");
    return [size, availability.availableQuantity];
  }));
  return Object.fromEntries(entries);
}
const stockBefore = await stock();
let stockAfter = stockBefore;
if (values["create-order"]) {
  const order = await send("order", "Lo quiero");
  assert.match(order.reply, /pedido quedó en borrador/);
  assert.match(order.reply, /pago aún no está confirmado/);
  assert.ok(commerce.orderId && commerce.customerId);
  stockAfter = await stock();
  assert.equal(stockAfter.M, stockBefore.M - 1, "Only M reserves one unit.");
  for (const size of ["XS", "S", "L", "XL"]) assert.equal(stockAfter[size], stockBefore[size]);
  if (values["attach-test-proof"]) {
    const response = await fetch(new URL("/api/live", url), {
      method: "POST", headers: {
        authorization: `Bearer ${bearer}`, "content-type": "application/json",
        ...(process.env.GANOBOT_VERCEL_PROTECTION_BYPASS_SECRET ? { "x-vercel-protection-bypass": process.env.GANOBOT_VERCEL_PROTECTION_BYPASS_SECRET } : {}),
      },
      body: JSON.stringify({ tenantId: "tenant-floes", channel: "WHATSAPP", providerMessageId: `preview-${runId}-proof`, customer: { phone, name: "Cliente piloto Preview" }, text: "Envío mi comprobante de pago", paymentProofReference: `meta-whatsapp://999999999999/media/preview_${runId}` }), signal: AbortSignal.timeout(90_000),
    });
    assert.equal(response.status, 200);
    const proof = await response.json();
    assert.match(proof.reply, /pendiente de revisión/);
    transcript.push({ step: "proof", simulatedMetaReference: true, reply: proof.reply });
  }
}
const report = { status: "PASS", previewUrl: url.origin, commercePreviewUrl: commerceUrl.origin, tenantId: "tenant-floes", runId, orderCreated: values["create-order"], simulatedPaymentProof: values["create-order"] && values["attach-test-proof"], commerce, stockBefore, stockAfter, transcript };
const reportText = JSON.stringify(report, null, 2);
if (values["report-path"]) { await mkdir(dirname(values["report-path"]), { recursive: true }); await writeFile(values["report-path"], reportText + "\n", "utf8"); }
console.log(reportText);
