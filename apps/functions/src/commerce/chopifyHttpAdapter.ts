import type {
  CommercePort,
  CommerceRequestContext,
  CommerceProductSummary,
  CommerceProductDetails,
  CommerceAvailability,
  CommerceCustomerInput,
  CommerceCustomer,
  CommerceOpportunityInput,
  CommerceOpportunity,
  CommerceOrderDraftInput,
  CommerceOrderDraft,
  CommercePaymentProofInput,
  CommercePaymentProof,
  CommerceOrderSnapshot,
} from './contracts.js'

import type {
  CommerceEscalationInput,
  CommerceEscalationResult,
  CommerceSupervisorPort,
} from './supervisor.js'

export interface ChopifyHttpAdapterConfig {
  readonly baseUrl: string
  readonly bearerToken: string
  readonly timeoutMs?: number
  readonly fetchImpl?: typeof fetch
}

interface Envelope<T> {
  ok: boolean
  data?: T
  error?: string
}

export class ChopifyHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ChopifyHttpError'
  }
}

export class ChopifyHttpAdapter
  implements CommercePort, CommerceSupervisorPort
{
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(
    private readonly config: ChopifyHttpAdapterConfig,
  ) {
    if (!/^https:\/\//i.test(config.baseUrl)) {
      throw new Error('Chopify baseUrl must use HTTPS')
    }

    if (!config.bearerToken.trim()) {
      throw new Error('Chopify bearer token is required')
    }

    this.fetchImpl = config.fetchImpl ?? fetch
    this.timeoutMs = config.timeoutMs ?? 8000
  }

  private async call<T>(
    context: CommerceRequestContext,
    operation: string,
    input: unknown,
  ): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(),
      this.timeoutMs,
    )

    const abort = () => controller.abort()

    context.signal?.addEventListener(
      'abort',
      abort,
      { once: true },
    )

    try {
      const response = await this.fetchImpl(
        `${this.config.baseUrl.replace(/\/$/, '')}/api/commerce`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.config.bearerToken}`,
            'x-chopify-tenant-id': context.tenantId,
            'x-request-id': context.requestId,
            'x-correlation-id': context.correlationId,
          },
          body: JSON.stringify({
            operation,
            input,
            idempotencyKey: context.idempotencyKey,
          }),
          signal: controller.signal,
        },
      )

      const body = await response
        .json()
        .catch(() => ({
          ok: false,
          error: 'Invalid JSON from Chopify',
        })) as Envelope<T>

      if (!response.ok || !body.ok) {
        throw new ChopifyHttpError(
          response.status,
          body.error ??
            `Chopify request failed (${response.status})`,
        )
      }

      return body.data as T
    } finally {
      clearTimeout(timer)

      context.signal?.removeEventListener(
        'abort',
        abort,
      )
    }
  }

  searchProducts(
    context: CommerceRequestContext,
    input: {
      readonly query: string
      readonly limit?: number
    },
  ) {
    return this.call<readonly CommerceProductSummary[]>(
      context,
      'searchProducts',
      input,
    )
  }

  getProductDetails(
    context: CommerceRequestContext,
    input: {
      readonly productId: string
    },
  ) {
    return this.call<CommerceProductDetails | undefined>(
      context,
      'getProductDetails',
      input,
    )
  }

  checkAvailability(
    context: CommerceRequestContext,
    input: {
      readonly productId: string
      readonly variantId?: string
      readonly quantity?: number
    },
  ) {
    return this.call<CommerceAvailability>(
      context,
      'checkAvailability',
      input,
    )
  }

  createOrUpdateCustomer(
    context: CommerceRequestContext,
    input: CommerceCustomerInput,
  ) {
    return this.call<CommerceCustomer>(
      context,
      'createOrUpdateCustomer',
      input,
    )
  }

  createOpportunity(
    context: CommerceRequestContext,
    input: CommerceOpportunityInput,
  ) {
    return this.call<CommerceOpportunity>(
      context,
      'createOpportunity',
      input,
    )
  }

  createOrderDraft(
    context: CommerceRequestContext,
    input: CommerceOrderDraftInput,
  ) {
    return this.call<CommerceOrderDraft>(
      context,
      'createOrderDraft',
      input,
    )
  }

  attachPaymentProof(
    context: CommerceRequestContext,
    input: CommercePaymentProofInput,
  ) {
    return this.call<CommercePaymentProof>(
      context,
      'attachPaymentProof',
      input,
    )
  }

  getOrderStatus(
    context: CommerceRequestContext,
    input: {
      readonly orderId: string
    },
  ) {
    return this.call<CommerceOrderSnapshot | undefined>(
      context,
      'getOrderStatus',
      input,
    )
  }

  requestHumanEscalation(
    context: CommerceRequestContext,
    input: CommerceEscalationInput,
  ) {
    return this.call<CommerceEscalationResult>(
      context,
      'requestHumanEscalation',
      {
        ...input,

        // La conversación proviene del contexto confiable
        // de ejecución, no de argumentos controlados
        // directamente por el modelo.
        conversationId: context.conversationId,
      },
    )
  }
}

export function createChopifyHttpAdapterFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ChopifyHttpAdapter {
  const baseUrl =
    env.CHOPIFY_COMMERCE_BASE_URL?.trim()

  const bearerToken =
    env.CHOPIFY_COMMERCE_API_TOKEN?.trim()

  if (!baseUrl) {
    throw new Error(
      'CHOPIFY_COMMERCE_BASE_URL is required',
    )
  }

  if (!bearerToken) {
    throw new Error(
      'CHOPIFY_COMMERCE_API_TOKEN is required',
    )
  }

  return new ChopifyHttpAdapter({
    baseUrl,
    bearerToken,
    timeoutMs:
      env.CHOPIFY_COMMERCE_TIMEOUT_MS
        ? Number(
            env.CHOPIFY_COMMERCE_TIMEOUT_MS,
          )
        : undefined,
  })
}