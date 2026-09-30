/**
 * @package @gano-bot/ai-core
 * @file providers/gemini.ts
 * @version 1.0.0
 *
 * Proveedor de embeddings para Google Gemini.
 *
 * Características:
 * - Implementa AIEmbeddingProvider.
 * - Utiliza la API REST de Gemini.
 * - Usa batchEmbedContents para procesar múltiples entradas.
 * - No requiere instalar el SDK oficial de Google.
 * - Reutiliza retries, timeout y cancelación de BaseAIProvider.
 * - Conserva identificadores y metadatos de las entradas.
 * - Valida cantidad, orden, dimensiones y valores de los vectores.
 * - Permite configurar dimensionalidad de salida.
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

export const GEMINI_DEFAULT_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";

export const GEMINI_DEFAULT_EMBEDDING_MODEL =
  "gemini-embedding-2";

export const GEMINI_MINIMUM_OUTPUT_DIMENSIONS =
  128;

export const GEMINI_MAXIMUM_OUTPUT_DIMENSIONS =
  3_072;

/* ============================================================================
 * CONFIGURACIÓN
 * ========================================================================== */

export type GeminiEmbeddingTaskType =
  | "RETRIEVAL_QUERY"
  | "RETRIEVAL_DOCUMENT"
  | "SEMANTIC_SIMILARITY"
  | "CLASSIFICATION"
  | "CLUSTERING"
  | "QUESTION_ANSWERING"
  | "FACT_VERIFICATION"
  | "CODE_RETRIEVAL_QUERY";

export interface GeminiProviderConfig
  extends Omit<
    BaseAIProviderConfig,
    "providerId"
  > {
  /**
   * Clave de la API de Gemini.
   */
  readonly apiKey: string;

  /**
   * URL base de Gemini.
   *
   * Valor predeterminado:
   * https://generativelanguage.googleapis.com/v1beta
   */
  readonly baseUrl?: string;

  /**
   * Modelo predeterminado de embeddings.
   *
   * Valor predeterminado:
   * gemini-embedding-2
   */
  readonly defaultModel?: string;

  /**
   * Dimensionalidad solicitada para los vectores.
   *
   * Rango admitido:
   * 128 a 3072.
   */
  readonly outputDimensionality?: number;

  /**
   * Tipo de tarea utilizado de manera predeterminada.
   */
  readonly taskType?: GeminiEmbeddingTaskType;

  /**
   * Título opcional de los documentos.
   *
   * Generalmente se utiliza con RETRIEVAL_DOCUMENT.
   */
  readonly title?: string;
}

/**
 * Configuración interna entregada a BaseAIProvider.
 *
 * El consumidor no necesita proporcionar providerId.
 */
type ResolvedGeminiProviderConfig =
  GeminiProviderConfig & {
    readonly providerId:
      "gemini";
  };

/* ============================================================================
 * TIPOS INTERNOS DE LA API
 * ========================================================================== */

interface GeminiTextPart {
  readonly text: string;
}

interface GeminiContent {
  readonly parts:
    readonly GeminiTextPart[];
}

interface GeminiEmbedContentRequest {
  readonly model: string;
  readonly content:
    GeminiContent;
  readonly taskType?:
    GeminiEmbeddingTaskType;
  readonly title?: string;
  readonly outputDimensionality?: number;
}

interface GeminiBatchEmbedContentsRequest {
  readonly requests:
    readonly GeminiEmbedContentRequest[];
}

interface GeminiContentEmbedding {
  readonly values:
    readonly number[];
}

interface GeminiEmbeddingUsageMetadata {
  readonly promptTokenCount?: number;
  readonly totalTokenCount?: number;
}

interface GeminiBatchEmbedContentsResponse {
  readonly embeddings:
    readonly GeminiContentEmbedding[];
  readonly usageMetadata?:
    GeminiEmbeddingUsageMetadata;
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
      `La configuración de Gemini requiere un valor válido para "${fieldName}".`,
      {
        providerId:
          "gemini",
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

  return normalized !== undefined &&
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
    GEMINI_DEFAULT_BASE_URL;

  return normalized.replace(
    /\/+$/,
    "",
  );
}

function normalizeModelName(
  value: string,
): string {
  const normalized =
    value.trim();

  if (normalized.startsWith("models/")) {
    return normalized.slice(
      "models/".length,
    );
  }

  return normalized;
}

function createModelResourceName(
  model: string,
): string {
  return `models/${normalizeModelName(model)}`;
}

function encodeModelForUrl(
  model: string,
): string {
  return encodeURIComponent(
    normalizeModelName(model),
  );
}

function normalizeOutputDimensionality(
  value: number | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    !Number.isFinite(value) ||
    !Number.isInteger(value)
  ) {
    throw new AIProviderError(
      "INVALID_CONFIGURATION",
      "La dimensionalidad de Gemini debe ser un número entero.",
      {
        providerId:
          "gemini",
        retryable:
          false,
      },
    );
  }

  if (
    value <
      GEMINI_MINIMUM_OUTPUT_DIMENSIONS ||
    value >
      GEMINI_MAXIMUM_OUTPUT_DIMENSIONS
  ) {
    throw new AIProviderError(
      "INVALID_CONFIGURATION",
      [
        "La dimensionalidad configurada para Gemini está fuera del rango permitido.",
        `Mínimo: ${GEMINI_MINIMUM_OUTPUT_DIMENSIONS}.`,
        `Máximo: ${GEMINI_MAXIMUM_OUTPUT_DIMENSIONS}.`,
        `Recibido: ${value}.`,
      ].join(" "),
      {
        providerId:
          "gemini",
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
          "gemini",
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
          "gemini",
        operation:
          "embedding",
        retryable:
          false,
      },
    );
  }
}

function validateApiResponse(
  value: GeminiBatchEmbedContentsResponse,
  expectedEmbeddingCount: number,
): void {
  if (!isRecord(value)) {
    throw new AIProviderError(
      "INVALID_RESPONSE",
      "Gemini devolvió una respuesta de embeddings inválida.",
      {
        providerId:
          "gemini",
        operation:
          "embedding",
        retryable:
          false,
      },
    );
  }

  if (!Array.isArray(value.embeddings)) {
    throw new AIProviderError(
      "INVALID_RESPONSE",
      "La respuesta de Gemini no contiene una colección válida de embeddings.",
      {
        providerId:
          "gemini",
        operation:
          "embedding",
        retryable:
          false,
      },
    );
  }

  if (
    value.embeddings.length !==
    expectedEmbeddingCount
  ) {
    throw new AIProviderError(
      "INVALID_RESPONSE",
      [
        "Gemini devolvió una cantidad incorrecta de embeddings.",
        `Esperados: ${expectedEmbeddingCount}.`,
        `Recibidos: ${value.embeddings.length}.`,
      ].join(" "),
      {
        providerId:
          "gemini",
        operation:
          "embedding",
        retryable:
          false,
      },
    );
  }
}

function validateVector(
  value: unknown,
  inputId: string,
  expectedDimensions:
    number | undefined,
): AIEmbeddingVector {
  if (!isRecord(value)) {
    throw new AIProviderError(
      "INVALID_RESPONSE",
      `Gemini devolvió un embedding inválido para la entrada "${inputId}".`,
      {
        providerId:
          "gemini",
        operation:
          "embedding",
        retryable:
          false,
      },
    );
  }

  const values =
    value["values"];

  if (!Array.isArray(values)) {
    throw new AIProviderError(
      "INVALID_RESPONSE",
      `Gemini no devolvió un vector válido para la entrada "${inputId}".`,
      {
        providerId:
          "gemini",
        operation:
          "embedding",
        retryable:
          false,
      },
    );
  }

  if (values.length === 0) {
    throw new AIProviderError(
      "INVALID_RESPONSE",
      `Gemini devolvió un vector vacío para la entrada "${inputId}".`,
      {
        providerId:
          "gemini",
        operation:
          "embedding",
        retryable:
          false,
      },
    );
  }

  const vector:
    number[] = [];

  for (
    let index = 0;
    index < values.length;
    index += 1
  ) {
    const item =
      values[index];

    if (
      typeof item !== "number" ||
      !Number.isFinite(item)
    ) {
      throw new AIProviderError(
        "INVALID_RESPONSE",
        `Gemini devolvió un valor vectorial inválido en la posición ${index} para la entrada "${inputId}".`,
        {
          providerId:
            "gemini",
          operation:
            "embedding",
          retryable:
            false,
        },
      );
    }

    vector.push(
      item,
    );
  }

  if (
    expectedDimensions !== undefined &&
    vector.length !== expectedDimensions
  ) {
    throw new AIProviderError(
      "INVALID_RESPONSE",
      [
        `Gemini devolvió una dimensionalidad inesperada para la entrada "${inputId}".`,
        `Esperada: ${expectedDimensions}.`,
        `Recibida: ${vector.length}.`,
      ].join(" "),
      {
        providerId:
          "gemini",
        operation:
          "embedding",
        retryable:
          false,
      },
    );
  }

  return Object.freeze(
    vector,
  );
}

function resolveUsageTokens(
  usageMetadata:
    GeminiEmbeddingUsageMetadata | undefined,
): number | undefined {
  const totalTokenCount =
    usageMetadata?.totalTokenCount;

  if (
    totalTokenCount !== undefined &&
    Number.isFinite(
      totalTokenCount,
    ) &&
    totalTokenCount >= 0
  ) {
    return Math.floor(
      totalTokenCount,
    );
  }

  const promptTokenCount =
    usageMetadata?.promptTokenCount;

  if (
    promptTokenCount !== undefined &&
    Number.isFinite(
      promptTokenCount,
    ) &&
    promptTokenCount >= 0
  ) {
    return Math.floor(
      promptTokenCount,
    );
  }

  return undefined;
}

/* ============================================================================
 * PROVEEDOR
 * ========================================================================== */

export class GeminiEmbeddingProvider
  extends BaseAIProvider<
    ResolvedGeminiProviderConfig
  >
  implements AIEmbeddingProvider {
  private readonly geminiBaseUrl:
    string;

  private readonly outputDimensionality:
    number | undefined;

  private readonly taskType:
    GeminiEmbeddingTaskType | undefined;

  private readonly title:
    string | undefined;

  public constructor(
    config: GeminiProviderConfig,
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
      normalizeModelName(
        normalizeOptionalString(
          config.defaultModel,
        ) ??
          GEMINI_DEFAULT_EMBEDDING_MODEL,
      );

    const resolvedConfig:
      ResolvedGeminiProviderConfig = {
        ...config,
        providerId:
          "gemini",
        apiKey,
        baseUrl,
        defaultModel,
        displayName:
          normalizeOptionalString(
            config.displayName,
          ) ??
          "Google Gemini",
      };

    super(
      resolvedConfig,
    );

    this.geminiBaseUrl =
      baseUrl;

    this.outputDimensionality =
      normalizeOutputDimensionality(
        config.outputDimensionality,
      );

    this.taskType =
      config.taskType;

    this.title =
      normalizeOptionalString(
        config.title,
      );

    this.validateConfiguration();
  }

  public override isConfigured(): boolean {
    return (
      this.apiKey !== undefined &&
      this.apiKey.length > 0 &&
      this.geminiBaseUrl.length > 0 &&
      this.defaultModel !== undefined &&
      this.defaultModel.length > 0
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
        "No se configuró una clave de API para Gemini.",
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
        this.geminiBaseUrl,
      );
    } catch (error) {
      throw new AIProviderError(
        "INVALID_CONFIGURATION",
        `La URL base de Gemini no es válida: "${this.geminiBaseUrl}".`,
        {
          providerId:
            this.providerId,
          retryable:
            false,
        },
        error,
      );
    }

    if (
      this.defaultModel === undefined ||
      this.defaultModel.trim().length === 0
    ) {
      throw new AIProviderError(
        "INVALID_CONFIGURATION",
        "No se configuró un modelo de embeddings para Gemini.",
        {
          providerId:
            this.providerId,
          retryable:
            false,
        },
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
        "La solicitud de embeddings de Gemini fue cancelada.",
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
        "La solicitud de embeddings de Gemini no contiene entradas.",
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

    const resolvedModel =
      this.resolveModel(
        request.model,
      );

    if (resolvedModel === undefined) {
      throw new AIProviderError(
        "INVALID_CONFIGURATION",
        "No se pudo resolver el modelo de embeddings de Gemini.",
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

    const model =
      normalizeModelName(
        resolvedModel,
      );

    const modelResourceName =
      createModelResourceName(
        model,
      );

    const body:
      GeminiBatchEmbedContentsRequest = {
        requests:
          request.inputs.map(
            (
              input,
            ): GeminiEmbedContentRequest => ({
              model:
                modelResourceName,

              content: {
                parts: [
                  {
                    text:
                      input.text,
                  },
                ],
              },

              ...(
                this.taskType ===
                undefined
                  ? {}
                  : {
                      taskType:
                        this.taskType,
                    }
              ),

              ...(
                this.title ===
                undefined
                  ? {}
                  : {
                      title:
                        this.title,
                    }
              ),

              ...(
                this.outputDimensionality ===
                undefined
                  ? {}
                  : {
                      outputDimensionality:
                        this.outputDimensionality,
                    }
              ),
            }),
          ),
      };

    const response =
      await this.fetchJson<
        GeminiBatchEmbedContentsResponse
      >(
        [
          this.geminiBaseUrl,
          "/models/",
          encodeModelForUrl(
            model,
          ),
          ":batchEmbedContents",
        ].join(""),
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify(
              body,
            ),
        },
        {
          operation:
            "embedding",

          model,

          signal:
            request.signal,

          headers:
            this.createGeminiHeaders(),
        },
      );

    validateApiResponse(
      response.data,
      request.inputs.length,
    );

    const createdAt =
      new Date().toISOString();

    const embeddings =
      response.data.embeddings.map(
        (
          embedding,
          index,
        ): AIEmbedding => {
          const input =
            request.inputs[index];

          if (input === undefined) {
            throw new AIProviderError(
              "INVALID_RESPONSE",
              `Gemini devolvió un embedding inesperado en la posición ${index}.`,
              {
                providerId:
                  this.providerId,
                operation:
                  "embedding",
                model,
                requestId:
                  response.requestId,
                statusCode:
                  response.status,
                retryable:
                  false,
              },
            );
          }

          const vector =
            validateVector(
              embedding,
              input.id,
              this.outputDimensionality,
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
              model,
              createdAt,
            };
          }

          return {
            id:
              input.id,
            vector,
            dimensions:
              vector.length,
            model,
            createdAt,
            metadata:
              input.metadata,
          };
        },
      );

    const usageTokens =
      resolveUsageTokens(
        response.data
          .usageMetadata,
      );

    const result: {
      embeddings:
        readonly AIEmbedding[];
      model: string;
      usageTokens?: number;
      durationMilliseconds: number;
    } = {
      embeddings,
      model,
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

  private createGeminiHeaders():
    Readonly<Record<string, string>> {
    if (this.apiKey === undefined) {
      throw new AIProviderError(
        "INVALID_CONFIGURATION",
        "La clave de API de Gemini no está disponible.",
        {
          providerId:
            this.providerId,
          retryable:
            false,
        },
      );
    }

    return {
      "x-goog-api-key":
        this.apiKey,
    };
  }
}

/* ============================================================================
 * FACTORÍA
 * ========================================================================== */

export function createGeminiEmbeddingProvider(
  config: GeminiProviderConfig,
): AIEmbeddingProvider {
  return new GeminiEmbeddingProvider(
    config,
  );
}