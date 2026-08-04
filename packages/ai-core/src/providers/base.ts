/**
 * @package @gano-bot/ai-core
 * @file providers/base.ts
 * @version 1.0.0
 *
 * Infraestructura base para proveedores de inteligencia artificial.
 *
 * Responsabilidades:
 * - Configuración compartida.
 * - Ejecución con reintentos.
 * - Timeouts.
 * - Cancelación mediante AbortSignal.
 * - Normalización de errores.
 * - Validación de respuestas HTTP.
 * - Lectura segura de JSON y texto.
 * - Cálculo de espera exponencial.
 *
 * Este archivo no depende directamente de:
 * - OpenAI
 * - Gemini
 * - Anthropic
 * - Azure OpenAI
 * - Ollama
 * - Firebase
 *
 * Los proveedores concretos deben extender BaseAIProvider.
 */

/* ============================================================================
 * TIPOS GENERALES
 * ========================================================================== */

export type AIProviderIdentifier =
  | "openai"
  | "gemini"
  | "anthropic"
  | "azure-openai"
  | "ollama"
  | "mistral"
  | "hugging-face"
  | "custom"
  | (string & {});

export type AIProviderOperation =
  | "chat"
  | "completion"
  | "embedding"
  | "reranking"
  | "moderation"
  | "models"
  | "health-check"
  | (string & {});

export type AIProviderErrorCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_REQUEST"
  | "AUTHENTICATION_ERROR"
  | "PERMISSION_DENIED"
  | "RESOURCE_NOT_FOUND"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "REQUEST_TIMEOUT"
  | "REQUEST_CANCELLED"
  | "NETWORK_ERROR"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_RESPONSE"
  | "UNSUPPORTED_OPERATION"
  | "PROVIDER_ERROR"
  | "UNKNOWN_ERROR";

/* ============================================================================
 * CONFIGURACIÓN
 * ========================================================================== */

export interface AIProviderRetryConfig {
  /**
   * Número máximo de intentos, incluyendo el intento inicial.
   *
   * Ejemplo:
   * maximumAttempts: 3
   *
   * significa:
   * - intento inicial
   * - primer reintento
   * - segundo reintento
   */
  readonly maximumAttempts?: number;

  /**
   * Tiempo inicial de espera antes del primer reintento.
   */
  readonly initialDelayMilliseconds?: number;

  /**
   * Tiempo máximo permitido entre reintentos.
   */
  readonly maximumDelayMilliseconds?: number;

  /**
   * Factor aplicado para aumentar progresivamente la espera.
   */
  readonly backoffMultiplier?: number;

  /**
   * Variación aleatoria aplicada al tiempo de espera.
   *
   * Debe estar entre 0 y 1.
   */
  readonly jitterRatio?: number;

  /**
   * Códigos HTTP que pueden generar un reintento.
   */
  readonly retryableStatusCodes?: readonly number[];
}

export interface BaseAIProviderConfig {
  /**
   * Identificador del proveedor.
   */
  readonly providerId: AIProviderIdentifier;

  /**
   * Nombre legible del proveedor.
   */
  readonly displayName?: string;

  /**
   * Clave de acceso al proveedor.
   */
  readonly apiKey?: string;

  /**
   * URL base de la API.
   */
  readonly baseUrl?: string;

  /**
   * Modelo predeterminado.
   */
  readonly defaultModel?: string;

  /**
   * Timeout general de cada solicitud.
   */
  readonly timeoutMilliseconds?: number;

  /**
   * Cabeceras que se incluirán en todas las solicitudes.
   */
  readonly defaultHeaders?: Readonly<
    Record<string, string>
  >;

  /**
   * Configuración de reintentos.
   */
  readonly retry?: AIProviderRetryConfig;
}

/* ============================================================================
 * CONTEXTO DE EJECUCIÓN
 * ========================================================================== */

export interface AIProviderRequestContext {
  readonly operation: AIProviderOperation;
  readonly model?: string;
  readonly requestId?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMilliseconds?: number;
}

export interface AIProviderExecutionContext
  extends AIProviderRequestContext {
  readonly providerId: AIProviderIdentifier;
  readonly attempt: number;
  readonly maximumAttempts: number;
}

export interface AIProviderRequestOptions {
  readonly operation: AIProviderOperation;
  readonly model?: string;
  readonly requestId?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMilliseconds?: number;
  readonly headers?: Readonly<
    Record<string, string>
  >;
}

/* ============================================================================
 * ERRORES
 * ========================================================================== */

export interface AIProviderErrorDetails {
  readonly providerId?: AIProviderIdentifier;
  readonly operation?: AIProviderOperation;
  readonly model?: string;
  readonly requestId?: string;
  readonly statusCode?: number;
  readonly attempt?: number;
  readonly retryable?: boolean;
  readonly responseBody?: unknown;
}

export class AIProviderError extends Error {
  public override readonly name =
    "AIProviderError";

  public constructor(
    public readonly code: AIProviderErrorCode,
    message: string,
    public readonly details:
      AIProviderErrorDetails = {},
    public override readonly cause?: unknown,
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
 * RESPUESTAS HTTP
 * ========================================================================== */

export interface AIProviderHttpResponse<TData> {
  readonly data: TData;
  readonly status: number;
  readonly headers: Headers;
  readonly requestId?: string;
}

export interface AIProviderFetchOptions {
  readonly operation: AIProviderOperation;
  readonly model?: string;
  readonly requestId?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMilliseconds?: number;
  readonly headers?: Readonly<
    Record<string, string>
  >;
  readonly retry?: boolean;
}

/* ============================================================================
 * VALORES PREDETERMINADOS
 * ========================================================================== */

export const DEFAULT_PROVIDER_TIMEOUT_MILLISECONDS =
  60_000;

export const DEFAULT_PROVIDER_MAXIMUM_ATTEMPTS =
  3;

export const DEFAULT_PROVIDER_INITIAL_RETRY_DELAY_MILLISECONDS =
  500;

export const DEFAULT_PROVIDER_MAXIMUM_RETRY_DELAY_MILLISECONDS =
  10_000;

export const DEFAULT_PROVIDER_BACKOFF_MULTIPLIER =
  2;

export const DEFAULT_PROVIDER_JITTER_RATIO =
  0.2;

export const DEFAULT_RETRYABLE_STATUS_CODES:
  readonly number[] = Object.freeze([
    408,
    409,
    425,
    429,
    500,
    502,
    503,
    504,
  ]);

/* ============================================================================
 * UTILIDADES INTERNAS
 * ========================================================================== */

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  if (
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return fallback;
  }

  const normalized =
    Math.floor(value);

  return normalized > 0
    ? normalized
    : fallback;
}

function normalizeNonNegativeNumber(
  value: number | undefined,
  fallback: number,
): number {
  if (
    value === undefined ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    return fallback;
  }

  return value;
}

function normalizeBackoffMultiplier(
  value: number | undefined,
): number {
  if (
    value === undefined ||
    !Number.isFinite(value) ||
    value < 1
  ) {
    return DEFAULT_PROVIDER_BACKOFF_MULTIPLIER;
  }

  return value;
}

function normalizeJitterRatio(
  value: number | undefined,
): number {
  if (
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return DEFAULT_PROVIDER_JITTER_RATIO;
  }

  return Math.min(
    1,
    Math.max(
      0,
      value,
    ),
  );
}

function normalizeOptionalString(
  value: string | undefined,
): string | undefined {
  const normalized =
    value?.trim();

  return normalized &&
    normalized.length > 0
    ? normalized
    : undefined;
}

function createRequestId(): string {
  const randomPart =
    Math.random()
      .toString(36)
      .slice(2, 10);

  return [
    "ai",
    Date.now().toString(36),
    randomPart,
  ].join("-");
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function getRecordString(
  value: unknown,
  key: string,
): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const candidate =
    value[key];

  return typeof candidate === "string"
    ? candidate
    : undefined;
}

function getNestedErrorMessage(
  value: unknown,
): string | undefined {
  const directMessage =
    getRecordString(
      value,
      "message",
    );

  if (directMessage !== undefined) {
    return directMessage;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const nestedError =
    value["error"];

  return getRecordString(
    nestedError,
    "message",
  );
}

function createHeaders(
  defaults:
    | Readonly<Record<string, string>>
    | undefined,
  additional:
    | Readonly<Record<string, string>>
    | undefined,
): Headers {
  const headers =
    new Headers();

  if (defaults !== undefined) {
    for (
      const [
        name,
        value,
      ] of Object.entries(defaults)
    ) {
      headers.set(
        name,
        value,
      );
    }
  }

  if (additional !== undefined) {
    for (
      const [
        name,
        value,
      ] of Object.entries(additional)
    ) {
      headers.set(
        name,
        value,
      );
    }
  }

  return headers;
}

function sleep(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (milliseconds <= 0) {
    return Promise.resolve();
  }

  return new Promise<void>(
    (
      resolve,
      reject,
    ) => {
      if (signal?.aborted) {
        reject(
          new AIProviderError(
            "REQUEST_CANCELLED",
            "La operación fue cancelada antes del reintento.",
          ),
        );

        return;
      }

      const timeoutId =
        setTimeout(
          () => {
            signal?.removeEventListener(
              "abort",
              handleAbort,
            );

            resolve();
          },
          milliseconds,
        );

      function handleAbort(): void {
        clearTimeout(
          timeoutId,
        );

        signal?.removeEventListener(
          "abort",
          handleAbort,
        );

        reject(
          new AIProviderError(
            "REQUEST_CANCELLED",
            "La operación fue cancelada durante la espera del reintento.",
          ),
        );
      }

      signal?.addEventListener(
        "abort",
        handleAbort,
        {
          once: true,
        },
      );
    },
  );
}

interface ManagedAbortSignal {
  readonly signal: AbortSignal;
  cleanup(): void;
  didTimeout(): boolean;
}

function createManagedAbortSignal(
  parentSignal: AbortSignal | undefined,
  timeoutMilliseconds: number,
): ManagedAbortSignal {
  const controller =
    new AbortController();

  let timedOut =
    false;

  const handleParentAbort =
    (): void => {
      controller.abort(
        parentSignal?.reason,
      );
    };

  if (parentSignal?.aborted) {
    controller.abort(
      parentSignal.reason,
    );
  } else {
    parentSignal?.addEventListener(
      "abort",
      handleParentAbort,
      {
        once: true,
      },
    );
  }

  const timeoutId =
    setTimeout(
      () => {
        timedOut =
          true;

        controller.abort(
          new Error(
            "AI_PROVIDER_REQUEST_TIMEOUT",
          ),
        );
      },
      timeoutMilliseconds,
    );

  return {
    signal:
      controller.signal,

    cleanup(): void {
      clearTimeout(
        timeoutId,
      );

      parentSignal?.removeEventListener(
        "abort",
        handleParentAbort,
      );
    },

    didTimeout(): boolean {
      return timedOut;
    },
  };
}

/* ============================================================================
 * FUNCIONES PÚBLICAS
 * ========================================================================== */

export function calculateRetryDelayMilliseconds(
  attempt: number,
  config: AIProviderRetryConfig = {},
): number {
  const normalizedAttempt =
    Math.max(
      1,
      Math.floor(attempt),
    );

  const initialDelay =
    normalizeNonNegativeNumber(
      config.initialDelayMilliseconds,
      DEFAULT_PROVIDER_INITIAL_RETRY_DELAY_MILLISECONDS,
    );

  const maximumDelay =
    normalizePositiveInteger(
      config.maximumDelayMilliseconds,
      DEFAULT_PROVIDER_MAXIMUM_RETRY_DELAY_MILLISECONDS,
    );

  const multiplier =
    normalizeBackoffMultiplier(
      config.backoffMultiplier,
    );

  const jitterRatio =
    normalizeJitterRatio(
      config.jitterRatio,
    );

  const exponentialDelay =
    initialDelay *
    multiplier **
      Math.max(
        0,
        normalizedAttempt - 1,
      );

  const cappedDelay =
    Math.min(
      exponentialDelay,
      maximumDelay,
    );

  const jitterRange =
    cappedDelay *
    jitterRatio;

  const randomizedDelay =
    cappedDelay +
    (
      Math.random() * 2 - 1
    ) *
      jitterRange;

  return Math.max(
    0,
    Math.round(
      randomizedDelay,
    ),
  );
}

export function isRetryableHttpStatus(
  statusCode: number,
  retryableStatusCodes:
    readonly number[] =
      DEFAULT_RETRYABLE_STATUS_CODES,
): boolean {
  return retryableStatusCodes.includes(
    statusCode,
  );
}

export function mapHttpStatusToProviderErrorCode(
  statusCode: number,
): AIProviderErrorCode {
  switch (statusCode) {
    case 400:
    case 422:
      return "INVALID_REQUEST";

    case 401:
      return "AUTHENTICATION_ERROR";

    case 403:
      return "PERMISSION_DENIED";

    case 404:
      return "RESOURCE_NOT_FOUND";

    case 408:
    case 504:
      return "REQUEST_TIMEOUT";

    case 429:
      return "RATE_LIMITED";

    case 500:
    case 502:
    case 503:
      return "PROVIDER_UNAVAILABLE";

    default:
      return "PROVIDER_ERROR";
  }
}

export function isAIProviderError(
  value: unknown,
): value is AIProviderError {
  return (
    value instanceof
    AIProviderError
  );
}

/* ============================================================================
 * CLASE BASE
 * ========================================================================== */

export abstract class BaseAIProvider<
  TConfig extends BaseAIProviderConfig =
    BaseAIProviderConfig,
> {
  public readonly providerId:
    AIProviderIdentifier;

  public readonly displayName:
    string;

  public readonly defaultModel:
    string | undefined;

  public readonly baseUrl:
    string | undefined;

  protected readonly config:
    TConfig;

  protected readonly apiKey:
    string | undefined;

  protected readonly timeoutMilliseconds:
    number;

  protected readonly retryConfig:
    Required<
      Omit<
        AIProviderRetryConfig,
        "retryableStatusCodes"
      >
    > & {
      readonly retryableStatusCodes:
        readonly number[];
    };

  protected readonly defaultHeaders:
    Readonly<Record<string, string>>;

  protected constructor(
    config: TConfig,
  ) {
    const providerId =
      config.providerId.trim();

    if (providerId.length === 0) {
      throw new AIProviderError(
        "INVALID_CONFIGURATION",
        "El proveedor debe tener un identificador válido.",
      );
    }

    this.config =
      config;

    this.providerId =
      providerId;

    this.displayName =
      normalizeOptionalString(
        config.displayName,
      ) ??
      providerId;

    this.apiKey =
      normalizeOptionalString(
        config.apiKey,
      );

    this.baseUrl =
      normalizeOptionalString(
        config.baseUrl,
      );

    this.defaultModel =
      normalizeOptionalString(
        config.defaultModel,
      );

    this.timeoutMilliseconds =
      normalizePositiveInteger(
        config.timeoutMilliseconds,
        DEFAULT_PROVIDER_TIMEOUT_MILLISECONDS,
      );

    this.defaultHeaders =
      Object.freeze({
        ...config.defaultHeaders,
      });

    this.retryConfig =
      Object.freeze({
        maximumAttempts:
          normalizePositiveInteger(
            config.retry?.maximumAttempts,
            DEFAULT_PROVIDER_MAXIMUM_ATTEMPTS,
          ),

        initialDelayMilliseconds:
          normalizeNonNegativeNumber(
            config.retry
              ?.initialDelayMilliseconds,
            DEFAULT_PROVIDER_INITIAL_RETRY_DELAY_MILLISECONDS,
          ),

        maximumDelayMilliseconds:
          normalizePositiveInteger(
            config.retry
              ?.maximumDelayMilliseconds,
            DEFAULT_PROVIDER_MAXIMUM_RETRY_DELAY_MILLISECONDS,
          ),

        backoffMultiplier:
          normalizeBackoffMultiplier(
            config.retry
              ?.backoffMultiplier,
          ),

        jitterRatio:
          normalizeJitterRatio(
            config.retry
              ?.jitterRatio,
          ),

        retryableStatusCodes:
          Object.freeze([
            ...(
              config.retry
                ?.retryableStatusCodes ??
              DEFAULT_RETRYABLE_STATUS_CODES
            ),
          ]),
      });
  }

  /**
   * Indica si el proveedor posee la configuración mínima
   * para ejecutar solicitudes.
   */
  public isConfigured(): boolean {
    return true;
  }

  /**
   * Devuelve el modelo recibido o el modelo predeterminado.
   */
  protected resolveModel(
    requestedModel?: string,
  ): string | undefined {
    return (
      normalizeOptionalString(
        requestedModel,
      ) ??
      this.defaultModel
    );
  }

  /**
   * Crea un identificador para rastrear una solicitud.
   */
  protected createRequestId(): string {
    return createRequestId();
  }

  /**
   * Genera las cabeceras finales de una solicitud.
   */
  protected createHeaders(
    additionalHeaders?:
      Readonly<Record<string, string>>,
  ): Headers {
    return createHeaders(
      this.defaultHeaders,
      additionalHeaders,
    );
  }

  /**
   * Ejecuta una operación aplicando:
   * - reintentos
   * - timeout
   * - cancelación
   * - normalización de errores
   */
  protected async executeWithRetry<TResult>(
    operation:
      (
        context:
          AIProviderExecutionContext,
      ) => Promise<TResult>,
    requestContext:
      AIProviderRequestContext,
  ): Promise<TResult> {
    const maximumAttempts =
      this.retryConfig
        .maximumAttempts;

    const requestId =
      requestContext.requestId ??
      this.createRequestId();

    const timeoutMilliseconds =
      normalizePositiveInteger(
        requestContext
          .timeoutMilliseconds,
        this.timeoutMilliseconds,
      );

    let lastError:
      unknown;

    for (
      let attempt = 1;
      attempt <= maximumAttempts;
      attempt += 1
    ) {
      if (
        requestContext.signal
          ?.aborted
      ) {
        throw new AIProviderError(
          "REQUEST_CANCELLED",
          "La solicitud al proveedor fue cancelada.",
          {
            providerId:
              this.providerId,
            operation:
              requestContext.operation,
            model:
              requestContext.model,
            requestId,
            attempt,
            retryable:
              false,
          },
        );
      }

      const managedSignal =
        createManagedAbortSignal(
          requestContext.signal,
          timeoutMilliseconds,
        );

      const executionContext:
        AIProviderExecutionContext = {
          providerId:
            this.providerId,
          operation:
            requestContext.operation,
          requestId,
          signal:
            managedSignal.signal,
          attempt,
          maximumAttempts,
          ...(
            requestContext.model ===
            undefined
              ? {}
              : {
                  model:
                    requestContext.model,
                }
          ),
          timeoutMilliseconds,
        };

      try {
        return await operation(
          executionContext,
        );
      } catch (error) {
        const normalizedError =
          this.normalizeError(
            error,
            executionContext,
            managedSignal.didTimeout(),
          );

        lastError =
          normalizedError;

        const shouldRetry =
          attempt <
            maximumAttempts &&
          this.shouldRetry(
            normalizedError,
          );

        if (!shouldRetry) {
          throw normalizedError;
        }

        const delayMilliseconds =
          calculateRetryDelayMilliseconds(
            attempt,
            this.retryConfig,
          );

        await sleep(
          delayMilliseconds,
          requestContext.signal,
        );
      } finally {
        managedSignal.cleanup();
      }
    }

    throw this.normalizeError(
      lastError,
      {
        providerId:
          this.providerId,
        operation:
          requestContext.operation,
        requestId,
        attempt:
          maximumAttempts,
        maximumAttempts,
        ...(
          requestContext.model ===
          undefined
            ? {}
            : {
                model:
                  requestContext.model,
              }
        ),
        ...(
          requestContext.signal ===
          undefined
            ? {}
            : {
                signal:
                  requestContext.signal,
              }
        ),
        ...(
          requestContext
            .timeoutMilliseconds ===
          undefined
            ? {}
            : {
                timeoutMilliseconds:
                  requestContext
                    .timeoutMilliseconds,
              }
        ),
      },
      false,
    );
  }

  /**
   * Ejecuta una solicitud HTTP y devuelve JSON validado.
   */
  protected async fetchJson<TData>(
    url: string,
    init: RequestInit,
    options:
      AIProviderFetchOptions,
  ): Promise<
    AIProviderHttpResponse<TData>
  > {
    const execute =
      async (
        context:
          AIProviderExecutionContext,
      ): Promise<
        AIProviderHttpResponse<TData>
      > => {
        const headers =
          this.createHeaders(
            options.headers,
          );

        if (init.headers !== undefined) {
          const requestHeaders =
            new Headers(
              init.headers,
            );

          requestHeaders.forEach(
            (
              value,
              name,
            ) => {
              headers.set(
                name,
                value,
              );
            },
          );
        }

        let response:
          Response;

        try {
          response =
            await fetch(
              url,
              {
                ...init,
                headers,
                signal:
                  context.signal,
              },
            );
        } catch (error) {
          if (
            context.signal
              ?.aborted
          ) {
            throw error;
          }

          throw new AIProviderError(
            "NETWORK_ERROR",
            `No se pudo establecer conexión con ${this.displayName}.`,
            {
              providerId:
                this.providerId,
              operation:
                context.operation,
              model:
                context.model,
              requestId:
                context.requestId,
              attempt:
                context.attempt,
              retryable:
                true,
            },
            error,
          );
        }

        const responseRequestId =
          response.headers.get(
            "x-request-id",
          ) ??
          response.headers.get(
            "request-id",
          ) ??
          undefined;

        if (!response.ok) {
          const responseBody =
            await this.readErrorBody(
              response,
            );

          const statusCode =
            response.status;

          const errorCode =
            mapHttpStatusToProviderErrorCode(
              statusCode,
            );

          const retryable =
            isRetryableHttpStatus(
              statusCode,
              this.retryConfig
                .retryableStatusCodes,
            );

          const providerMessage =
            getNestedErrorMessage(
              responseBody,
            );

          throw new AIProviderError(
            errorCode,
            providerMessage ??
              [
                this.displayName,
                "respondió con el estado HTTP",
                String(
                  statusCode,
                ),
              ].join(" "),
            {
              providerId:
                this.providerId,
              operation:
                context.operation,
              model:
                context.model,
              requestId:
                responseRequestId ??
                context.requestId,
              statusCode,
              attempt:
                context.attempt,
              retryable,
              responseBody,
            },
          );
        }

        let data:
          TData;

        try {
          data =
            await response.json() as
              TData;
        } catch (error) {
          throw new AIProviderError(
            "INVALID_RESPONSE",
            `${this.displayName} devolvió una respuesta JSON inválida.`,
            {
              providerId:
                this.providerId,
              operation:
                context.operation,
              model:
                context.model,
              requestId:
                responseRequestId ??
                context.requestId,
              statusCode:
                response.status,
              attempt:
                context.attempt,
              retryable:
                false,
            },
            error,
          );
        }

        const result: {
          data: TData;
          status: number;
          headers: Headers;
          requestId?: string;
        } = {
          data,
          status:
            response.status,
          headers:
            response.headers,
        };

        const resolvedRequestId =
          responseRequestId ??
          context.requestId;

        if (
          resolvedRequestId !==
          undefined
        ) {
          result.requestId =
            resolvedRequestId;
        }

        return result;
      };

    if (options.retry === false) {
      return execute({
        providerId:
          this.providerId,
        operation:
          options.operation,
        requestId:
          options.requestId ??
          this.createRequestId(),
        attempt: 1,
        maximumAttempts: 1,
        ...(
          options.model ===
          undefined
            ? {}
            : {
                model:
                  options.model,
              }
        ),
        ...(
          options.signal ===
          undefined
            ? {}
            : {
                signal:
                  options.signal,
              }
        ),
        ...(
          options
            .timeoutMilliseconds ===
          undefined
            ? {}
            : {
                timeoutMilliseconds:
                  options
                    .timeoutMilliseconds,
              }
        ),
      });
    }

    return this.executeWithRetry(
      execute,
      {
        operation:
          options.operation,
        ...(
          options.model ===
          undefined
            ? {}
            : {
                model:
                  options.model,
              }
        ),
        ...(
          options.requestId ===
          undefined
            ? {}
            : {
                requestId:
                  options.requestId,
              }
        ),
        ...(
          options.signal ===
          undefined
            ? {}
            : {
                signal:
                  options.signal,
              }
        ),
        ...(
          options
            .timeoutMilliseconds ===
          undefined
            ? {}
            : {
                timeoutMilliseconds:
                  options
                    .timeoutMilliseconds,
              }
        ),
      },
    );
  }

  /**
   * Lee el contenido de error sin asumir que siempre será JSON.
   */
  protected async readErrorBody(
    response: Response,
  ): Promise<unknown> {
    const contentType =
      response.headers
        .get(
          "content-type",
        )
        ?.toLowerCase() ??
      "";

    try {
      if (
        contentType.includes(
          "application/json",
        )
      ) {
        return await response.json();
      }

      const text =
        await response.text();

      return text.length > 0
        ? text
        : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Decide si un error permite reintentar la operación.
   */
  protected shouldRetry(
    error: AIProviderError,
  ): boolean {
    if (
      error.details.retryable !==
      undefined
    ) {
      return error.details.retryable;
    }

    return (
      error.code ===
        "RATE_LIMITED" ||
      error.code ===
        "REQUEST_TIMEOUT" ||
      error.code ===
        "NETWORK_ERROR" ||
      error.code ===
        "PROVIDER_UNAVAILABLE"
    );
  }

  /**
   * Convierte cualquier error externo a AIProviderError.
   */
  protected normalizeError(
    error: unknown,
    context:
      AIProviderExecutionContext,
    didTimeout: boolean,
  ): AIProviderError {
    if (
      error instanceof
      AIProviderError
    ) {
      return error;
    }

    if (didTimeout) {
      return new AIProviderError(
        "REQUEST_TIMEOUT",
        `La solicitud a ${this.displayName} superó el tiempo máximo permitido.`,
        {
          providerId:
            this.providerId,
          operation:
            context.operation,
          model:
            context.model,
          requestId:
            context.requestId,
          attempt:
            context.attempt,
          retryable:
            true,
        },
        error,
      );
    }

    if (
      context.signal?.aborted
    ) {
      return new AIProviderError(
        "REQUEST_CANCELLED",
        `La solicitud a ${this.displayName} fue cancelada.`,
        {
          providerId:
            this.providerId,
          operation:
            context.operation,
          model:
            context.model,
          requestId:
            context.requestId,
          attempt:
            context.attempt,
          retryable:
            false,
        },
        error,
      );
    }

    if (error instanceof Error) {
      return new AIProviderError(
        "UNKNOWN_ERROR",
        error.message,
        {
          providerId:
            this.providerId,
          operation:
            context.operation,
          model:
            context.model,
          requestId:
            context.requestId,
          attempt:
            context.attempt,
          retryable:
            false,
        },
        error,
      );
    }

    return new AIProviderError(
      "UNKNOWN_ERROR",
      `Ocurrió un error desconocido al comunicarse con ${this.displayName}.`,
      {
        providerId:
          this.providerId,
        operation:
          context.operation,
        model:
          context.model,
        requestId:
          context.requestId,
        attempt:
          context.attempt,
        retryable:
          false,
      },
      error,
    );
  }

  /**
   * Permite que cada proveedor valide su configuración específica.
   */
  public validateConfiguration(): void {
    if (
      this.providerId.trim().length ===
      0
    ) {
      throw new AIProviderError(
        "INVALID_CONFIGURATION",
        "El identificador del proveedor no puede estar vacío.",
        {
          providerId:
            this.providerId,
          retryable:
            false,
        },
      );
    }
  }
}