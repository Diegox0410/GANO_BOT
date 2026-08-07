/** Proveedor compuesto que intenta proveedores habilitados en orden. */
import {
  AIChatProviderError,
  BaseAIChatProvider,
  isAIChatAbortError,
  throwIfAIChatAborted,
} from "./base.js";

import type { BaseAIChatProviderConfig } from "./base.js";
import type {
  AIChatGenerationResult,
  AIChatProvider,
  AIChatProviderDescriptor,
  AIChatRequest,
} from "./types.js";
import type { AIMetadata } from "../types.js";

export interface AIChatFallbackFailure {
  readonly providerId: string;
  readonly providerName: AIChatProvider["name"];
  readonly error: unknown;
}

export type AIChatFallbackFailureListener = (
  failure: AIChatFallbackFailure,
) => void | Promise<void>;

export interface FallbackAIChatProviderConfig {
  readonly providers: readonly AIChatProvider[];
  readonly id?: string;
  readonly displayName?: string;
  readonly lifecycleListeners?: BaseAIChatProviderConfig["lifecycleListeners"];
  readonly failureListeners?: readonly AIChatFallbackFailureListener[];
  readonly metadata?: AIMetadata;
}

interface ResolvedFallbackConfig {
  readonly providers: readonly AIChatProvider[];
  readonly failureListeners: readonly AIChatFallbackFailureListener[];
}

export class AIChatFallbackError extends AIChatProviderError {
  public constructor(
    public readonly failures: readonly AIChatFallbackFailure[],
    requestId: string,
  ) {
    super(
      "PROVIDER_ERROR",
      "Todos los proveedores conversacionales configurados fallaron.",
      {
        providerId: "fallback",
        requestId,
        retryable: failures.some((failure) => isRecoverableFailure(failure.error)),
        metadata: {
          failures: JSON.stringify(failures.map((failure) => ({
            providerId: failure.providerId,
            providerName: failure.providerName,
            errorCode: failure.error instanceof AIChatProviderError ? failure.error.code : "UNKNOWN",
          }))),
        },
      },
      failures.length > 0 ? failures[failures.length - 1]?.error : undefined,
    );
  }
}

function normalizeText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized !== undefined && normalized.length > 0 ? normalized : undefined;
}

function resolveConfig(config: FallbackAIChatProviderConfig): ResolvedFallbackConfig {
  const providers = config.providers.filter((provider) => provider.descriptor.enabled);
  if (providers.length === 0) {
    throw new AIChatProviderError(
      "INVALID_CONFIGURATION",
      "El fallback requiere al menos un proveedor conversacional habilitado.",
      { providerId: "fallback" },
    );
  }
  const ids = new Set<string>();
  for (const provider of providers) {
    if (ids.has(provider.descriptor.id)) {
      throw new AIChatProviderError(
        "INVALID_CONFIGURATION",
        `El proveedor "${provider.descriptor.id}" está repetido en el fallback.`,
        { providerId: "fallback" },
      );
    }
    ids.add(provider.descriptor.id);
  }
  return Object.freeze({
    providers: Object.freeze([...providers]),
    failureListeners: Object.freeze([...(config.failureListeners ?? [])]),
  });
}

function createDescriptor(config: FallbackAIChatProviderConfig): AIChatProviderDescriptor {
  const providers = config.providers.filter((provider) => provider.descriptor.enabled);
  const descriptor: {
    id: string;
    name: "custom";
    displayName: string;
    defaultModel?: string;
    capabilities: AIChatProviderDescriptor["capabilities"];
    enabled: boolean;
    metadata?: AIMetadata;
  } = {
    id: normalizeText(config.id) ?? "fallback",
    name: "custom",
    displayName: normalizeText(config.displayName) ?? "Fallback de chat",
    capabilities: Object.freeze({
      supportsStreaming: false,
      supportsTools: providers.some((provider) => provider.descriptor.capabilities.supportsTools),
      supportsJson: providers.some((provider) => provider.descriptor.capabilities.supportsJson),
      supportsMultimodal: providers.some((provider) => provider.descriptor.capabilities.supportsMultimodal),
      supportsSeed: providers.some((provider) => provider.descriptor.capabilities.supportsSeed),
    }),
    enabled: true,
  };
  const defaultModel = providers[0]?.descriptor.defaultModel;
  if (defaultModel !== undefined) descriptor.defaultModel = defaultModel;
  if (config.metadata !== undefined) descriptor.metadata = config.metadata;
  return Object.freeze(descriptor);
}

function isCancellation(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || isAIChatAbortError(error) || (
    error instanceof AIChatProviderError && error.code === "REQUEST_CANCELLED"
  );
}

function isRecoverableFailure(error: unknown): boolean {
  if (!(error instanceof AIChatProviderError)) return true;
  if (error.code === "REQUEST_CANCELLED") return false;
  if (error.details?.retryable !== undefined) return error.details.retryable;
  return error.code === "PROVIDER_ERROR" || error.code === "INVALID_PROVIDER_RESPONSE";
}

export class FallbackAIChatProvider extends BaseAIChatProvider {
  private readonly fallbackConfig: ResolvedFallbackConfig;

  public constructor(config: FallbackAIChatProviderConfig) {
    const resolved = resolveConfig(config);
    super({
      descriptor: createDescriptor(config),
      defaultModel: resolved.providers[0]?.descriptor.defaultModel,
      lifecycleListeners: config.lifecycleListeners,
    });
    this.fallbackConfig = resolved;
  }

  public listProviders(): readonly AIChatProvider[] {
    return this.fallbackConfig.providers;
  }

  protected async generateChatResponse(
    request: AIChatRequest,
    model: string,
  ): Promise<AIChatGenerationResult> {
    const failures: AIChatFallbackFailure[] = [];
    for (const provider of this.fallbackConfig.providers) {
      throwIfAIChatAborted(request.signal, {
        providerId: provider.descriptor.id,
        providerName: provider.descriptor.name,
        requestId: request.requestId,
        model,
      });
      try {
        const response = await provider.generate(request);
        const result: {
          provider: typeof response.provider;
          model: string;
          content: string;
          message: typeof response.message;
          toolCalls: typeof response.toolCalls;
          finishReason: typeof response.finishReason;
          usage?: typeof response.usage;
          raw: unknown;
          metadata?: typeof response.metadata;
        } = {
          provider: response.provider,
          model: response.model,
          content: response.content,
          message: response.message,
          toolCalls: response.toolCalls,
          finishReason: response.finishReason,
          raw: response.raw ?? response,
        };
        if (response.usage !== undefined) result.usage = response.usage;
        if (response.metadata !== undefined) result.metadata = response.metadata;
        return Object.freeze(result);
      } catch (error) {
        if (isCancellation(error, request.signal)) throw error;
        const failure = Object.freeze({
          providerId: provider.descriptor.id,
          providerName: provider.descriptor.name,
          error,
        });
        failures.push(failure);
        await this.emitFailure(failure);
        if (!isRecoverableFailure(error)) throw error;
      }
    }
    throw new AIChatFallbackError(Object.freeze(failures), request.requestId);
  }

  private async emitFailure(failure: AIChatFallbackFailure): Promise<void> {
    for (const listener of this.fallbackConfig.failureListeners) {
      try {
        await listener(failure);
      } catch {
        // La observabilidad no modifica el resultado del fallback.
      }
    }
  }
}

export function createFallbackAIChatProvider(
  config: FallbackAIChatProviderConfig,
): FallbackAIChatProvider {
  return new FallbackAIChatProvider(config);
}
