import type { AIUnknownRecord } from "@gano-bot/ai-core";
import type {
  ToolDefinition,
  ToolExecutionContext,
} from "@gano-bot/ai-core/tools-engine";
import type {
  CommerceMoney,
  CommerceOrderDraftLineInput,
  CommercePort,
  CommerceRequestContext,
} from "./contracts.js";

export const COMMERCE_TOOL_IDS = Object.freeze({
  searchProducts: "commerce.searchProducts",
  getProductDetails: "commerce.getProductDetails",
  checkAvailability: "commerce.checkAvailability",
  createOrUpdateCustomer: "commerce.createOrUpdateCustomer",
  createOpportunity: "commerce.createOpportunity",
  createOrderDraft: "commerce.createOrderDraft",
  attachPaymentProof: "commerce.attachPaymentProof",
  getOrderStatus: "commerce.getOrderStatus",
} as const);

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function commerceContext(
  context: ToolExecutionContext,
  toolId: string,
): CommerceRequestContext {
  return Object.freeze({
    tenantId: context.tenantId,
    assistantId: context.assistantId,
    actorId: context.actorId,
    conversationId: context.conversationId,
    requestId: context.requestId,
    correlationId: context.correlationId,
    idempotencyKey:
      stringValue(context.metadata?.idempotencyKey) ??
      `${context.tenantId}:${context.requestId}:${toolId}`,
    signal: context.signal,
  });
}

function descriptor(
  id: string,
  description: string,
  tenantId: string,
  assistantId: string,
  inputSchema: ToolDefinition["descriptor"]["inputSchema"],
  riskLevel: ToolDefinition["descriptor"]["riskLevel"] = "safe",
): ToolDefinition["descriptor"] {
  return Object.freeze({
    id,
    name: id,
    description,
    version: "1.0.0",
    category: "business",
    riskLevel,
    inputSchema,
    outputSchema: Object.freeze({ type: "object" }),
    requiredPermissions: Object.freeze(["tools:execute"]),
    confirmationPolicy: "never",
    timeoutMs: 5_000,
    enabled: true,
    tenantId,
    assistantId,
    tags: Object.freeze(["commerce", "chopify-ready", "tenant-scoped"]),
  });
}

const stringSchema = Object.freeze({ type: "string", minLength: 1 });
const numberSchema = Object.freeze({ type: "number", minimum: 0 });

export function createCommerceTools(
  port: CommercePort,
  tenantId: string,
  assistantId: string,
): readonly ToolDefinition[] {
  return Object.freeze([
    {
      descriptor: descriptor(
        COMMERCE_TOOL_IDS.searchProducts,
        "Busca productos reales del catálogo comercial autorizado para el tenant.",
        tenantId,
        assistantId,
        Object.freeze({
          type: "object",
          additionalProperties: false,
          required: Object.freeze(["query"]),
          properties: Object.freeze({
            query: stringSchema,
            limit: Object.freeze({ type: "number", minimum: 1, maximum: 20 }),
          }),
        }),
      ),
      handler: {
        async execute(args, context) {
          return port.searchProducts(
            commerceContext(context, COMMERCE_TOOL_IDS.searchProducts),
            { query: stringValue(args.query) ?? "", limit: numberValue(args.limit) },
          );
        },
      },
    },
    {
      descriptor: descriptor(
        COMMERCE_TOOL_IDS.getProductDetails,
        "Obtiene detalles y precio vigente de un producto real.",
        tenantId,
        assistantId,
        Object.freeze({
          type: "object",
          additionalProperties: false,
          required: Object.freeze(["productId"]),
          properties: Object.freeze({ productId: stringSchema }),
        }),
      ),
      handler: {
        async execute(args, context) {
          return port.getProductDetails(
            commerceContext(context, COMMERCE_TOOL_IDS.getProductDetails),
            { productId: stringValue(args.productId) ?? "" },
          );
        },
      },
    },
    {
      descriptor: descriptor(
        COMMERCE_TOOL_IDS.checkAvailability,
        "Consulta disponibilidad real sin modificar inventario.",
        tenantId,
        assistantId,
        Object.freeze({
          type: "object",
          additionalProperties: false,
          required: Object.freeze(["productId"]),
          properties: Object.freeze({
            productId: stringSchema,
            variantId: stringSchema,
            quantity: Object.freeze({ type: "number", minimum: 1 }),
          }),
        }),
      ),
      handler: {
        async execute(args, context) {
          return port.checkAvailability(
            commerceContext(context, COMMERCE_TOOL_IDS.checkAvailability),
            {
              productId: stringValue(args.productId) ?? "",
              variantId: stringValue(args.variantId),
              quantity: numberValue(args.quantity),
            },
          );
        },
      },
    },
    {
      descriptor: descriptor(
        COMMERCE_TOOL_IDS.createOrUpdateCustomer,
        "Crea o actualiza el cliente dentro del sistema comercial autorizado.",
        tenantId,
        assistantId,
        Object.freeze({
          type: "object",
          additionalProperties: false,
          properties: Object.freeze({
            customerId: stringSchema,
            name: stringSchema,
            phone: stringSchema,
            email: stringSchema,
            channel: stringSchema,
            externalIdentity: stringSchema,
          }),
        }),
        "low",
      ),
      handler: {
        async execute(args, context) {
          return port.createOrUpdateCustomer(
            commerceContext(context, COMMERCE_TOOL_IDS.createOrUpdateCustomer),
            {
              customerId: stringValue(args.customerId),
              name: stringValue(args.name),
              phone: stringValue(args.phone),
              email: stringValue(args.email),
              channel: stringValue(args.channel),
              externalIdentity: stringValue(args.externalIdentity),
            },
          );
        },
      },
    },
    {
      descriptor: descriptor(
        COMMERCE_TOOL_IDS.createOpportunity,
        "Registra una oportunidad comercial atribuible a cliente, fuente y campaña.",
        tenantId,
        assistantId,
        Object.freeze({
          type: "object",
          additionalProperties: false,
          required: Object.freeze(["customerId", "title"]),
          properties: Object.freeze({
            customerId: stringSchema,
            title: stringSchema,
            source: stringSchema,
            campaignId: stringSchema,
            productIds: Object.freeze({ type: "array", items: stringSchema }),
            notes: stringSchema,
          }),
        }),
        "low",
      ),
      handler: {
        async execute(args, context) {
          return port.createOpportunity(
            commerceContext(context, COMMERCE_TOOL_IDS.createOpportunity),
            {
              customerId: stringValue(args.customerId) ?? "",
              title: stringValue(args.title) ?? "",
              source: stringValue(args.source),
              campaignId: stringValue(args.campaignId),
              productIds: Array.isArray(args.productIds)
                ? Object.freeze(args.productIds.filter((v): v is string => typeof v === "string"))
                : undefined,
              notes: stringValue(args.notes),
            },
          );
        },
      },
    },
    {
      descriptor: descriptor(
        COMMERCE_TOOL_IDS.createOrderDraft,
        "Crea un borrador de pedido. No confirma pago ni descuenta inventario directamente.",
        tenantId,
        assistantId,
        Object.freeze({
          type: "object",
          additionalProperties: false,
          required: Object.freeze(["customerId", "lines"]),
          properties: Object.freeze({
            customerId: stringSchema,
            opportunityId: stringSchema,
            lines: Object.freeze({
              type: "array",
              items: Object.freeze({
                type: "object",
                additionalProperties: false,
                required: Object.freeze(["productId", "quantity"]),
                properties: Object.freeze({
                  productId: stringSchema,
                  variantId: stringSchema,
                  quantity: Object.freeze({ type: "number", minimum: 1 }),
                }),
              }),
            }),
            notes: stringSchema,
          }),
        }),
        "medium",
      ),
      handler: {
        async execute(args, context) {
          const lines: CommerceOrderDraftLineInput[] = Array.isArray(args.lines)
            ? args.lines.flatMap((line) => {
                if (typeof line !== "object" || line === null || Array.isArray(line)) return [];
                const record = line as AIUnknownRecord;
                const productId = stringValue(record.productId);
                const quantity = numberValue(record.quantity);
                if (!productId || quantity === undefined) return [];
                return [{
                  productId,
                  variantId: stringValue(record.variantId),
                  quantity,
                }];
              })
            : [];
          return port.createOrderDraft(
            commerceContext(context, COMMERCE_TOOL_IDS.createOrderDraft),
            {
              customerId: stringValue(args.customerId) ?? "",
              opportunityId: stringValue(args.opportunityId),
              lines: Object.freeze(lines),
              notes: stringValue(args.notes),
            },
          );
        },
      },
    },
    {
      descriptor: descriptor(
        COMMERCE_TOOL_IDS.attachPaymentProof,
        "Adjunta un comprobante al pedido y lo deja pendiente de revisión humana. Nunca confirma el pago.",
        tenantId,
        assistantId,
        Object.freeze({
          type: "object",
          additionalProperties: false,
          required: Object.freeze(["orderId"]),
          properties: Object.freeze({
            orderId: stringSchema,
            proofUrl: stringSchema,
            externalReference: stringSchema,
            amount: Object.freeze({
              type: "object",
              additionalProperties: false,
              required: Object.freeze(["amount", "currency"]),
              properties: Object.freeze({
                amount: numberSchema,
                currency: stringSchema,
              }),
            }),
            notes: stringSchema,
          }),
        }),
        "medium",
      ),
      handler: {
        async execute(args, context) {
          let amount: CommerceMoney | undefined;
          if (typeof args.amount === "object" && args.amount !== null && !Array.isArray(args.amount)) {
            const record = args.amount as AIUnknownRecord;
            const value = numberValue(record.amount);
            const currency = stringValue(record.currency);
            if (value !== undefined && currency) amount = { amount: value, currency };
          }
          return port.attachPaymentProof(
            commerceContext(context, COMMERCE_TOOL_IDS.attachPaymentProof),
            {
              orderId: stringValue(args.orderId) ?? "",
              proofUrl: stringValue(args.proofUrl),
              externalReference: stringValue(args.externalReference),
              amount,
              notes: stringValue(args.notes),
            },
          );
        },
      },
    },
    {
      descriptor: descriptor(
        COMMERCE_TOOL_IDS.getOrderStatus,
        "Consulta el estado real del pedido, pago y fulfillment.",
        tenantId,
        assistantId,
        Object.freeze({
          type: "object",
          additionalProperties: false,
          required: Object.freeze(["orderId"]),
          properties: Object.freeze({ orderId: stringSchema }),
        }),
      ),
      handler: {
        async execute(args, context) {
          return port.getOrderStatus(
            commerceContext(context, COMMERCE_TOOL_IDS.getOrderStatus),
            { orderId: stringValue(args.orderId) ?? "" },
          );
        },
      },
    },
  ]);
}
