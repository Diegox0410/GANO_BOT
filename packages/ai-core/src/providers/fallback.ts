/**
 * @package @gano-bot/ai-core
 * @file providers/fallback.ts
 * @version 1.0.0
 *
 * Proveedor compuesto de embeddings con estrategia de respaldo.
 *
 * Responsabilidades:
 * - Ejecutar proveedores en orden de prioridad.
 * - Continuar con el siguiente proveedor cuando el anterior falla.
 * - Respetar solicitudes canceladas.
 * - Conservar la respuesta original del proveedor exitoso.
 * - Exponer información detallada cuando todos los proveedores fallan.
 */

import type {
  AIEmbeddingProvider,
  AIEmbeddingRequest,
  AIEmbeddingResponse,
} from "../types";

/* ============================================================================
 * TIPOS PÚBLICOS
 * ========================================================================== */

/**
 * Identificador de una entrada dentro de la cadena de respaldo.
 */
export type FallbackEmbeddingProviderId =
  string;

/**
 * Proveedor disponible dentro de la cadena.
 */
export interface FallbackEmbeddingProviderEntry {
  /**
   * Identificador único y legible.
   *
   * Ejemplos:
   * - openai
   * - gemini
   * - local
   */
  readonly id:
    FallbackEmbeddingProviderId;

  /**
   * Proveedor que realizará la solicitud.
   */
  readonly provider:
    AIEmbeddingProvider;

  /**
   * Indica si esta entrada está habilitada.
   *
   * Valor predeterminado: true.
   */
  readonly enabled?:
    boolean;
}

/**
 * Información de un intento fallido.
 */
export interface FallbackEmbeddingProviderFailure {
  /**
   * Identificador del proveedor que falló.
   */
  readonly providerId:
    FallbackEmbeddingProviderId;

  /**
   * Posición del proveedor dentro de la cadena.
   */
  readonly attempt:
    number;

  /**
   * Error original.
   */
  readonly error:
    unknown;
}

/**
 * Función que determina si debe utilizarse el siguiente proveedor.
 */
export type FallbackEmbeddingRetryPredicate = (
  error: unknown,
  context: {
    readonly providerId:
      FallbackEmbeddingProviderId;

    readonly attempt:
      number;

    readonly remainingProviders:
      number;
  },
) => boolean;

/**
 * Configuración del proveedor compuesto.
 */
export interface FallbackEmbeddingProviderConfig {
  /**
   * Proveedores ordenados desde el principal hasta el último respaldo.
   */
  readonly providers:
    readonly FallbackEmbeddingProviderEntry[];

  /**
   * Función opcional para decidir si un error admite respaldo.
   *
   * Cuando no se proporciona, se intenta el siguiente proveedor
   * con cualquier error que no represente una cancelación.
   */
  readonly shouldFallback?:
    FallbackEmbeddingRetryPredicate;
}

/* ============================================================================
 * ERRORES
 * ========================================================================== */

export type FallbackEmbeddingProviderErrorCode =
  | "INVALID_CONFIGURATION"
  | "NO_ENABLED_PROVIDERS"
  | "REQUEST_CANCELLED"
  | "ALL_PROVIDERS_FAILED";

/**
 * Error producido por la cadena de respaldo.
 */
export class FallbackEmbeddingProviderError
  extends Error {
  public override readonly name =
    "FallbackEmbeddingProviderError";

  public constructor(
    public readonly code:
      FallbackEmbeddingProviderErrorCode,

    message:
      string,

    public readonly failures:
      readonly FallbackEmbeddingProviderFailure[] =
        [],

    public override readonly cause?:
      unknown,
  ) {
    super(
      message,
      cause === undefined
        ? undefined
        : {
            cause,
          },
    );
  }
}

/* ============================================================================
 * UTILIDADES
 * ========================================================================== */

function normalizeProviderId(
  value: string,
  index: number,
): string {
  const normalized =
    value.trim().toLowerCase();

  if (
    normalized.length === 0
  ) {
    throw new FallbackEmbeddingProviderError(
      "INVALID_CONFIGURATION",
      `El proveedor de respaldo en la posición ${index} no tiene un identificador válido.`,
    );
  }

  if (
    !/^[a-z0-9][a-z0-9._-]*$/.test(
      normalized,
    )
  ) {
    throw new FallbackEmbeddingProviderError(
      "INVALID_CONFIGURATION",
      [
        `El identificador "${value}" del proveedor en la posición ${index} no es válido.`,
        "Solo se permiten letras, números, puntos, guiones y guiones bajos.",
      ].join(" "),
    );
  }

  return normalized;
}

function isAbortLikeError(
  error: unknown,
): boolean {
  if (
    error instanceof DOMException &&
    error.name === "AbortError"
  ) {
    return true;
  }

  if (
    error instanceof Error
  ) {
    if (
      error.name === "AbortError"
    ) {
      return true;
    }

    const candidate =
      error as Error & {
        readonly code?: unknown;
      };

    return (
      candidate.code ===
        "REQUEST_CANCELLED" ||
      candidate.code ===
        "ABORTED"
    );
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error
  ) {
    const code =
      (
        error as {
          readonly code?: unknown;
        }
      ).code;

    return (
      code ===
        "REQUEST_CANCELLED" ||
      code ===
        "ABORTED"
    );
  }

  return false;
}

function throwIfAborted(
  signal:
    AbortSignal | undefined,
): void {
  if (
    signal?.aborted !== true
  ) {
    return;
  }

  throw new FallbackEmbeddingProviderError(
    "REQUEST_CANCELLED",
    "La solicitud de embeddings fue cancelada.",
  );
}

function freezeFailure(
  failure:
    FallbackEmbeddingProviderFailure,
): FallbackEmbeddingProviderFailure {
  return Object.freeze({
    providerId:
      failure.providerId,

    attempt:
      failure.attempt,

    error:
      failure.error,
  });
}

function freezeFailures(
  failures:
    readonly FallbackEmbeddingProviderFailure[],
): readonly FallbackEmbeddingProviderFailure[] {
  return Object.freeze(
    failures.map(
      freezeFailure,
    ),
  );
}

interface ResolvedFallbackProviderEntry {
  readonly id:
    FallbackEmbeddingProviderId;

  readonly provider:
    AIEmbeddingProvider;
}

function resolveProviders(
  entries:
    readonly FallbackEmbeddingProviderEntry[],
): readonly ResolvedFallbackProviderEntry[] {
  if (
    entries.length === 0
  ) {
    throw new FallbackEmbeddingProviderError(
      "INVALID_CONFIGURATION",
      "La cadena de respaldo debe contener al menos un proveedor.",
    );
  }

  const usedIds =
    new Set<string>();

  const providers:
    ResolvedFallbackProviderEntry[] =
      [];

  entries.forEach(
    (
      entry,
      index,
    ) => {
      if (
        entry.enabled === false
      ) {
        return;
      }

      const id =
        normalizeProviderId(
          entry.id,
          index,
        );

      if (
        usedIds.has(id)
      ) {
        throw new FallbackEmbeddingProviderError(
          "INVALID_CONFIGURATION",
          `El proveedor "${id}" está duplicado en la cadena de respaldo.`,
        );
      }

      usedIds.add(id);

      providers.push(
        Object.freeze({
          id,
          provider:
            entry.provider,
        }),
      );
    },
  );

  if (
    providers.length === 0
  ) {
    throw new FallbackEmbeddingProviderError(
      "NO_ENABLED_PROVIDERS",
      "La cadena de respaldo no contiene proveedores habilitados.",
    );
  }

  return Object.freeze(
    providers,
  );
}

/* ============================================================================
 * IMPLEMENTACIÓN
 * ========================================================================== */

/**
 * Proveedor que intenta generar embeddings utilizando una cadena ordenada.
 */
export class FallbackEmbeddingProvider
  implements AIEmbeddingProvider {
  private readonly providers:
    readonly ResolvedFallbackProviderEntry[];

  private readonly shouldFallback:
    FallbackEmbeddingRetryPredicate;

  public constructor(
    config:
      FallbackEmbeddingProviderConfig,
  ) {
    this.providers =
      resolveProviders(
        config.providers,
      );

    this.shouldFallback =
      config.shouldFallback ??
      (() => true);
  }

  /**
   * Devuelve los identificadores de los proveedores habilitados,
   * conservando el orden de prioridad.
   */
  public listProviderIds():
    readonly FallbackEmbeddingProviderId[] {
    return Object.freeze(
      this.providers.map(
        (
          entry,
        ) =>
          entry.id,
      ),
    );
  }

  /**
   * Genera embeddings utilizando el primer proveedor exitoso.
   */
  public async embed(
    request:
      AIEmbeddingRequest,
  ): Promise<AIEmbeddingResponse> {
    throwIfAborted(
      request.signal,
    );

    const failures:
      FallbackEmbeddingProviderFailure[] =
        [];

    for (
      let index = 0;
      index <
      this.providers.length;
      index += 1
    ) {
      throwIfAborted(
        request.signal,
      );

      const entry =
        this.providers[index];

      if (
        entry === undefined
      ) {
        continue;
      }

      const attempt =
        index + 1;

      try {
        return await entry.provider.embed(
          request,
        );
      } catch (error) {
        if (
          request.signal?.aborted ===
            true ||
          isAbortLikeError(
            error,
          )
        ) {
          throw new FallbackEmbeddingProviderError(
            "REQUEST_CANCELLED",
            `La solicitud fue cancelada mientras se utilizaba el proveedor "${entry.id}".`,
            freezeFailures(
              failures,
            ),
            error,
          );
        }

        const failure:
          FallbackEmbeddingProviderFailure =
            freezeFailure({
              providerId:
                entry.id,

              attempt,

              error,
            });

        failures.push(
          failure,
        );

        const remainingProviders =
          this.providers.length -
          attempt;

        if (
          remainingProviders <= 0
        ) {
          break;
        }

        const continueWithFallback =
          this.shouldFallback(
            error,
            {
              providerId:
                entry.id,

              attempt,

              remainingProviders,
            },
          );

        if (
          !continueWithFallback
        ) {
          throw error;
        }
      }
    }

    const frozenFailures =
      freezeFailures(
        failures,
      );

    const lastFailure =
      frozenFailures[
        frozenFailures.length -
          1
      ];

    throw new FallbackEmbeddingProviderError(
      "ALL_PROVIDERS_FAILED",
      [
        "No fue posible generar embeddings.",
        `Fallaron ${frozenFailures.length} proveedor(es):`,
        frozenFailures
          .map(
            (
              failure,
            ) =>
              failure.providerId,
          )
          .join(", "),
      ].join(" "),
      frozenFailures,
      lastFailure?.error,
    );
  }
}

/* ============================================================================
 * FACTORÍA
 * ========================================================================== */

/**
 * Crea un proveedor compuesto con respaldo automático.
 */
export function createFallbackEmbeddingProvider(
  config:
    FallbackEmbeddingProviderConfig,
): AIEmbeddingProvider {
  return new FallbackEmbeddingProvider(
    config,
  );
}