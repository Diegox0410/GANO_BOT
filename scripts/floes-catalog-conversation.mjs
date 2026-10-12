import { availableCatalogVariants, catalogVariantSizes, normalizeCatalogValue, safeCatalogImageUrl } from "../apps/functions/dist/commerce/catalogTools.js";

function plain(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : undefined; }
function normalized(value) { return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim(); }

const MODELS = Object.freeze([
  { canonical: "María José", aliases: ["maria jose", "mariajose"] },
  { canonical: "Daniela", aliases: ["daniela", "danela", "daniel"] },
  { canonical: "Elite", aliases: ["elite"] },
]);
const COLORS = Object.freeze([
  { canonical: "Azul Marino", aliases: ["azul marino", "marino", "navy"] },
  { canonical: "Negro", aliases: ["negro", "negra"] },
  { canonical: "Palo Rosa", aliases: ["palo rosa"] },
  { canonical: "Blanco", aliases: ["blanco", "blanca"] },
  { canonical: "Celeste", aliases: ["celeste"] },
  { canonical: "Azul Eléctrico", aliases: ["azul electrico", "electrico"] },
  { canonical: "Gris", aliases: ["gris"] },
  { canonical: "Verde Petróleo", aliases: ["verde petroleo"] },
  { canonical: "Verde Militar", aliases: ["verde militar"] },
  { canonical: "Lila", aliases: ["lila"] },
  { canonical: "Vino", aliases: ["vino", "vinno"] },
  { canonical: "Verde Quirúrgico", aliases: ["verde quirurgico"] },
  { canonical: "Caqui", aliases: ["caqui", "khaki"] },
]);
function mentionedCanonical(message, choices) {
  const value = normalized(message);
  for (const choice of choices) for (const alias of choice.aliases) {
    if (new RegExp(`(?:^|\\b)${alias}(?:$|\\b)`, "i").test(value)) return choice.canonical;
  }
  return undefined;
}
function paymentProofIntent(message) { return /\b(?:comprobante|comprobantes|pago|transferencia|deposito|deposité|pagu[eé])\b/i.test(normalized(message)); }

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
  if (selection.orderId && paymentProofIntent(message) && (safeCatalogImageUrl(metadata.paymentProofUrl) || typeof metadata.paymentProofReference === "string" && /^meta-whatsapp:\/\/[0-9]{5,32}\/media\/[A-Za-z0-9_-]{1,256}$/.test(metadata.paymentProofReference))) return { name: "commerce.attachPaymentProof", arguments: { orderId: selection.orderId, ...(safeCatalogImageUrl(metadata.paymentProofUrl) ? { proofUrl: metadata.paymentProofUrl } : {}), ...(metadata.paymentProofReference ? { externalReference: metadata.paymentProofReference } : {}) } };
  const sizeToken = normalized(message).match(/\b(?:talla\s+|soy\s+(?:talla\s+)?|size\s+)?(extra\s+small|extra\s+large|xs|xl|small|medium|large|mediana|mediano|s|m|l)\b/)?.[1];
  const sizeAliases = { "extra small": "XS", xs: "XS", small: "S", s: "S", medium: "M", mediana: "M", mediano: "M", m: "M", large: "L", l: "L", "extra large": "XL", xl: "XL" };
  const size = sizeToken ? sizeAliases[sizeToken] : undefined;
  const model = mentionedCanonical(message, MODELS);
  const modelSwitch = Boolean(model && selection.productId && normalized(model) !== normalized(selection.name));
  const canonicalColor = mentionedCanonical(message, COLORS);
  const ambiguousColor = !canonicalColor && /\bazul(?:es)?\b/i.test(current);
  if (model && (!selection.productId || modelSwitch || normalized(model) === current || /\b(?:modelo|mejor|prefiero|quiero|ver|muestrame|ensename)\b/i.test(current))) {
    return { name: "commerce.consultCatalog", arguments: { query: model, ...(canonicalColor ? { color: canonicalColor } : {}), ...(size ? { size } : {}) } };
  }
  if (ambiguousColor && !selection.productId) return { name: "commerce.consultCatalog", arguments: { query: "" } };
  if (selection.productId && ambiguousColor) return { name: "commerce.consultCatalog", arguments: { productId: selection.productId, ...(size ?? selection.size ? { size: size ?? selection.size } : {}) } };
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
  if (/\b(?:lo quiero|quiero este|quiero esta|confirmo pedido)\b/.test(current) && selection.orderId) return { name: "commerce.getOrderStatus", arguments: { orderId: selection.orderId } };
  if (/\b(?:lo quiero|quiero este|quiero esta|agregar al pedido|comprar|confirmo pedido)\b/.test(current) && selection.productId && selection.variantId && selection.size) return {
    name: "commerce.prepareCustomerOrder",
    arguments: { productId: selection.productId, variantId: selection.variantId, size: selection.size, quantity: Number(message.match(/\b(?:cantidad|unidades)\s*[:=]?\s*(\d+)\b/i)?.[1] ?? 1), ...(metadata.customerId ? { customerId: metadata.customerId } : {}), ...(metadata.customerPhone ? { phone: metadata.customerPhone } : {}), ...(metadata.customerName ? { name: metadata.customerName } : {}), channel: "WHATSAPP", source: "WHATSAPP" },
  };
  const requestsCatalog = /\b(?:catalogo|otro modelo|que modelos|que tienen|que venden|opciones|uniforme)\b/.test(current) || /^hola[!.?]*$/.test(current);
  const named = message.match(/\b(?:modelo|scrub)\s+(.+?)(?:\s+(?:en|color|talla)\s+|[?.!]|$)/i)?.[1]?.trim();
  let query = named ?? message.replace(/^[¿¡\s]*(?:hola[,!]?\s*)?(?:quiero|me interesa|estoy interesada en|tienen|ensename|enséñame|muestrame|muéstrame|ver|conocer)\s+(?:ver\s+)?(?:el\s+|la\s+)?/i, "").replace(/[?!.,]+$/g, "").trim();
  const explicitColor = canonicalColor ?? (message.match(/\bcolor\s+(.+?)(?:\s+talla\s+|[?.!]|$)/i)?.[1] ?? message.match(/\ben\s+(.+?)(?:\s+talla\s+|[?.!]|$)/i)?.[1])?.trim();
  const asksAnother = /^(?:quiero|me interesa|tienen|ensename|muestrame)\s+/.test(current) && !/^(?:lo quiero|quiero este|quiero esta)/.test(current) && !/\b(?:guia|talla|tallas|medida|medidas|precio|color|colores)\b/.test(current);
  const asksInfo = /\b(?:cuanto|cuesta|precio|colores|tallas|talla|medida|guia|recomienda|recomiendas|caracteristicas|caracter|bolsillos|fresco|elegante|manga|jogger|cambio|entrega|lo quiero|quiero este|cm|centimetros|pecho|cintura|cadera)\b/.test(current);
  const follows = selection.productId && !named && !requestsCatalog && !asksAnother && (size || explicitColor || asksInfo || current.split(/\s+/).length <= 3);
  if (follows) {
    const color = explicitColor ?? (!size && !asksInfo ? message.replace(/^[¿¡\s]*(?:(?:y|mejor|prefiero)\s+)?/i, "").replace(/[?.!]+$/g, "").trim() : selection.color);
    return { name: "commerce.consultCatalog", arguments: { productId: selection.productId, ...(color ? { color } : {}), ...(size ?? selection.size ? { size: size ?? selection.size } : {}) } };
  }
  if (requestsCatalog) query = "";
  if (/\b(?:bolsillos|elegante|manga larga|jogger|fresco)\b/.test(current) && !named) query = "";
  if (explicitColor) query = query.replace(/\s+(?:en|color)\s+.+$/i, "").trim();
  return { name: "commerce.consultCatalog", arguments: { query, ...(explicitColor && !requestsCatalog ? { color: explicitColor } : {}), ...(size ? { size } : {}) } };
}

function money(value, status) { return plain(value) && typeof value.amount === "number" && Number.isFinite(value.amount) && value.amount >= 0 && status !== "PENDING" && typeof value.currency === "string" ? `${value.amount.toFixed(2)} ${value.currency}` : undefined; }
function colors(product) { return [...new Map(availableCatalogVariants(product).filter(variant => variant.color).map(variant => [normalizeCatalogValue(variant.color), variant.color])).values()]; }
function guidance(product, message, chosenSize) {
  const current = normalized(message);
  const guideRequested = /\b(?:guia de tallas|ver tabla|muestrame las medidas|ensename las medidas)\b/i.test(current);
  const doesNotKnow = /\bno se mi talla\b|\bno conozco mi talla\b/i.test(current);
  const asksRecommendation = /\bque talla (?:me )?(?:recomiendas?|debo elegir|me queda)\b|\bque talla soy\b/i.test(current);
  const asksMeasurements = /medidas?|medida plana|\bcm\b|centimetros|pecho|cintura|cadera|largo|manga|muslo|basta/i.test(current);
  if (doesNotKnow) return "No necesitas saber tu talla de memoria 💙 Toma una prenda que te quede bien, extiéndela sobre una superficie plana y mide de lado a lado. ¿Prefieres comparar una blusa o un pantalón?";
  if (asksRecommendation) return "📏 ¿Dudas con tu talla?\n\nDime qué talla usas normalmente o puedo ayudarte comparando las medidas de una prenda que te quede bien.\n\nSi quieres, también puedo mostrarte nuestra guía de tallas 💙";
  if (guideRequested) return "Te comparto la guía visual FLOES 💙 Las medidas corresponden a la prenda extendida; compáralas de lado a lado, sin multiplicarlas por dos.";
  if (!/talla|medida|ajuste|\bcm\b|cent[ií]metros|pecho|cintura|cadera/i.test(message)) return "";
  const guide = product.sizeGuide;
  let reply = "La guía FLOES compara medidas planas de la prenda en centímetros; no son medidas corporales. Extiende una prenda que te quede bien y mide de lado a lado, sin multiplicar por dos.";
  if (guide?.measurement === "FLAT_GARMENT_CM") {
    if (asksMeasurements && !chosenSize && /plana|prenda|extendida/i.test(current)) {
      for (const [part, rows] of [["Blusa", guide.blouse], ["Pantalón", guide.trousers]]) {
        for (const key of [...new Set((rows ?? []).flatMap(row => Object.keys(row.measurementsCm ?? {})))]) {
          const escaped = normalized(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const measure = current.match(new RegExp(`${escaped}\\s*(?:plana?|de la prenda)?\\s*[:=]?\\s*(\\d+(?:[.,]\\d+)?)`));
          if (!measure) continue;
          const value = Number(measure[1].replace(",", "."));
          if (!Number.isFinite(value) || value <= 0) continue;
          const sorted = (rows ?? []).filter(row => Number.isFinite(row.measurementsCm?.[key])).slice().sort((a, b) => a.measurementsCm[key] - b.measurementsCm[key]);
          const lower = sorted.filter(row => row.measurementsCm[key] <= value).at(-1);
          const upper = sorted.find(row => row.measurementsCm[key] >= value);
          if (lower && upper && lower.size !== upper.size) reply += `\n${part}: tu ${key} plano de ${value} cm queda entre ${lower.size} (${lower.measurementsCm[key]} cm) y ${upper.size} (${upper.measurementsCm[key]} cm).`;
          else if (lower?.measurementsCm[key] === value) reply += `\n${part}: ${value} cm coincide con ${key} de ${lower.size}; compara también las demás medidas.`;
          else reply += `\n${part}: no encuentro dos tallas que encuadren esa medida plana.`;
          return `${reply}\nSi estás entre dos tallas, dime si prefieres un ajuste más cercano o más holgado. El ajuste puede variar.`;
        }
      }
      return `${reply}\n¿Qué medida estás comparando: pecho, cintura, cadera u otra?`;
    }
    if (!asksMeasurements || !chosenSize) return `${reply}\n¿Qué talla te interesa revisar? Si aún no sabes, podemos comparar la medida plana de una prenda tuya.`;
    const size = String(chosenSize).toUpperCase();
    let found = false;
    for (const [name, rows] of [["Blusa", guide.blouse], ["Pantalón", guide.trousers]]) {
      const row = Array.isArray(rows) ? rows.find(entry => String(entry.size).toUpperCase() === size) : undefined;
      if (!row) continue;
      found = true;
      const values = Object.entries(row.measurementsCm ?? {}).filter(([, value]) => typeof value === "number" && Number.isFinite(value)).map(([key, value]) => `${key} ${value} cm`);
      if (values.length) reply += `\n${name} · talla ${size}: ${values.join(", ")}.`;
    }
    if (!found) reply += `\nNo tengo medidas confirmadas para la talla ${size} de este modelo.`;
  } else reply += "\nAún no tengo una tabla de medidas confirmada para este modelo.";
  if (product.sizeRecommendation) reply += `\n${product.sizeRecommendation}`;
  return `${reply}\nSi estás entre dos tallas, dime si prefieres un ajuste más cercano o más holgado. El ajuste puede variar.`;
}

export function catalogConversationResponse(result, message = "", previous = {}) {
  const record = plain(result);
  if (record?.kind === "catalog") {
    const products = Array.isArray(record.products) ? record.products : [];
    const product = record.selectedProduct;
    if (!products.length) return { reply: "No encuentro un modelo que coincida con tu consulta en el catálogo actual. Cuéntame qué modelo o característica buscas.", selection: previous };
    if (!product) {
      if (/\bazul(?:es)?\b/i.test(normalized(message))) {
        const blueChoices = [...new Set(products.flatMap(colors).filter(color => /azul|celeste/i.test(normalized(color))))];
        if (blueChoices.length > 1) return { reply: `Hay varios tonos disponibles: ${blueChoices.join(", ")}. ¿Cuál prefieres y para qué modelo?`, selection: {} };
      }
      const wanted = normalized(message).split(/\W+/).filter(word => word.length > 4);
      const scored = products.map(item => ({ item, score: wanted.filter(word => normalized([item.description, ...(item.characteristics ?? []), item.ganoBotNotes ?? ""].join(" ")).includes(word)).length })).sort((a, b) => b.score - a.score);
      const matches = scored.some(entry => entry.score > 0) ? scored.filter(entry => entry.score > 0).map(entry => entry.item) : products;
      return { reply: `Estos son los modelos del catálogo actual 💙\n\n${matches.map(item => `• ${item.name}${colors(item).length ? ` · ${colors(item).length} colores disponibles` : ""}${item.characteristics?.length ? `\n  ${item.characteristics.slice(0, 3).join(" · ")}` : ""}`).join("\n")}\n\n¿Cuál modelo te gustaría conocer?`, selection: {} };
    }
    const variant = record.selectedVariant;
    const availableColors = colors(product);
    const selection = { productId: product.productId, name: product.name, ...(previous.productId === product.productId && previous.orderId ? { orderId: previous.orderId, ...(previous.orderStatus ? { orderStatus: previous.orderStatus } : {}) } : {}), ...(previous.customerId ? { customerId: previous.customerId } : {}), ...(variant ? { variantId: variant.variantId, color: variant.color ?? variant.name } : {}), ...(record.selectedSize ?? (!record.selectionError ? record.requestedSize : undefined) ? { size: record.selectedSize ?? record.requestedSize } : {}) };
    const sizingMessage = normalized(message);
    if (/\bque talla (?:me )?(?:recomiendas?|debo elegir|me queda)\b|\bque talla soy\b/i.test(sizingMessage)) return {
      reply: "📏 ¿Dudas con tu talla?\n\nDime qué talla usas normalmente o puedo ayudarte comparando las medidas de una prenda que te quede bien.\n\nSi quieres, también puedo mostrarte nuestra guía de tallas 💙",
      selection,
    };
    if (/\bno se mi talla\b|\bno conozco mi talla\b/i.test(sizingMessage)) return {
      reply: "No necesitas saber tu talla de memoria 💙 Toma una prenda que te quede bien, extiéndela sobre una superficie plana y mide de lado a lado. ¿Prefieres comparar una blusa o un pantalón?",
      selection,
    };
    const lines = [`Claro 💙 ${product.name}${variant?.color ? ` en ${variant.color}` : ""}.`];
    if (product.description) lines.push(product.description);
    if (record.selectionError === "color-unavailable") lines.push(`No encuentro ${record.requestedColor} disponible para este modelo.`);
    if (record.selectionError === "size-unavailable") lines.push("Esa talla no aparece disponible para el color seleccionado.");
    if (!variant && availableColors.length) {
      const requestedBlue = /\bazul(?:es)?\b/i.test(normalized(message));
      const choices = requestedBlue ? availableColors.filter(color => /azul|celeste/i.test(normalized(color))) : availableColors;
      if (requestedBlue && choices.length > 1) lines.push(`Hay varias opciones de azul: ${choices.join(", ")}. ¿Cuál buscas?`);
      else lines.push(`Colores disponibles:\n${availableColors.map(color => `• ${color}`).join("\n")}`);
    }
    const pricingStatus = variant?.pricingStatus ?? product.pricingStatus;
    const regularPrice = pricingStatus === "PENDING" ? undefined : variant ? money(variant.regularPrice ?? variant.price, pricingStatus) ?? money(product.price, product.pricingStatus) : money(product.price, product.pricingStatus);
    const promotionalPrice = pricingStatus === "PENDING" ? undefined : money(variant?.promotionalPrice ?? product.promotionalPrice, pricingStatus);
    const price = promotionalPrice ?? regularPrice;
    const priceLines = regularPrice && promotionalPrice && regularPrice !== promotionalPrice
      ? [`Precio: ${regularPrice}.`, `Promoción: ${promotionalPrice}.`]
      : [price ? `Precio: ${price}.` : "El precio está pendiente de confirmación."];
    lines.push(...priceLines);
    if (variant) {
      const sizes = catalogVariantSizes(variant);
      if (sizes.length) lines.push(`Tallas disponibles: ${sizes.join(", ")}.${record.selectedSize ? ` Seleccionaste ${record.selectedSize}.` : ""}`);
      else lines.push("No tengo tallas confirmadas para esta variante.");
      if (record.selectedSize) {
        if (typeof record.availability?.availableQuantity === "number") lines.push(`Disponibilidad talla ${record.selectedSize}: ${record.availability.availableQuantity} unidades.`);
        if (record.availability?.available === false) lines.push(`La talla ${record.selectedSize} no tiene disponibilidad para reservar en este momento.`);
      } else if (typeof variant.availableQuantity === "number") lines.push(`Disponibilidad total del color: ${variant.availableQuantity} unidades. Consultaré el stock de la talla que elijas.`);
    }
    if (product.characteristics?.length && /bolsillos|elegante|manga|jogger|fresc|detalle|caracter/i.test(message)) lines.push(product.characteristics.join(" · "));
    if (/cambio/i.test(message)) lines.push(product.exchangePolicy?.conditions ?? "Aún no tengo una política de cambios confirmada para este modelo.");
    if (/entrega|preparaci[oó]n/i.test(message)) lines.push([product.deliveryType, product.preparationTime].filter(Boolean).join(" · ") || "Aún no tengo tiempos o modalidad de entrega confirmados.");
    const guideRequested = /\b(?:guia de tallas|ver tabla|muestrame las medidas|ensename las medidas)\b/i.test(normalized(message));
    const sizeHelpRequested = guideRequested || /\b(?:medidas?|medida plana|cm|cent[ií]metros|pecho|cintura|cadera|largo|manga|muslo|basta)\b/i.test(normalized(message));
    const sizeHelp = sizeHelpRequested ? guidance(product, message, record.selectedSize ?? record.requestedSize) : "";
    if (sizeHelp) lines.push(sizeHelp);
    else if (!variant) lines.push("¿Cuál color te gustaría ver?");
    else if (!record.selectedSize) lines.push("¿Qué talla buscas? También puedo ayudarte con la guía de medidas planas.");
    else if (record.availability?.available !== false) lines.push("¿Quieres agregarlo al pedido?");
    const guideImage = guideRequested ? "https://floes-commerce.vercel.app/images/guia-tallas-floes.png" : undefined;
    const image = guideImage ?? (variant && [variant.imageUrl, ...(variant.images ?? []).map(item => item.url)].map(safeCatalogImageUrl).find(Boolean));
    const caption = guideRequested
      ? `Guía visual FLOES · ${product.name}${variant ? ` · ${variant.color ?? variant.name}` : ""}. Medidas de prenda en plano; no son medidas corporales.`
      : variant ? [`${product.name} · ${variant.color ?? variant.name}`, ...priceLines, `Tallas disponibles: ${catalogVariantSizes(variant).join(", ") || "por confirmar"}.`].join("\n").slice(0, 1024) : undefined;
    return { reply: lines.join("\n\n"), selection, ...(image ? { image: { type: "image", url: image, caption, alt: `${product.name} ${variant.color ?? variant.name}` } } : {}) };
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
