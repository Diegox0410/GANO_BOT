export type CommerceCurrency = "USD" | string;

export interface CommerceRequestContext {
  readonly tenantId: string;
  readonly assistantId: string;
  readonly actorId: string;
  readonly conversationId: string;
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
  readonly price: CommerceMoney;
  readonly available: boolean;
  readonly imageUrl?: string;
  readonly category?: string;
}

export interface CommerceProductDetails extends CommerceProductSummary {
  readonly variants?: readonly CommerceProductVariant[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CommerceProductVariant {
  readonly variantId: string;
  readonly name: string;
  readonly sku?: string;
  readonly price?: CommerceMoney;
  readonly available: boolean;
  readonly availableQuantity?: number;
}

export interface CommerceAvailability {
  readonly productId: string;
  readonly variantId?: string;
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
}

export interface CommerceOrderDraftInput {
  readonly customerId: string;
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
  | "dispatched"
  | "delivered"
  | "cancelled";

export interface CommerceOrderSnapshot {
  readonly orderId: string;
  readonly status: CommerceOrderStatus;
  readonly paymentStatus?:
    | "unpaid"
    | "pending_review"
    | "approved"
    | "rejected";
  readonly fulfillmentStatus?:
    | "unfulfilled"
    | "preparing"
    | "dispatched"
    | "delivered";
  readonly total?: CommerceMoney;
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
    input: { readonly productId: string; readonly variantId?: string; readonly quantity?: number },
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
}
