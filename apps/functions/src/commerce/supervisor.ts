import type { CommerceRequestContext } from './contracts.js'
import type { ChopifyHttpAdapter } from './chopifyHttpAdapter.js'

export type CommerceEscalationReason =
  | 'CUSTOMER_REQUEST'
  | 'COMPLAINT'
  | 'PAYMENT_ISSUE'
  | 'PRICING_EXCEPTION'
  | 'STOCK_CONFLICT'
  | 'RETURN_REQUEST'
  | 'DELIVERY_ISSUE'
  | 'UNKNOWN_PRODUCT'
  | 'SYSTEM_ERROR'
  | 'OTHER'

export type CommerceEscalationPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'

export interface CommerceEscalationInput {
  readonly reason: CommerceEscalationReason
  readonly priority?: CommerceEscalationPriority
  readonly contextSummary?: string
  readonly orderId?: string
}

export interface CommerceEscalationResult {
  readonly escalationId: string
  readonly conversationId: string
  readonly status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED'
  readonly reason: CommerceEscalationReason
  readonly priority: CommerceEscalationPriority
}

export interface CommerceSupervisorPort {
  requestHumanEscalation(
    context: CommerceRequestContext,
    input: CommerceEscalationInput,
  ): Promise<CommerceEscalationResult>
}

export function createSupervisorPort(adapter: ChopifyHttpAdapter): CommerceSupervisorPort {
  return adapter
}
