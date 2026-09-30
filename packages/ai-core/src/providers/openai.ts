/**
 * @package @gano-bot/ai-core
 * @file providers/openai.ts
 * @version 1.0.1
 *
 * Proveedor de embeddings para OpenAI.
 *
 * Características:
 * - Implementa AIEmbeddingProvider.
 * - Utiliza el endpoint REST /v1/embeddings.
 * - No requiere instalar el SDK oficial.
 * - Reutiliza retries, timeout y cancelación de BaseAIProvider.
 * - Conserva los identificadores y metadatos de las entradas.
 * - Valida el orden y la estructura de la respuesta.
 * - Permite configurar dimensiones para modelos compatibles.
 */

import type {
  AIEmbedding,
  AIEmbeddingInput,
  AIEmbeddingProvider,
  AIEmbeddingRequest,
  AIEmbeddingResponse,
  AIEmbeddingVector,
} from "../types";

import {
  AIProviderError,
  BaseAIProvider,
  type BaseAIProviderConfig,
} from "./base.js";

/* ============================================================================
 * CONSTANTES
 * ========================================================================== */

export const OPENAI_DEFAULT_BASE_URL =
  "https://api.openai.com/v1";

export const OPENAI_DEFAULT_EMBEDDING_MODEL =
  "text-embedding-3-small";

/* ============================================================================
 * CONFIGURACIÓN
 * ========================================================================== */

export interface OpenAIProviderConfig
  extends Omit<
    BaseAIProviderConfig,
    "providerId"
  > {
  /**
   * Clave de OpenAI.
   */
  readonly apiKey: string;

  /**
   * URL base.
   *
   * Valor predeterminado:
   * https://api.openai.com/v1
   */
  readonly baseUrl?: string;

  /**
   * Modelo de embeddings predeterminado.
   */
  readonly defaultModel?: string;

  /**
   * Organización de OpenAI, cuando corresponda.
   */
  readonly organizationId?: string;

  /**
   * Proyecto de OpenAI, cuando corresponda.
   */
  readonly projectId?: string;

  /**
   * Dimensiones solicitadas al proveedor.
   *
   * Se omite cuando no se define.
   */
  readonly embeddingDimensions?: number;

  /**
   * Identificador opcional del usuario final.
   */
  readonly user?: string;
}

/**
 * Configuración interna ya resuelta.
 *
 * OpenAIProviderConfig no solicita providerId al consumidor.
 * La clase añade automáticamente el identificador "openai"
 * antes de entregarlo a BaseAIProvider.
 */
type ResolvedOpenAIProviderConfig =
  OpenAIProviderConfig & {
    readonly providerId:
      "openai";
  };

/* ============================================================================
 * TIPOS DE LA API DE OPENAI
 * ========================================================================== */

interface OpenAIEmbeddingRequestBody {
  readonly model: string;
  readonly input: readonly string[];
  readonly encoding_format: "float";
  readonly dimensions?: number;
  readonly user?: string;
}

interface OpenAIEmbeddingDataItem {
  readonly object: string;
  readonly embedding: readonly number[];
  readonly index: number;
}

interface OpenAIEmbeddingUsage {
  readonly prompt_tokens?: number;
  readonly total_tokens?: number;
}

interface OpenAIEmbeddingApiResponse {
  readonly object?: string;
  readonly data:
    readonly OpenAIEmbeddingDataItem[];
  readonly model: string;
  readonly usage?:
    OpenAIEmbeddingUsage;
}

/* ============================================================================
 * UTILIDADES
 * ========================================================================== */

function normalizeRequiredString(
  value: string,
  fieldName: string,
): string {
  const normalized =
    value.trim();

  if (normalized.length === 0) {
    throw new AIProviderError(
      "INVALID_CONFIGURATION",
      `La configuración de OpenAI requiere un valor válido para "${fieldName}".`,
      {
        providerId:
          "openai",
        retryable:
          false,
      },
    );
  }

  return normalized;
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

function normalizeBaseUrl(
  value: string | undefined,
): string {
  const normalized =
    normalizeOptionalString(
      value,
    ) ??
    OPENAI_DEFAULT_BASE_URL;

  return normalized.replace(
    /\/+$/,
    "",
  );
}

function normalizeOptionalPositiveInteger(
  value: number | undefined,
  fieldName: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new AIProviderError(
      "INVALID_CONFIGURATION",
      `La configuración "${fieldName}" debe ser un número entero mayor que cero.`,
      {
        providerId:
          "openai",
        retryable:
          false,
      },
    );
  }

  return value;
}

function isRecord(
  value: unknown,
): value is Record<
  string,
  unknown
> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function validateInput(
  input: AIEmbeddingInput,
  index: number,
): void {
  if (input.id.trim().length === 0) {
    throw new AIProviderError(
      "INVALID_REQUEST",
      `La entrada de embeddings en la posición ${index} no tiene un identificador válido.`,
      {
        providerId:
          "openai",
        operation:
          "embedding",
        retryable:
          false,
      },
    );
  }

  if (input.text.trim().length === 0) {
    throw new AIProviderError(
      "INVALID_REQUEST",
      `La entrada de embedding "${input.id}" no contiene texto.`,
      {
        providerId:
          "openai",
        operation:
          "embedding",
        retryable:
          false,
      },
    );
  }
}

function validateVector(
  vector: readonly number[],
  inputId: string,
): AIEmbeddingVector {
  if (vector.length === 0) {
    throw new AIProviderError(
      "INVALID_RESPONSE",
      `OpenAI devolvió un vector vacío para la entrada "${inputId}".`,
      {
        providerId:
          "openai",
        operation:
          "embedding",
        retryable:
          false,
      },
    );
  }

  for (
    let index = 0;
    index < vector.length;
    index += 1
  ) {
    const value =
      vector[index];

    if (
      value === undefined ||
      !Number.isFinite(value)
    ) {
      throw new AIProviderError(
        "INVALID_RESPONSE",
        `OpenAI devolvió un valor vectorial inválido en la posición ${index} para la entrada "${inputId}".`,
        {
          providerId:
            "openai",
          operation:
            "embedding",
          retryable:
            false,
        },
      );
    }
  }

  return Object.freeze([
    ...vector,
  ]);
}

function validateApiResponse(
  value: OpenAIEmbeddingApiResponse,
  expectedInputCount: number,
): void {
  if (!isRecord(value)) {
    throw new AIProviderError(
      "INVALID_RESPONSE",
      "OpenAI devolvió una respuesta de embeddings inválida.",
      {
        providerId:
          "openai",
        operation:
          "embedding",
        retryable:
          false,
      },
    );
  }

  if (!Array.isArray(value.data)) {
    throw new AIProviderError(
      "INVALID_RESPONSE",
      "La respuesta de OpenAI no contiene una colección válida de embeddings.",
      {
        providerId:
          "openai",
        operation:
          "embedding",
        retryable:
          false,
      },
    );
  }

  if (
    value.data.length !==
    expectedInputCount
  ) {
    throw new AIProviderError(
      "INVALID_RESPONSE",
      [
        "OpenAI devolvió una cantidad incorrecta de embeddings.",
        `Esperados: ${expectedInputCount}.`,
        `Recibidos: ${value.data.length}.`,
      ].join(" "),
      {
        providerId:
          "openai",
        operation:
          "embedding",
        retryable:
          false,
      },
    );
  }

  if (
    typeof value.model !==
      "string" ||
    value.model.trim().length ===
      0
  ) {
    throw new AIProviderError(
      "INVALID_RESPONSE",
      "OpenAI no informó el modelo utilizado para generar los embeddings.",
      {
        providerId:
          "openai",
        operation:
          "embedding",
        retryable:
          false,
      },
    );
  }
}

function resolveUsageTokens(
  usage:
    OpenAIEmbeddingUsage | undefined,
): number | undefined {
  const totalTokens =
    usage?.total_tokens;

  if (
    totalTokens !== undefined &&
    Number.isFinite(totalTokens) &&
    totalTokens >= 0
  ) {
    return Math.floor(
      totalTokens,
    );
  }

  const promptTokens =
    usage?.prompt_tokens;

  if (
    promptTokens !== undefined &&
    Number.isFinite(promptTokens) &&
    promptTokens >= 0
  ) {
    return Math.floor(
      promptTokens,
    );
  }

  return undefined;
}

/* ============================================================================
 * PROVEEDOR
 * ========================================================================== */

export class OpenAIEmbeddingProvider
  extends BaseAIProvider<
    ResolvedOpenAIProviderConfig
  >
  implements AIEmbeddingProvider {
  private readonly openAIBaseUrl:
    string;

  private readonly organizationId:
    string | undefined;

  private readonly projectId:
    string | undefined;

  private readonly embeddingDimensions:
    number | undefined;

  private readonly user:
    string | undefined;

  public constructor(
    config: OpenAIProviderConfig,
  ) {
    const apiKey =
      normalizeRequiredString(
        config.apiKey,
        "apiKey",
      );

    const baseUrl =
      normalizeBaseUrl(
        config.baseUrl,
      );

    const defaultModel =
      normalizeOptionalString(
        config.defaultModel,
      ) ??
      OPENAI_DEFAULT_EMBEDDING_MODEL;

    const resolvedConfig:
      ResolvedOpenAIProviderConfig = {
        ...config,
        providerId:
          "openai",
        apiKey,
        baseUrl,
        defaultModel,
        displayName:
          normalizeOptionalString(
            config.displayName,
          ) ??
          "OpenAI",
      };

    super(
      resolvedConfig,
    );

    this.openAIBaseUrl =
      baseUrl;

    this.organizationId =
      normalizeOptionalString(
        config.organizationId,
      );

    this.projectId =
      normalizeOptionalString(
        config.projectId,
      );

    this.embeddingDimensions =
      normalizeOptionalPositiveInteger(
        config.embeddingDimensions,
        "embeddingDimensions",
      );

    this.user =
      normalizeOptionalString(
        config.user,
      );

    this.validateConfiguration();
  }

  public override isConfigured(): boolean {
    return (
      this.apiKey !== undefined &&
      this.apiKey.length > 0 &&
      this.openAIBaseUrl.length > 0
    );
  }

  public override validateConfiguration(): void {
    super.validateConfiguration();

    if (
      this.apiKey === undefined ||
      this.apiKey.length === 0
    ) {
      throw new AIProviderError(
        "INVALID_CONFIGURATION",
        "No se configuró una clave de OpenAI.",
        {
          providerId:
            this.providerId,
          retryable:
            false,
        },
      );
    }

    try {
      new URL(
        this.openAIBaseUrl,
      );
    } catch (error) {
      throw new AIProviderError(
        "INVALID_CONFIGURATION",
        `La URL base de OpenAI no es válida: "${this.openAIBaseUrl}".`,
        {
          providerId:
            this.providerId,
          retryable:
            false,
        },
        error,
      );
    }
  }

  public async embed(
    request: AIEmbeddingRequest,
  ): Promise<AIEmbeddingResponse> {
    const startedAt =
      Date.now();

    if (request.signal?.aborted) {
      throw new AIProviderError(
        "REQUEST_CANCELLED",
        "La solicitud de embeddings fue cancelada.",
        {
          providerId:
            this.providerId,
          operation:
            "embedding",
          retryable:
            false,
        },
      );
    }

    if (request.inputs.length === 0) {
      throw new AIProviderError(
        "INVALID_REQUEST",
        "La solicitud de embeddings no contiene entradas.",
        {
          providerId:
            this.providerId,
          operation:
            "embedding",
          retryable:
            false,
        },
      );
    }

    request.inputs.forEach(
      validateInput,
    );

    const model =
      this.resolveModel(
        request.model,
      );

    if (model === undefined) {
      throw new AIProviderError(
        "INVALID_CONFIGURATION",
        "No se configuró un modelo de embeddings para OpenAI.",
        {
          providerId:
            this.providerId,
          operation:
            "embedding",
          retryable:
            false,
        },
      );
    }

    const body:
      OpenAIEmbeddingRequestBody = {
        model,
        input:
          request.inputs.map(
            (input) =>
              input.text,
          ),
        encoding_format:
          "float",
        ...(
          this.embeddingDimensions ===
          undefined
            ? {}
            : {
                dimensions:
                  this.embeddingDimensions,
              }
        ),
        ...(
          this.user === undefined
            ? {}
            : {
                user:
                  this.user,
              }
        ),
      };

    const response =
      await this.fetchJson<
        OpenAIEmbeddingApiResponse
      >(
        `${this.openAIBaseUrl}/embeddings`,
        {
          method:
            "POST",
          body:
            JSON.stringify(
              body,
            ),
          headers: {
            "Content-Type":
              "application/json",
          },
        },
        {
          operation:
            "embedding",
          model,
          signal:
            request.signal,
          headers:
            this.createOpenAIHeaders(),
        },
      );

    validateApiResponse(
      response.data,
      request.inputs.length,
    );

    const sortedData =
      [...response.data.data].sort(
        (
          left,
          right,
        ) =>
          left.index -
          right.index,
      );

    const createdAt =
      new Date().toISOString();

    const embeddings =
      sortedData.map(
        (
          item,
          outputIndex,
        ): AIEmbedding => {
          const input =
            request.inputs[
              outputIndex
            ];

          if (input === undefined) {
            throw new AIProviderError(
              "INVALID_RESPONSE",
              `OpenAI devolvió un índice de embedding inesperado: ${item.index}.`,
              {
                providerId:
                  this.providerId,
                operation:
                  "embedding",
                model:
                  response.data.model,
                statusCode:
                  response.status,
                requestId:
                  response.requestId,
                retryable:
                  false,
              },
            );
          }

          if (
            item.index !==
            outputIndex
          ) {
            throw new AIProviderError(
              "INVALID_RESPONSE",
              [
                "OpenAI devolvió índices de embeddings inconsistentes.",
                `Índice esperado: ${outputIndex}.`,
                `Índice recibido: ${item.index}.`,
              ].join(" "),
              {
                providerId:
                  this.providerId,
                operation:
                  "embedding",
                model:
                  response.data.model,
                statusCode:
                  response.status,
                requestId:
                  response.requestId,
                retryable:
                  false,
              },
            );
          }

          const vector =
            validateVector(
              item.embedding,
              input.id,
            );

          if (
            input.metadata ===
            undefined
          ) {
            return {
              id:
                input.id,
              vector,
              dimensions:
                vector.length,
              model:
                response.data.model,
              createdAt,
            };
          }

          return {
            id:
              input.id,
            vector,
            dimensions:
              vector.length,
            model:
              response.data.model,
            createdAt,
            metadata:
              input.metadata,
          };
        },
      );

    const usageTokens =
      resolveUsageTokens(
        response.data.usage,
      );

    const result: {
      embeddings:
        readonly AIEmbedding[];
      model: string;
      usageTokens?: number;
      durationMilliseconds: number;
    } = {
      embeddings,
      model:
        response.data.model,
      durationMilliseconds:
        Date.now() -
        startedAt,
    };

    if (
      usageTokens !== undefined
    ) {
      result.usageTokens =
        usageTokens;
    }

    return result;
  }

  private createOpenAIHeaders():
    Readonly<Record<string, string>> {
    if (this.apiKey === undefined) {
      throw new AIProviderError(
        "INVALID_CONFIGURATION",
        "La clave de OpenAI no está disponible.",
        {
          providerId:
            this.providerId,
          retryable:
            false,
        },
      );
    }

    const headers:
      Record<string, string> = {
        Authorization:
          `Bearer ${this.apiKey}`,
      };

    if (
      this.organizationId !==
      undefined
    ) {
      headers[
        "OpenAI-Organization"
      ] =
        this.organizationId;
    }

    if (
      this.projectId !==
      undefined
    ) {
      headers[
        "OpenAI-Project"
      ] =
        this.projectId;
    }

    return headers;
  }
}

/* ============================================================================
 * FACTORÍA
 * ========================================================================== */

export function createOpenAIEmbeddingProvider(
  config: OpenAIProviderConfig,
): AIEmbeddingProvider {
  return new OpenAIEmbeddingProvider(
    config,
  );
}