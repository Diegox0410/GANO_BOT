import type { ToolDefinition, ToolExecutionContext } from "@gano-bot/ai-core/tools-engine";
import type { CommerceAvailability, CommerceDeliveryAddress, CommercePort, CommerceProductDetails, CommerceProductVariant, CommerceRequestContext } from "./contracts.js";
import type { CommerceSupervisorPort } from "./supervisor.js";

export const CATALOG_TOOL_IDS = Object.freeze({ consultCatalog: "commerce.consultCatalog", prepareCustomerOrder: "commerce.prepareCustomerOrder", updateOrderDelivery: "commerce.updateOrderDelivery", recordOrderFollowUp: "commerce.recordOrderFollowUp" });

export function normalizeCatalogValue(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function text(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }

function scopedCustomerId(context: ToolExecutionContext, value: unknown): string | undefined {
  const trusted = text(context.metadata?.customerId);
  const supplied = text(value);
  if (trusted && supplied && trusted !== supplied) throw new Error("Customer is outside the authorized conversation.");
  return trusted ?? supplied;
}

function contextFor(context: ToolExecutionContext, tenantId: string, assistantId: string, operation: string): CommerceRequestContext {
  if (context.tenantId !== tenantId || context.assistantId !== assistantId) throw new Error("Catalog context is outside the authorized scope.");
  const originConversationId = typeof context.metadata?.originConversationId === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(context.metadata.originConversationId) ? context.metadata.originConversationId : undefined;
  return Object.freeze({ tenantId, assistantId, actorId: context.actorId, conversationId: context.conversationId, ...(text(context.metadata?.customerId) ? { customerId: text(context.metadata?.customerId) } : {}), ...(originConversationId ? { originConversationId } : {}), requestId: context.requestId, correlationId: context.correlationId, idempotencyKey: `${tenantId}:${context.requestId}:${operation}`, signal: context.signal });
}

export function catalogVisibleVariants(product: CommerceProductDetails): readonly CommerceProductVariant[] {
  return Object.freeze((product.variants ?? []).filter(variant => variant.active !== false));
}

export function availableCatalogVariants(product: CommerceProductDetails): readonly CommerceProductVariant[] {
  return Object.freeze(product.available ? catalogVisibleVariants(product).filter(variant => variant.available) : []);
}

export function catalogVariantSizes(variant: CommerceProductVariant): readonly string[] {
  const sizes = variant.sizeAvailability ? variant.sizeAvailability.filter(item => item.available !== false && item.availableQuantity > 0).map(item => item.size) : [...(variant.sizes ?? []), ...(variant.size ? [variant.size] : [])];
  return Object.freeze([...new Set(sizes.map(size => size.trim()).filter(Boolean))]);
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
  readonly availability?: CommerceAvailability;
  readonly selectionError?: "color-unavailable" | "size-unavailable" | "ambiguous-variant";
}

function exactCatalogMatch(products: readonly CommerceProductDetails[], query: string | undefined): CommerceProductDetails | undefined {
  const queryKey = normalizeCatalogValue(query ?? "");
  if (!queryKey) return undefined;
  const matches = products.filter(product => {
    const nameKey = normalizeCatalogValue(product.name);
    const idKey = normalizeCatalogValue(product.productId);
    return nameKey === queryKey || nameKey.endsWith(`-${queryKey}`) || idKey.endsWith(`-${queryKey}`);
  });
  return matches.length === 1 ? matches[0] : undefined;
}

export async function consultCatalog(port: CommercePort, context: CommerceRequestContext, input: { readonly query?: string; readonly productId?: string; readonly color?: string; readonly size?: string }): Promise<CatalogConsultation> {
  const products: CommerceProductDetails[] = [];
  const requestedColor = input.color;
  if (input.productId) {
    const product = await port.getProductDetails(context, { productId: input.productId });
    if (product) products.push(product);
  } else {
    const summaries = await port.searchProducts(context, { query: input.query || input.color || "", limit: 20 });
    if (!input.query && !requestedColor) {
      return Object.freeze({ kind: "catalog", products: Object.freeze(summaries.slice(0, 20)), ...(input.size ? { requestedSize: input.size } : {}) });
    }
    for (const summary of summaries.slice(0, 20)) {
      const product = await port.getProductDetails(context, { productId: summary.productId });
      if (product && (!requestedColor || catalogVisibleVariants(product).some(variant => normalizeCatalogValue(variant.color ?? "") === normalizeCatalogValue(requestedColor)))) products.push(product);
    }
  }
  const selectedProduct = products.length === 1 ? products[0] : exactCatalogMatch(products, input.query);
  if (!selectedProduct) return Object.freeze({ kind: "catalog", products: Object.freeze(products), ...(input.color ? { requestedColor: input.color } : {}), ...(input.size ? { requestedSize: input.size } : {}) });
  const variants = catalogVisibleVariants(selectedProduct);
  const matches = input.color ? variants.filter(variant => normalizeCatalogValue(variant.color ?? "") === normalizeCatalogValue(input.color ?? "")) : [];
  const sizedMatches = input.size ? matches.filter(variant => catalogVariantSizes(variant).some(size => normalizeCatalogValue(size) === normalizeCatalogValue(input.size ?? ""))) : matches;
  const selectionError = input.color && matches.length === 0 ? "color-unavailable" : input.size && input.color && sizedMatches.length === 0 ? "size-unavailable" : sizedMatches.length > 1 && !input.size ? "ambiguous-variant" : undefined;
  const selectedVariant = sizedMatches.length === 1 ? sizedMatches[0] : matches.length > 1 && !input.size && matches[0] ? Object.freeze({ ...matches[0], sizes: Object.freeze([...new Set(matches.flatMap(catalogVariantSizes))]), availableQuantity: matches.every(item => typeof item.availableQuantity === "number") ? matches.reduce((sum, item) => sum + (item.availableQuantity ?? 0), 0) : undefined }) : undefined;
  const availability = input.size && selectedVariant ? await port.checkAvailability(context, { productId: selectedProduct.productId, variantId: selectedVariant.variantId, size: input.size, quantity: 1 }) : undefined;
  return Object.freeze({ kind: "catalog", products: Object.freeze(products), selectedProduct, ...(selectedVariant ? { selectedVariant } : {}), ...(input.color ? { requestedColor: input.color } : {}), ...(input.size ? { requestedSize: input.size } : {}), ...(input.size && selectedVariant ? { selectedSize: input.size } : {}), ...(availability ? { availability } : {}), ...(selectionError ? { selectionError } : {}) });
}

const stringSchema = Object.freeze({ type: "string", minLength: 1 });
function descriptor(id: string, description: string, tenantId: string, assistantId: string, properties: NonNullable<ToolDefinition["descriptor"]["inputSchema"]["properties"]>, required: readonly string[], riskLevel: "safe" | "medium" = "safe"): ToolDefinition["descriptor"] {
  return Object.freeze({ id, name: id, description, version: "1.0.0", category: "business", riskLevel, inputSchema: Object.freeze({ type: "object", additionalProperties: false, properties: Object.freeze(properties), required: Object.freeze(required) }), outputSchema: Object.freeze({ type: "object" }), requiredPermissions: Object.freeze(["tools:execute"]), confirmationPolicy: "never", timeoutMs: 30_000, enabled: true, tenantId, assistantId, tags: Object.freeze(["commerce", "authoritative-catalog", "tenant-scoped"]) });
}

export function createCatalogTools(port: CommercePort & Partial<CommerceSupervisorPort>, tenantId: string, assistantId: string): readonly ToolDefinition[] {
  return Object.freeze([
    {
      descriptor: descriptor(CATALOG_TOOL_IDS.consultCatalog, "Consulta modelos reales, colores activos, tallas, imágenes, guía y notas comerciales desde Chopify. No inventa variantes.", tenantId, assistantId, { query: { type: "string" }, productId: stringSchema, color: stringSchema, size: stringSchema }, []),
      handler: { async execute(args, context) {
        return consultCatalog(port, contextFor(context, tenantId, assistantId, "consultCatalog"), { query: text(args.query), productId: text(args.productId), color: text(args.color), size: text(args.size) });
      } },
    },
    {
      descriptor: descriptor(CATALOG_TOOL_IDS.prepareCustomerOrder, "Crea cliente, oportunidad y borrador únicamente con productos, variantes, tallas, precios y disponibilidad revalidados. No confirma pagos.", tenantId, assistantId, { productId: stringSchema, variantId: stringSchema, size: stringSchema, quantity: { type: "integer", minimum: 1, maximum: 100 }, items: { type: "array", items: { type: "object", additionalProperties: false, properties: { productId: stringSchema, variantId: stringSchema, size: stringSchema, quantity: { type: "integer", minimum: 1, maximum: 100 }, color: stringSchema, name: stringSchema }, required: ["productId", "variantId", "size", "quantity"] } }, customerId: stringSchema, name: stringSchema, phone: stringSchema, channel: stringSchema, source: stringSchema, campaignId: stringSchema }, ["productId", "variantId", "size", "quantity"], "medium"),
      handler: { async execute(args, context) {
        let stage = "context";
        try {
          const base = contextFor(context, tenantId, assistantId, "prepareCustomerOrder");
          const sourceItems = Array.isArray(args.items) ? args.items : [args];
          if (sourceItems.length < 1 || sourceItems.length > 20) throw new Error("Invalid order item count.");
          const verifiedItems: Array<{ productId: string; variantId: string; size: string; quantity: number; product: CommerceProductDetails; variant: CommerceProductVariant }> = [];
          for (const [index, rawItem] of sourceItems.entries()) {
            const item = rawItem && typeof rawItem === "object" && !Array.isArray(rawItem) ? rawItem as Record<string, unknown> : {};
            const productId = text(item.productId) ?? "";
            const variantId = text(item.variantId) ?? "";
            const size = text(item.size) ?? "";
            const quantity = typeof item.quantity === "number" ? item.quantity : 0;
            if (!productId || !variantId || !size || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw new Error("Invalid order line.");
            stage = `load-product-${index + 1}`;
            const product = await port.getProductDetails(base, { productId });
            const variant = product && availableCatalogVariants(product).find(value => value.variantId === variantId);
            if (!product || !variant || !catalogVariantSizes(variant).some(value => normalizeCatalogValue(value) === normalizeCatalogValue(size))) throw new Error("The selected product, variant or size is unavailable.");
            stage = `validate-price-${index + 1}`;
            const price = variant.promotionalPrice ?? variant.price ?? product.promotionalPrice ?? product.price;
            if (!price || !Number.isFinite(price.amount) || price.amount <= 0 || typeof price.currency !== "string" || !price.currency.trim() || variant.pricingStatus === "PENDING" || (!variant.price && product.pricingStatus === "PENDING")) throw new Error("The selected price requires human confirmation.");
            stage = `check-availability-${index + 1}`;
            const availability = await port.checkAvailability(base, { productId, variantId, size, quantity });
            if (!availability.available || !Number.isFinite(availability.availableQuantity) || (availability.availableQuantity ?? 0) < quantity) {
              console.error("[FLOES Commerce] order-availability-rejected", {
                productId,
                variantId,
                size,
                quantity,
                available: availability.available,
                ...(typeof availability.availableQuantity === "number" ? { availableQuantity: availability.availableQuantity } : {}),
                ...(typeof availability.reason === "string" ? { reason: availability.reason } : {}),
              });
              throw new Error("The requested quantity is unavailable.");
            }
            verifiedItems.push({ productId, variantId, size, quantity, product, variant });
          }
          const customerId = scopedCustomerId(context, args.customerId);
          const phone = text(args.phone);
          if (!customerId && !phone) throw new Error("Customer identity is required before creating an order.");
          stage = "resolve-customer";
          const customer = await port.createOrUpdateCustomer({ ...base, idempotencyKey: `${base.idempotencyKey}:customer` }, { customerId, name: text(args.name), phone, channel: text(args.channel) });
          stage = "create-opportunity";
          const opportunity = await port.createOpportunity({ ...base, idempotencyKey: `${base.idempotencyKey}:opportunity` }, { customerId: customer.customerId, title: verifiedItems.map(item => `${item.product.name} · ${item.variant.color ?? item.variant.name} · ${item.size}`).join("; ").slice(0, 240), source: text(args.source), campaignId: text(args.campaignId), productIds: Object.freeze([...new Set(verifiedItems.map(item => item.productId))]) });
          stage = "create-order-draft";
          const order = await port.createOrderDraft({ ...base, idempotencyKey: `${base.idempotencyKey}:draft` }, { customerId: customer.customerId, opportunityId: opportunity.opportunityId, lines: Object.freeze(verifiedItems.map(({ productId, variantId, size, quantity }) => Object.freeze({ productId, variantId, size, quantity }))) });
          const items = Object.freeze(verifiedItems.map(({ product, variant, size, quantity }) => Object.freeze({ product, variant, size, quantity })));
          const firstItem = items[0];
          return Object.freeze({ kind: "order-draft", customerId: customer.customerId, opportunityId: opportunity.opportunityId, order, items, ...(items.length === 1 && firstItem ? { selectedProduct: firstItem.product, selectedVariant: firstItem.variant, selectedSize: firstItem.size, quantity: firstItem.quantity } : {}) });
        } catch (error) {
          const details = error && typeof error === "object" ? error as { name?: unknown; status?: unknown; code?: unknown } : {};
          console.error("[FLOES Commerce] order-preparation-failed", {
            stage,
            ...(typeof details.name === "string" ? { name: details.name } : {}),
            ...(typeof details.status === "number" ? { status: details.status } : {}),
            ...(typeof details.code === "string" && /^[A-Z0-9_]{1,80}$/.test(details.code) ? { code: details.code } : {}),
            ...(error instanceof Error && error.message === "The selected product, variant or size is unavailable." ? { reason: "catalog-selection-invalid" } : {}),
            ...(error instanceof Error && error.message === "The selected price requires human confirmation." ? { reason: "price-unconfirmed" } : {}),
            ...(error instanceof Error && error.message === "The requested quantity is unavailable." ? { reason: "inventory-unavailable" } : {}),
            ...(error instanceof Error && error.message === "Customer identity is required before creating an order." ? { reason: "customer-identity-missing" } : {}),
          });
          throw error;
        }
      } },
    },
    ...(port.updateOrderDelivery ? [{
      descriptor: descriptor(CATALOG_TOOL_IDS.updateOrderDelivery, "Recoge únicamente datos de entrega faltantes y guarda Servientrega, retiro o entrega presencial del propio cliente. No cambia el estado de despacho.", tenantId, assistantId, { orderId: stringSchema, customerId: stringSchema, deliveryMode: { type: "string" as const, enum: ["SERVIENTREGA", "PICKUP", "LOCAL_DELIVERY"] }, deliveryAddress: { type: "object" as const, additionalProperties: false, properties: { name: stringSchema, phone: stringSchema, city: stringSchema, province: stringSchema, address: stringSchema, reference: stringSchema } } }, ["orderId", "customerId", "deliveryMode"], "medium"),
      handler: { async execute(args: Readonly<Record<string, unknown>>, context: ToolExecutionContext) {
        const c = contextFor(context, tenantId, assistantId, "updateOrderDelivery");
        const orderId = text(args.orderId) ?? ""; const customerId = scopedCustomerId(context, args.customerId) ?? "";
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
        const orderId = text(args.orderId) ?? ""; const customerId = scopedCustomerId(context, args.customerId) ?? ""; const outcome = text(args.outcome);
        if (outcome !== "RECEIVED" && outcome !== "SATISFIED" && outcome !== "ISSUE" && outcome !== "HUMAN_REQUESTED") throw new Error("Invalid follow-up outcome.");
        const order = await port.getOrderStatus(c, { orderId });
        if (!order || order.customerId !== customerId || order.status !== "delivered") throw new Error("Follow-up requires the customer's delivered order.");
        if (!port.recordOrderFollowUp) throw new Error("Follow-up operation is unavailable.");
        const snapshot = await port.recordOrderFollowUp(c, { orderId, customerId, outcome, note: text(args.note) });
        const escalation = (outcome === "ISSUE" || outcome === "HUMAN_REQUESTED") && port.requestHumanEscalation
          ? await port.requestHumanEscalation({ ...c, conversationId: c.originConversationId ?? c.conversationId, idempotencyKey: `${c.idempotencyKey}:escalation` }, { reason: outcome === "ISSUE" ? "COMPLAINT" : "CUSTOMER_REQUEST", priority: "NORMAL", contextSummary: text(args.note)?.slice(0, 500), orderId })
          : undefined;
        return Object.freeze({ kind: "order-follow-up", outcome, order: snapshot, ...(escalation ? { escalation } : {}) });
      } },
    }] : []),
  ]);
}
