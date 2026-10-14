export type CommerceCurrency = "USD" | string;

export interface CommerceRequestContext {
  readonly tenantId: string;
  readonly assistantId: string;
  readonly actorId: string;
  readonly conversationId: string;
  readonly originConversationId?: string;
  readonly customerId?: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
}

export interface CommerceMoney {
  readonly amount: number;
  readonly currency: CommerceCurrency;
}

export interface CommerceProductSummary {
  readonly productId: string;
  readonly name: string;
  readonly sku?: string;
  readonly description?: string;
  readonly price: CommerceMoney | null;
  readonly pricingStatus: "PENDING" | "READY";
  readonly available: boolean;
  readonly imageUrl?: string;
  readonly images?: readonly CommerceProductImage[];
  readonly category?: string;
  readonly fulfillmentMode?: string;
  readonly characteristics?: readonly string[];
  readonly material?: string;
  readonly collection?: string;
  readonly gender?: string;
  readonly promotionalPrice?: CommerceMoney | null;
  readonly ganoBotNotes?: string;
  readonly sizeGuide?: CommerceSizeGuide;
  readonly sizeRecommendation?: string;
  readonly exchangePolicy?: { readonly allowed: boolean | null; readonly conditions: string };
  readonly preparationTime?: string;
  readonly deliveryType?: string;
}

export interface CommerceSizeGuideRow {
  readonly size: string;
  readonly measurementsCm: Readonly<Record<string, number>>;
}

export interface CommerceSizeGuide {
  readonly measurement: "FLAT_GARMENT_CM";
  readonly instructions: string;
  readonly blouse?: readonly CommerceSizeGuideRow[];
  readonly trousers?: readonly CommerceSizeGuideRow[];
}

export interface CommerceProductDetails extends CommerceProductSummary {
  readonly variants?: readonly CommerceProductVariant[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CommerceProductVariant {
  readonly variantId: string;
  readonly name: string;
  readonly sku?: string;
  readonly color?: string | null;
  readonly price?: CommerceMoney | null;
  readonly pricingStatus?: "PENDING" | "READY";
  readonly available: boolean;
  readonly availableQuantity?: number;
  readonly regularPrice?: CommerceMoney | null;
  readonly images?: readonly CommerceProductImage[];
  readonly fulfillmentMode?: string;
  readonly imageUrl?: string;
  readonly active?: boolean;
  readonly size?: string;
  readonly sizes?: readonly string[];
  readonly sizeAvailability?: readonly {
    readonly size: string;
    readonly availableQuantity: number;
    readonly available?: boolean;
    readonly availabilityStatus?: string;
  }[];
  readonly promotionalPrice?: CommerceMoney | null;
}

export interface CommerceProductImage { readonly url: string; readonly alt: string }

export interface CommerceAvailability {
  readonly productId: string;
  readonly variantId?: string;
  readonly size?: string;
  readonly available: boolean;
  readonly availableQuantity?: number;
  readonly reason?: string;
}

export interface CommerceCustomerInput {
  readonly customerId?: string;
  readonly name?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly channel?: string;
  readonly externalIdentity?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CommerceCustomer {
  readonly customerId: string;
  readonly name?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly channel?: string;
  readonly externalIdentity?: string;
}

export type CommerceOpportunityStatus =
  | "new"
  | "qualified"
  | "in-progress"
  | "won"
  | "lost";

export interface CommerceOpportunityInput {
  readonly customerId: string;
  readonly conversationId?: string;
  readonly title: string;
  readonly source?: string;
  readonly campaignId?: string;
  readonly productIds?: readonly string[];
  readonly notes?: string;
}

export interface CommerceOpportunity {
  readonly opportunityId: string;
  readonly customerId: string;
  readonly status: CommerceOpportunityStatus;
}

export interface CommerceOrderDraftLineInput {
  readonly productId: string;
  readonly variantId?: string;
  readonly quantity: number;
  readonly size?: string;
}

export interface CommerceOrderDraftInput {
  readonly customerId: string;
  readonly conversationId?: string;
  readonly opportunityId?: string;
  readonly lines: readonly CommerceOrderDraftLineInput[];
  readonly notes?: string;
}

export interface CommerceOrderDraft {
  readonly orderId: string;
  readonly status: "draft";
  readonly customerId: string;
  readonly total?: CommerceMoney;
}

export interface CommercePaymentProofInput {
  readonly orderId: string;
  readonly customerId?: string;
  readonly conversationId?: string;
  readonly proofUrl?: string;
  readonly externalReference?: string;
  readonly amount?: CommerceMoney;
  readonly notes?: string;
}

export interface CommercePaymentProof {
  readonly proofId: string;
  readonly orderId: string;
  readonly status: "pending_review";
}

export type CommerceOrderStatus =
  | "draft"
  | "awaiting-payment"
  | "payment-under-review"
  | "paid"
  | "preparing"
  | "ready-for-dispatch"
  | "dispatched"
  | "delivered"
  | "cancelled";

export interface CommerceOrderSnapshot {
  readonly orderId: string;
  readonly conversationId?: string;
  readonly customerId?: string;
  readonly status: CommerceOrderStatus;
  readonly paymentStatus?:
    | "unpaid"
    | "pending_review"
    | "approved"
    | "rejected";
  readonly fulfillmentStatus?:
    | "unfulfilled"
    | "preparing"
    | "ready-for-dispatch"
    | "dispatched"
    | "delivered";
  readonly total?: CommerceMoney;
  readonly trackingCode?: string;
  readonly courier?: string;
  readonly deliveryMode?: string;
  readonly deliveryAddress?: Readonly<Record<string, unknown>>;
  readonly followUp?: Readonly<Record<string, unknown>>;
  readonly exchangePolicy?: { readonly allowed: boolean | null; readonly conditions: string };
}

export type CommerceDeliveryMode = "SERVIENTREGA" | "PICKUP" | "LOCAL_DELIVERY";
export interface CommerceDeliveryAddress {
  readonly name?: string;
  readonly phone?: string;
  readonly city?: string;
  readonly province?: string;
  readonly address?: string;
  readonly reference?: string;
}
export interface CommerceDeliveryInput {
  readonly orderId: string;
  readonly customerId: string;
  readonly deliveryMode: CommerceDeliveryMode;
  readonly deliveryAddress?: CommerceDeliveryAddress;
}
export interface CommerceFollowUpInput {
  readonly orderId: string;
  readonly customerId: string;
  readonly outcome: "RECEIVED" | "SATISFIED" | "ISSUE" | "HUMAN_REQUESTED";
  readonly note?: string;
}

export interface CommercePort {
  searchProducts(
    context: CommerceRequestContext,
    input: { readonly query: string; readonly limit?: number },
  ): Promise<readonly CommerceProductSummary[]>;

  getProductDetails(
    context: CommerceRequestContext,
    input: { readonly productId: string },
  ): Promise<CommerceProductDetails | undefined>;

  checkAvailability(
    context: CommerceRequestContext,
    input: { readonly productId: string; readonly variantId?: string; readonly size?: string; readonly quantity?: number },
  ): Promise<CommerceAvailability>;

  createOrUpdateCustomer(
    context: CommerceRequestContext,
    input: CommerceCustomerInput,
  ): Promise<CommerceCustomer>;

  createOpportunity(
    context: CommerceRequestContext,
    input: CommerceOpportunityInput,
  ): Promise<CommerceOpportunity>;

  createOrderDraft(
    context: CommerceRequestContext,
    input: CommerceOrderDraftInput,
  ): Promise<CommerceOrderDraft>;

  attachPaymentProof(
    context: CommerceRequestContext,
    input: CommercePaymentProofInput,
  ): Promise<CommercePaymentProof>;

  getOrderStatus(
    context: CommerceRequestContext,
    input: { readonly orderId: string },
  ): Promise<CommerceOrderSnapshot | undefined>;

  updateOrderDelivery?(context: CommerceRequestContext, input: CommerceDeliveryInput): Promise<CommerceOrderSnapshot>;
  recordOrderFollowUp?(context: CommerceRequestContext, input: CommerceFollowUpInput): Promise<CommerceOrderSnapshot>;
}
