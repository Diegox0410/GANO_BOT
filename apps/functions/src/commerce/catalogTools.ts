import type { ToolDefinition, ToolExecutionContext } from "@gano-bot/ai-core/tools-engine";
import type { CommerceDeliveryAddress, CommercePort, CommerceProductDetails, CommerceProductVariant, CommerceRequestContext } from "./contracts.js";

export const CATALOG_TOOL_IDS = Object.freeze({ consultCatalog: "commerce.consultCatalog", prepareCustomerOrder: "commerce.prepareCustomerOrder", updateOrderDelivery: "commerce.updateOrderDelivery", recordOrderFollowUp: "commerce.recordOrderFollowUp" });

export function normalizeCatalogValue(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function text(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }

function contextFor(context: ToolExecutionContext, tenantId: string, assistantId: string, operation: string): CommerceRequestContext {
  if (context.tenantId !== tenantId || context.assistantId !== assistantId) throw new Error("Catalog context is outside the authorized scope.");
  return Object.freeze({ tenantId, assistantId, actorId: context.actorId, conversationId: context.conversationId, requestId: context.requestId, correlationId: context.correlationId, idempotencyKey: `${tenantId}:${context.requestId}:${operation}`, signal: context.signal });
}

export function availableCatalogVariants(product: CommerceProductDetails): readonly CommerceProductVariant[] {
  return Object.freeze(product.available ? (product.variants ?? []).filter(variant => variant.active !== false && variant.available) : []);
}

export function catalogVariantSizes(variant: CommerceProductVariant): readonly string[] {
  return Object.freeze([...new Set([...(variant.sizes ?? []), ...(variant.size ? [variant.size] : [])].map(size => size.trim()).filter(Boolean))]);
}

export function safeCatalogImageUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || !host.includes(".") || host === "localhost" || host.endsWith(".local") || host.endsWith(".localhost") || host.includes(":") || /^\d+(?:\.\d+){3}$/.test(host)) return undefined;
    return url.href;
  } catch { return undefined; }
}

export interface CatalogConsultation {
  readonly kind: "catalog";
  readonly products: readonly CommerceProductDetails[];
  readonly selectedProduct?: CommerceProductDetails;
  readonly selectedVariant?: CommerceProductVariant;
  readonly requestedColor?: string;
  readonly selectedSize?: string;
  readonly requestedSize?: string;
  readonly selectionError?: "color-unavailable" | "size-unavailable" | "ambiguous-variant";
}

export async function consultCatalog(port: CommercePort, context: CommerceRequestContext, input: { readonly query?: string; readonly productId?: string; readonly color?: string; readonly size?: string }): Promise<CatalogConsultation> {
  const products: CommerceProductDetails[] = [];
  if (input.productId) {
    const product = await port.getProductDetails(context, { productId: input.productId });
    if (product) products.push(product);
  } else {
    const summaries = await port.searchProducts(context, { query: input.query ?? "", limit: 8 });
    for (const summary of summaries.slice(0, 8)) {
      const product = await port.getProductDetails(context, { productId: summary.productId });
      if (product) products.push(product);
    }
  }
  const selectedProduct = products.length === 1 ? products[0] : undefined;
  if (!selectedProduct) return Object.freeze({ kind: "catalog", products: Object.freeze(products) });
  const variants = availableCatalogVariants(selectedProduct);
  const matches = input.color ? variants.filter(variant => normalizeCatalogValue(variant.color ?? "") === normalizeCatalogValue(input.color ?? "")) : [];
  const sizedMatches = input.size ? matches.filter(variant => catalogVariantSizes(variant).some(size => normalizeCatalogValue(size) === normalizeCatalogValue(input.size ?? ""))) : matches;
  const selectionError = input.color && matches.length === 0 ? "color-unavailable" : input.size && input.color && sizedMatches.length === 0 ? "size-unavailable" : sizedMatches.length > 1 && !input.size ? "ambiguous-variant" : undefined;
  const selectedVariant = sizedMatches.length === 1 ? sizedMatches[0] : matches.length > 1 && !input.size && matches[0] ? Object.freeze({ ...matches[0], sizes: Object.freeze([...new Set(matches.flatMap(catalogVariantSizes))]), availableQuantity: matches.every(item => typeof item.availableQuantity === "number") ? matches.reduce((sum, item) => sum + (item.availableQuantity ?? 0), 0) : undefined }) : undefined;
  return Object.freeze({ kind: "catalog", products: Object.freeze(products), selectedProduct, ...(selectedVariant ? { selectedVariant } : {}), ...(input.color ? { requestedColor: input.color } : {}), ...(input.size ? { requestedSize: input.size } : {}), ...(input.size && selectedVariant ? { selectedSize: input.size } : {}), ...(selectionError ? { selectionError } : {}) });
}

const stringSchema = Object.freeze({ type: "string", minLength: 1 });
function descriptor(id: string, description: string, tenantId: string, assistantId: string, properties: NonNullable<ToolDefinition["descriptor"]["inputSchema"]["properties"]>, required: readonly string[], riskLevel: "safe" | "medium" = "safe"): ToolDefinition["descriptor"] {
  return Object.freeze({ id, name: id, description, version: "1.0.0", category: "business", riskLevel, inputSchema: Object.freeze({ type: "object", additionalProperties: false, properties: Object.freeze(properties), required: Object.freeze(required) }), outputSchema: Object.freeze({ type: "object" }), requiredPermissions: Object.freeze(["tools:execute"]), confirmationPolicy: "never", timeoutMs: 30_000, enabled: true, tenantId, assistantId, tags: Object.freeze(["commerce", "authoritative-catalog", "tenant-scoped"]) });
}

export function createCatalogTools(port: CommercePort, tenantId: string, assistantId: string): readonly ToolDefinition[] {
  return Object.freeze([
    {
      descriptor: descriptor(CATALOG_TOOL_IDS.consultCatalog, "Consulta modelos reales, colores activos, tallas, imágenes, guía y notas comerciales desde Chopify. No inventa variantes.", tenantId, assistantId, { query: { type: "string" }, productId: stringSchema, color: stringSchema, size: stringSchema }, []),
      handler: { async execute(args, context) {
        return consultCatalog(port, contextFor(context, tenantId, assistantId, "consultCatalog"), { query: text(args.query), productId: text(args.productId), color: text(args.color), size: text(args.size) });
      } },
    },
    {
      descriptor: descriptor(CATALOG_TOOL_IDS.prepareCustomerOrder, "Crea cliente, oportunidad y borrador únicamente con producto, variante, talla y precio disponibles verificados. No confirma pagos.", tenantId, assistantId, { productId: stringSchema, variantId: stringSchema, size: stringSchema, quantity: { type: "integer", minimum: 1, maximum: 100 }, customerId: stringSchema, name: stringSchema, phone: stringSchema, channel: stringSchema, source: stringSchema, campaignId: stringSchema }, ["productId", "variantId", "size", "quantity"], "medium"),
      handler: { async execute(args, context) {
        const base = contextFor(context, tenantId, assistantId, "prepareCustomerOrder");
        const productId = text(args.productId) ?? "";
        const variantId = text(args.variantId) ?? "";
        const size = text(args.size) ?? "";
        const quantity = typeof args.quantity === "number" ? args.quantity : 0;
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw new Error("Invalid order quantity.");
        const product = await port.getProductDetails(base, { productId });
        const variant = product && availableCatalogVariants(product).find(item => item.variantId === variantId);
        if (!product || !variant || !catalogVariantSizes(variant).some(item => normalizeCatalogValue(item) === normalizeCatalogValue(size))) throw new Error("The selected product, variant or size is unavailable.");
        const price = variant.promotionalPrice ?? variant.price ?? product.promotionalPrice ?? product.price;
        if (!price || variant.pricingStatus === "PENDING" || (!variant.price && product.pricingStatus === "PENDING")) throw new Error("The selected price requires human confirmation.");
        const availability = await port.checkAvailability(base, { productId, variantId, quantity });
        if (!availability.available || (availability.availableQuantity !== undefined && availability.availableQuantity < quantity)) throw new Error("The requested quantity is unavailable.");
        const customerId = text(args.customerId);
        const phone = text(args.phone);
        if (!customerId && !phone) throw new Error("Customer identity is required before creating an order.");
        const customer = await port.createOrUpdateCustomer({ ...base, idempotencyKey: `${base.idempotencyKey}:customer` }, { customerId, name: text(args.name), phone, channel: text(args.channel) });
        const opportunity = await port.createOpportunity({ ...base, idempotencyKey: `${base.idempotencyKey}:opportunity` }, { customerId: customer.customerId, title: `${product.name} · ${variant.color ?? variant.name} · ${size}`, source: text(args.source), campaignId: text(args.campaignId), productIds: Object.freeze([productId]) });
        const order = await port.createOrderDraft({ ...base, idempotencyKey: `${base.idempotencyKey}:draft` }, { customerId: customer.customerId, opportunityId: opportunity.opportunityId, lines: Object.freeze([{ productId, variantId, size, quantity }]) });
        return Object.freeze({ kind: "order-draft", customerId: customer.customerId, opportunityId: opportunity.opportunityId, order, selectedProduct: product, selectedVariant: variant, selectedSize: size, quantity });
      } },
    },
    ...(port.updateOrderDelivery ? [{
      descriptor: descriptor(CATALOG_TOOL_IDS.updateOrderDelivery, "Recoge únicamente datos de entrega faltantes y guarda Servientrega, retiro o entrega presencial del propio cliente. No cambia el estado de despacho.", tenantId, assistantId, { orderId: stringSchema, customerId: stringSchema, deliveryMode: { type: "string" as const, enum: ["SERVIENTREGA", "PICKUP", "LOCAL_DELIVERY"] }, deliveryAddress: { type: "object" as const, additionalProperties: false, properties: { name: stringSchema, phone: stringSchema, city: stringSchema, province: stringSchema, address: stringSchema, reference: stringSchema } } }, ["orderId", "customerId", "deliveryMode"], "medium"),
      handler: { async execute(args: Readonly<Record<string, unknown>>, context: ToolExecutionContext) {
        const c = contextFor(context, tenantId, assistantId, "updateOrderDelivery");
        const orderId = text(args.orderId) ?? ""; const customerId = text(args.customerId) ?? "";
        const deliveryMode = text(args.deliveryMode);
        if (deliveryMode !== "SERVIENTREGA" && deliveryMode !== "PICKUP" && deliveryMode !== "LOCAL_DELIVERY") throw new Error("Invalid delivery mode.");
        const order = await port.getOrderStatus(c, { orderId });
        if (!order || order.customerId !== customerId) throw new Error("The order does not belong to this customer.");
        const raw = args.deliveryAddress && typeof args.deliveryAddress === "object" && !Array.isArray(args.deliveryAddress) ? args.deliveryAddress as Readonly<Record<string, unknown>> : {};
        const fields = ["name", "phone", "city", "province", "address", "reference"] as const;
        const deliveryAddress: CommerceDeliveryAddress = Object.freeze(Object.fromEntries(fields.flatMap(key => { const value = text(raw[key]) ?? text(order.deliveryAddress?.[key]); return value ? [[key, key === "phone" ? value.replace(/\D/g, "") : value]] : []; })));
        const missingFields = deliveryMode === "PICKUP" ? [] : fields.filter(key => key !== "reference" && !deliveryAddress[key]);
        if (missingFields.length) return Object.freeze({ kind: "delivery-collection", orderId, customerId, deliveryMode, deliveryAddress, missingFields: Object.freeze(missingFields) });
        if (!port.updateOrderDelivery) throw new Error("Delivery operation is unavailable.");
        const snapshot = await port.updateOrderDelivery(c, { orderId, customerId, deliveryMode, deliveryAddress });
        return Object.freeze({ kind: "delivery-updated", order: snapshot });
      } },
    }] : []),
    ...(port.recordOrderFollowUp ? [{
      descriptor: descriptor(CATALOG_TOOL_IDS.recordOrderFollowUp, "Registra recepción, satisfacción o novedad del pedido entregado del propio cliente. No inventa políticas ni modifica fulfillment.", tenantId, assistantId, { orderId: stringSchema, customerId: stringSchema, outcome: { type: "string" as const, enum: ["RECEIVED", "SATISFIED", "ISSUE", "HUMAN_REQUESTED"] }, note: stringSchema }, ["orderId", "customerId", "outcome"], "medium"),
      handler: { async execute(args: Readonly<Record<string, unknown>>, context: ToolExecutionContext) {
        const c = contextFor(context, tenantId, assistantId, "recordOrderFollowUp");
        const orderId = text(args.orderId) ?? ""; const customerId = text(args.customerId) ?? ""; const outcome = text(args.outcome);
        if (outcome !== "RECEIVED" && outcome !== "SATISFIED" && outcome !== "ISSUE" && outcome !== "HUMAN_REQUESTED") throw new Error("Invalid follow-up outcome.");
        const order = await port.getOrderStatus(c, { orderId });
        if (!order || order.customerId !== customerId || order.status !== "delivered") throw new Error("Follow-up requires the customer's delivered order.");
        if (!port.recordOrderFollowUp) throw new Error("Follow-up operation is unavailable.");
        const snapshot = await port.recordOrderFollowUp(c, { orderId, customerId, outcome, note: text(args.note) });
        return Object.freeze({ kind: "order-follow-up", outcome, order: snapshot });
      } },
    }] : []),
  ]);
}
