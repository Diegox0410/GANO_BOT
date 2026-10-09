import { availableCatalogVariants, catalogVariantSizes, normalizeCatalogValue, safeCatalogImageUrl } from "../apps/functions/dist/commerce/catalogTools.js";

function plain(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : undefined; }
function normalized(value) { return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim(); }

export function readCatalogSelection(messages) {
  for (const message of [...messages].reverse()) {
    if (message?.role !== "assistant" || typeof message.metadata?.commerceSelection !== "string") continue;
    try {
      const value = plain(JSON.parse(message.metadata.commerceSelection));
      if (!value || typeof value.productId !== "string") continue;
      return Object.freeze(Object.fromEntries(Object.entries(value).filter(([key, entry]) => ["productId", "name", "color", "variantId", "size", "orderId", "customerId", "orderStatus", "deliveryMode", "deliveryPending", "deliveryAddress", "deliveryMissingFields"].includes(key) && typeof entry === "string")));
    } catch { continue; }
  }
  return Object.freeze({});
}

export function catalogConversationCall(message, messages = [], metadata = {}) {
  const selection = readCatalogSelection(messages);
  const current = normalized(message);
  const customerId = metadata.customerId ?? selection.customerId;
  const size = message.match(/\b(?:talla|soy\s+talla|size)\s*[:=]?\s*([a-z0-9]+)\b/i)?.[1]?.toUpperCase();
  if (selection.orderId && customerId && selection.orderStatus === "delivered" && /\b(?:recibi|recibido|satisfecha|contenta|encanto|novedad|problema|reclamo|humano|persona)\b/.test(current)) return { name: "commerce.recordOrderFollowUp", arguments: { orderId: selection.orderId, customerId, outcome: /novedad|problema|reclamo/.test(current) ? "ISSUE" : /humano|persona/.test(current) ? "HUMAN_REQUESTED" : /satisfecha|contenta|encanto/.test(current) ? "SATISFIED" : "RECEIVED", note: message.slice(0, 500) } };
  const deliveryMode = /servientrega/.test(current) ? "SERVIENTREGA" : /retiro|recoger/.test(current) ? "PICKUP" : /entrega presencial|entrega local/.test(current) ? "LOCAL_DELIVERY" : selection.deliveryPending === "true" ? selection.deliveryMode : undefined;
  if (selection.orderId && customerId && deliveryMode) {
    let address = {};
    try { address = plain(JSON.parse(selection.deliveryAddress ?? "{}")) ?? {}; } catch { address = {}; }
    const aliases = { name: "nombre", phone: "telefono|teléfono", city: "ciudad", province: "provincia", address: "direccion|dirección", reference: "referencia" };
    let found = false;
    for (const [key, alias] of Object.entries(aliases)) {
      const value = message.match(new RegExp(`(?:${alias})\\s*[:=]\\s*(.+?)(?=[,;\\n]|$)`, "i"))?.[1]?.trim();
      if (value) { address[key] = value; found = true; }
    }
    const nextField = selection.deliveryMissingFields?.split(",")[0];
    if (!found && selection.deliveryPending === "true" && nextField && !/servientrega|retiro|recoger|entrega presencial|entrega local/.test(current)) address[nextField] = message.trim();
    return { name: "commerce.updateOrderDelivery", arguments: { orderId: selection.orderId, customerId, deliveryMode, deliveryAddress: address } };
  }
  if (/\b(?:hablar con|persona|asesora|humano|novedad|reclamo|insatisfecha|devolucion)\b/.test(current)) return { name: "commerce.requestHumanEscalation", arguments: { reason: message.trim().slice(0, 500), priority: "NORMAL" } };
  if (/\b(?:estado|pago confirmado|ya pague|preparacion|despacho|guia|entregado|recibi|recibido)\b/.test(current) && selection.orderId) return { name: "commerce.getOrderStatus", arguments: { orderId: selection.orderId } };
  if (metadata.paymentProofUrl && selection.orderId && safeCatalogImageUrl(metadata.paymentProofUrl)) return { name: "commerce.attachPaymentProof", arguments: { orderId: selection.orderId, proofUrl: metadata.paymentProofUrl } };
  if (/\b(?:lo quiero|quiero este|quiero esta|confirmo pedido)\b/.test(current) && selection.orderId) return { name: "commerce.getOrderStatus", arguments: { orderId: selection.orderId } };
  if (/\b(?:lo quiero|quiero este|quiero esta|agregar al pedido|comprar|confirmo pedido)\b/.test(current) && selection.productId && selection.variantId && selection.size) return {
    name: "commerce.prepareCustomerOrder",
    arguments: { productId: selection.productId, variantId: selection.variantId, size: selection.size, quantity: Number(message.match(/\b(?:cantidad|unidades)\s*[:=]?\s*(\d+)\b/i)?.[1] ?? 1), ...(metadata.customerId ? { customerId: metadata.customerId } : {}), ...(metadata.customerPhone ? { phone: metadata.customerPhone } : {}), ...(metadata.customerName ? { name: metadata.customerName } : {}), channel: "WHATSAPP", source: "WHATSAPP" },
  };
  const requestsCatalog = /\b(?:catalogo|otro modelo|que modelos|que tienen|que venden|opciones|hola|uniforme)\b/.test(current);
  const named = message.match(/\b(?:modelo|scrub)\s+(.+?)(?:\s+(?:en|color|talla)\s+|[?.!]|$)/i)?.[1]?.trim();
  let query = named ?? message.replace(/^[¿¡\s]*(?:hola[,!]?\s*)?(?:quiero|me interesa|estoy interesada en|tienen|ensename|enséñame|muestrame|muéstrame|ver|conocer)\s+(?:ver\s+)?(?:el\s+|la\s+)?/i, "").replace(/[?!.,]+$/g, "").trim();
  const explicitColor = message.match(/\b(?:en|color)\s+(.+?)(?:\s+talla\s+|[?.!]|$)/i)?.[1]?.trim();
  const asksAnother = /^(?:quiero|me interesa|tienen|ensename|muestrame)\s+/.test(current) && !/^(?:lo quiero|quiero este|quiero esta)/.test(current);
  const follows = selection.productId && !named && !requestsCatalog && !asksAnother && (size || explicitColor || /\b(?:cuanto|cuesta|precio|colores|tallas|medida|guia|recomienda|recomiendas|bolsillos|fresco|elegante|manga|jogger|cambio|entrega|lo quiero|quiero este|pecho|cintura|cadera|plana|prenda)\b/.test(current) || current.split(/\s+/).length <= 3);
  if (follows) {
    const asksInfo = /\b(?:cuanto|cuesta|precio|colores|tallas|medida|guia|recomienda|recomiendas|bolsillos|fresco|elegante|manga|jogger|cambio|entrega|lo quiero|quiero este|cm|centimetros|pecho|cintura|cadera)\b/.test(current);
    const color = explicitColor ?? (!size && !asksInfo ? message.replace(/^[¿¡\s]*(?:y\s+)?/, "").replace(/[?.!]+$/g, "").trim() : selection.color);
    return { name: "commerce.consultCatalog", arguments: { productId: selection.productId, ...(color ? { color } : {}), ...(size ?? selection.size ? { size: size ?? selection.size } : {}) } };
  }
  if (requestsCatalog) query = "";
  if (/\b(?:bolsillos|elegante|manga larga|jogger|fresco)\b/.test(current) && !named) query = "";
  if (explicitColor) query = query.replace(/\s+(?:en|color)\s+.+$/i, "").trim();
  return { name: "commerce.consultCatalog", arguments: { query, ...(explicitColor && !requestsCatalog ? { color: explicitColor } : {}), ...(size ? { size } : {}) } };
}

function money(value, status) { return plain(value) && typeof value.amount === "number" && Number.isFinite(value.amount) && value.amount >= 0 && status !== "PENDING" && typeof value.currency === "string" ? `${value.amount.toFixed(2)} ${value.currency}` : undefined; }
function colors(product) { return [...new Map(availableCatalogVariants(product).filter(variant => variant.color).map(variant => [normalizeCatalogValue(variant.color), variant.color])).values()]; }
function guidance(product, message) {
  if (!/talla|medida|gu[ií]a|ajuste|\bcm\b|cent[ií]metros|pecho|cintura|cadera/i.test(message)) return "";
  const guide = product.sizeGuide;
  let reply = "La guía FLOES compara medidas planas de la prenda en centímetros: extiende una prenda que te quede bien y mide horizontalmente. Compara esa medida tal cual, sin multiplicarla por dos. El ajuste puede variar; no podemos prometer un ajuste perfecto.";
  if (guide?.measurement === "FLAT_GARMENT_CM") {
    for (const [name, rows] of [["Blusa", guide.blouse], ["Pantalón", guide.trousers]]) {
      if (Array.isArray(rows) && rows.length) reply += `\n${name}:\n` + rows.map(row => `${row.size}: ${Object.entries(row.measurementsCm ?? {}).filter(([, value]) => typeof value === "number" && Number.isFinite(value)).map(([key, value]) => `${key} ${value} cm`).join(", ")}`).join("\n");
    }
    if (product.sizeRecommendation) reply += `\n${product.sizeRecommendation}`;
    const flatConfirmed = /plana|prenda|extendida/i.test(message);
    if (flatConfirmed) {
      for (const [part, rows] of [["Blusa", guide.blouse], ["Pantalón", guide.trousers]]) {
        for (const key of [...new Set((rows ?? []).flatMap(row => Object.keys(row.measurementsCm ?? {})))]) {
          const escaped = normalized(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const measure = normalized(message).match(new RegExp(`${escaped}\\s*(?:plana?|de la prenda)?\\s*[:=]?\\s*(\\d+(?:[.,]\\d+)?)`));
          if (!measure) continue;
          const value = Number(measure[1].replace(",", "."));
          if (!Number.isFinite(value) || value <= 0) continue;
          const sorted = (rows ?? []).filter(row => Number.isFinite(row.measurementsCm?.[key])).slice().sort((a, b) => a.measurementsCm[key] - b.measurementsCm[key]);
          const lower = sorted.filter(row => row.measurementsCm[key] <= value).at(-1);
          const upper = sorted.find(row => row.measurementsCm[key] >= value);
          if (lower && upper && lower.size !== upper.size) reply += `\n${part}: tu ${key} plano de ${value} cm queda entre ${lower.size} (${lower.measurementsCm[key]} cm) y ${upper.size} (${upper.measurementsCm[key]} cm).`;
          else if (lower?.measurementsCm[key] === value) reply += `\n${part}: ${value} cm coincide con ${key} de ${lower.size} en la tabla; compara también las demás medidas.`;
          else reply += `\n${part}: no encuentro dos tallas que encuadren esa medida plana. Podemos pedir orientación a FLOES.`;
        }
      }
    }
  } else reply += "\nAún no tengo una tabla de medidas confirmada para este modelo.";
  return reply + "\n¿Qué medida plana tiene tu prenda? Si estás entre dos tallas, cuéntame si prefieres un ajuste más cercano o más holgado.";
}

export function catalogConversationResponse(result, message = "", previous = {}) {
  const record = plain(result);
  if (record?.kind === "catalog") {
    const products = Array.isArray(record.products) ? record.products : [];
    const product = record.selectedProduct;
    if (!products.length) return { reply: "No encuentro un modelo que coincida con tu consulta en el catálogo actual. Cuéntame qué modelo o característica buscas.", selection: previous };
    if (!product) {
      const wanted = normalized(message).split(/\W+/).filter(word => word.length > 4);
      const scored = products.map(item => ({ item, score: wanted.filter(word => normalized([item.description, ...(item.characteristics ?? []), item.ganoBotNotes ?? ""].join(" ")).includes(word)).length })).sort((a, b) => b.score - a.score);
      const matches = scored.some(entry => entry.score > 0) ? scored.filter(entry => entry.score > 0).map(entry => entry.item) : products;
      return { reply: `Estos son los modelos del catálogo actual 💙\n\n${matches.map(item => `• ${item.name}${colors(item).length ? ` · ${colors(item).length} colores disponibles` : ""}${item.characteristics?.length ? `\n  ${item.characteristics.slice(0, 3).join(" · ")}` : ""}`).join("\n")}\n\n¿Cuál modelo te gustaría conocer?`, selection: {} };
    }
    const variant = record.selectedVariant;
    const availableColors = colors(product);
    const selection = { productId: product.productId, name: product.name, ...(previous.productId === product.productId && previous.orderId ? { orderId: previous.orderId, ...(previous.orderStatus ? { orderStatus: previous.orderStatus } : {}) } : {}), ...(previous.customerId ? { customerId: previous.customerId } : {}), ...(variant ? { variantId: variant.variantId, color: variant.color ?? variant.name } : {}), ...(record.selectedSize ?? (!record.selectionError ? record.requestedSize : undefined) ? { size: record.selectedSize ?? record.requestedSize } : {}) };
    const lines = [`Claro 💙 ${product.name}${variant?.color ? ` en ${variant.color}` : ""}.`];
    if (product.description) lines.push(product.description);
    if (record.selectionError === "color-unavailable") lines.push(`No encuentro ${record.requestedColor} disponible para este modelo.`);
    if (record.selectionError === "size-unavailable") lines.push("Esa talla no aparece disponible para el color seleccionado.");
    if (!variant && availableColors.length) lines.push(`Colores disponibles:\n${availableColors.map(color => `• ${color}`).join("\n")}`);
    const price = variant?.pricingStatus === "PENDING" ? undefined : variant ? money(variant.promotionalPrice ?? variant.price, variant.pricingStatus ?? product.pricingStatus) ?? money(product.promotionalPrice ?? product.price, product.pricingStatus) : money(product.promotionalPrice ?? product.price, product.pricingStatus);
    lines.push(price ? `Precio: ${price}.` : "El precio está pendiente de confirmación.");
    if (variant) {
      const sizes = catalogVariantSizes(variant);
      if (sizes.length) lines.push(`Tallas disponibles: ${sizes.join(", ")}.${record.selectedSize ? ` Seleccionaste ${record.selectedSize}.` : ""}`);
      else lines.push("No tengo tallas confirmadas para esta variante.");
      if (typeof variant.availableQuantity === "number") lines.push(`Disponibilidad registrada: ${variant.availableQuantity} unidades.`);
    }
    if (product.characteristics?.length && /bolsillos|elegante|manga|jogger|fresc|detalle|caracter/i.test(message)) lines.push(product.characteristics.join(" · "));
    if (/cambio/i.test(message)) lines.push(product.exchangePolicy?.conditions ?? "Aún no tengo una política de cambios confirmada para este modelo.");
    if (/entrega|preparaci[oó]n/i.test(message)) lines.push([product.deliveryType, product.preparationTime].filter(Boolean).join(" · ") || "Aún no tengo tiempos o modalidad de entrega confirmados.");
    const sizeHelp = guidance(product, message);
    if (sizeHelp) lines.push(sizeHelp);
    else if (!variant) lines.push("¿Cuál color te gustaría ver?");
    else if (!record.selectedSize) lines.push("¿Qué talla buscas? También puedo ayudarte con la guía de medidas planas.");
    else lines.push("¿Quieres agregarlo al pedido?");
    const image = variant && [variant.imageUrl, ...(variant.images ?? []).map(item => item.url)].map(safeCatalogImageUrl).find(Boolean);
    return { reply: lines.join("\n\n"), selection, ...(image ? { image: { type: "image", url: image, caption: `${product.name} · ${variant.color ?? variant.name}`, alt: `${product.name} ${variant.color ?? variant.name}` } } : {}) };
  }
  if (record?.kind === "order-draft") return { reply: `Tu pedido quedó en borrador 💙\n${record.selectedProduct.name} · ${record.selectedVariant.color ?? record.selectedVariant.name} · talla ${record.selectedSize} · ${record.quantity} unidad(es).${record.order.total ? `\nTotal: ${money(record.order.total, "READY")}.` : ""}\n\nEl pago aún no está confirmado. Tu comprobante quedará pendiente de revisión de FLOES.`, selection: { ...previous, productId: record.selectedProduct.productId, variantId: record.selectedVariant.variantId, color: record.selectedVariant.color ?? record.selectedVariant.name, size: record.selectedSize, customerId: record.customerId, orderId: record.order.orderId } };
  if (record?.kind === "delivery-collection") {
    const labels = { name: "nombre de quien recibe", phone: "teléfono", city: "ciudad", province: "provincia", address: "dirección" };
    return { reply: `Para ${record.deliveryMode === "SERVIENTREGA" ? "Servientrega" : "la entrega presencial"} falta confirmar: ${record.missingFields.map(field => labels[field] ?? field).join(", ")}.\n\nCompárteme ${labels[record.missingFields[0]] ?? record.missingFields[0]}. Conservaremos los datos que ya tenemos.`, selection: { ...previous, orderId: record.orderId, customerId: record.customerId, deliveryMode: record.deliveryMode, deliveryPending: "true", deliveryAddress: JSON.stringify(record.deliveryAddress), deliveryMissingFields: record.missingFields.join(",") } };
  }
  if (record?.kind === "delivery-updated") return { reply: `Quedó registrada tu modalidad: ${record.order.deliveryMode === "PICKUP" ? "retiro" : record.order.deliveryMode === "SERVIENTREGA" ? "Servientrega" : "entrega presencial"}. FLOES confirmará la coordinación y el despacho.`, selection: { ...previous, orderId: record.order.orderId, deliveryPending: "false", deliveryMode: record.order.deliveryMode, deliveryAddress: JSON.stringify(record.order.deliveryAddress ?? {}) } };
  if (record?.kind === "order-follow-up") return { reply: record.outcome === "ISSUE" || record.outcome === "HUMAN_REQUESTED" ? `Registré tu novedad para FLOES. ${record.order.exchangePolicy?.conditions ?? "No tengo una política de cambios confirmada para este pedido."} Puedes pedir atención humana para revisar el caso.` : "Gracias por contarnos 💙 Registramos tu seguimiento. Si necesitas ayuda con el pedido, aquí estamos.", selection: { ...previous, orderId: record.order.orderId, orderStatus: record.order.status } };
  if (record?.proofId && record.status === "pending_review") return { reply: "Recibimos tu comprobante 💙 El pago está pendiente de revisión por FLOES. Te confirmaremos cuando Owner/Admin lo apruebe.", selection: previous };
  if (record?.escalationId) return { reply: "Dejé tu solicitud para atención humana de FLOES. Una persona puede ayudarte con esta consulta.", selection: previous };
  if (record?.orderId && record.status) {
    const replies = { draft: "Tu pedido está en borrador; el pago aún no está confirmado.", "awaiting-payment": "Tu pedido está esperando el pago.", "payment-under-review": "Tu comprobante está pendiente de revisión por FLOES.", paid: "¡Pago confirmado! 💙 FLOES puede comenzar la preparación de tu pedido.", preparing: record.paymentStatus === "approved" ? "¡Pago confirmado! 💙 Tu pedido FLOES ya pasó a preparación." : "Tu pedido está en preparación.", "ready-for-dispatch": record.deliveryMode ? `Tu pedido está listo para despacho 💙 Ya tenemos registrada la modalidad ${record.deliveryMode === "SERVIENTREGA" ? "Servientrega" : record.deliveryMode === "PICKUP" ? "retiro" : "entrega presencial"}.` : "Tu pedido está listo para despacho 💙 Confirma si prefieres Servientrega o retiro/entrega presencial.", dispatched: `Tu pedido fue despachado.${record.courier ? ` Transporte: ${record.courier}.` : ""}${record.trackingCode ? ` Guía: ${record.trackingCode}.` : ""}`, delivered: "Tu pedido figura entregado 💙 ¿Lo recibiste bien? Cuéntame cómo te quedó o si necesitas ayuda con alguna novedad.", cancelled: "Tu pedido figura cancelado." };
    return { reply: replies[record.status] ?? "No tengo un estado confirmado que pueda interpretar. Puedo pedir ayuda a FLOES.", selection: { ...previous, orderId: record.orderId, orderStatus: record.status, ...(record.customerId ? { customerId: record.customerId } : {}), ...(record.deliveryMode ? { deliveryMode: record.deliveryMode } : {}), ...(record.deliveryAddress ? { deliveryAddress: JSON.stringify(record.deliveryAddress) } : {}) } };
  }
  return { reply: "No tengo información confirmada suficiente para completar esta consulta. Puedo ayudarte a revisar el catálogo o pedir ayuda a FLOES.", selection: previous };
}
