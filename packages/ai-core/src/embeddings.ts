/**
 * @package @gano-bot/ai-core
 * @file embeddings.ts
 * @version 0.1.0
 *
 * Utilidades y servicio desacoplado para:
 * - Preparar entradas de embeddings.
 * - Validar vectores.
 * - Procesar solicitudes por lotes.
 * - Normalizar vectores.
 * - Calcular similitud coseno.
 * - Validar respuestas de proveedores externos.
 *
 * Este módulo no depende directamente de OpenAI, Gemini,
 * Firebase, Firestore ni de ningún proveedor específico.
 */

import type {
  AIEmbedding,
  AIEmbeddingInput,
  AIEmbeddingProvider,
  AIEmbeddingRequest,
  AIEmbeddingResponse,
  AIEmbeddingVector,
  AIIdentifier,
  AIMetadata,
} from "./types";

/* ============================================================================
 * CONSTANTES
 * ========================================================================== */

export const DEFAULT_EMBEDDING_BATCH_SIZE =
  32 as const;

export const DEFAULT_MAXIMUM_EMBEDDING_TEXT_LENGTH =
  32_000 as const;

export const DEFAULT_MINIMUM_EMBEDDING_DIMENSIONS =
  1 as const;

export const DEFAULT_MAXIMUM_EMBEDDING_DIMENSIONS =
  100_000 as const;

/* ============================================================================
 * ERRORES
 * ========================================================================== */

export type AIEmbeddingServiceErrorCode =
  | "INVALID_INPUT"
  | "INVALID_VECTOR"
  | "DIMENSION_MISMATCH"
  | "DUPLICATE_INPUT_ID"
  | "PROVIDER_RESPONSE_INVALID"
  | "EMBEDDING_ERROR"
  | "REQUEST_CANCELLED";

export interface AIEmbeddingServiceErrorDetails {
  readonly inputId?: AIIdentifier;
  readonly expectedDimensions?: number;
  readonly receivedDimensions?: number;
  readonly batchIndex?: number;
  readonly providerModel?: string;
}

export class AIEmbeddingServiceError
  extends Error {
 public override name =
  "AIEmbeddingServiceError";
  public constructor(
    public readonly code:
      AIEmbeddingServiceErrorCode,
    message: string,
    public readonly details?:
      AIEmbeddingServiceErrorDetails,
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
 * CONFIGURACIÓN DEL SERVICIO
 * ========================================================================== */

export interface AIEmbeddingServiceConfig {
  /**
   * Proveedor responsable de generar los embeddings.
   */
  readonly provider: AIEmbeddingProvider;

  /**
   * Modelo que se enviará al proveedor cuando la solicitud
   * no defina uno explícitamente.
   */
  readonly defaultModel?: string;

  /**
   * Cantidad máxima de entradas enviadas al proveedor
   * en cada lote.
   */
  readonly batchSize?: number;

  /**
   * Longitud máxima permitida por texto.
   */
  readonly maximumTextLength?: number;

  /**
   * Elimina espacios al inicio y al final del texto.
   */
  readonly trimInputs?: boolean;

  /**
   * Normaliza todos los vectores a magnitud 1.
   */
  readonly normalizeVectors?: boolean;

  /**
   * Rechaza solicitudes que no contienen entradas.
   */
  readonly rejectEmptyRequests?: boolean;
}

export interface AIEmbeddingService {
  /**
   * Genera embeddings aplicando validación, división
   * por lotes y validación de respuesta.
   */
  embed(
    request: AIEmbeddingRequest,
  ): Promise<AIEmbeddingResponse>;
}

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

function throwIfAborted(
  signal: AbortSignal | undefined,
): void {
  if (!signal?.aborted) {
    return;
  }

  throw new AIEmbeddingServiceError(
    "REQUEST_CANCELLED",
    "La generación de embeddings fue cancelada.",
  );
}

function createBatchRequest(
  inputs: readonly AIEmbeddingInput[],
  model: string | undefined,
  signal: AbortSignal | undefined,
): AIEmbeddingRequest {
  const request: {
    inputs: readonly AIEmbeddingInput[];
    model?: string;
    signal?: AbortSignal;
  } = {
    inputs,
  };

  if (model !== undefined) {
    request.model = model;
  }

  if (signal !== undefined) {
    request.signal = signal;
  }

  return request;
}

function createPreparedInput(
  input: AIEmbeddingInput,
  text: string,
): AIEmbeddingInput {
  if (input.metadata === undefined) {
    return {
      id: input.id,
      text,
    };
  }

  return {
    id: input.id,
    text,
    metadata: input.metadata,
  };
}

function createValidatedEmbedding(
  embedding: AIEmbedding,
  vector: AIEmbeddingVector,
): AIEmbedding {
  if (embedding.metadata === undefined) {
    return {
      id: embedding.id,
      vector,
      dimensions: vector.length,
      model: embedding.model,
      createdAt: embedding.createdAt,
    };
  }

  return {
    id: embedding.id,
    vector,
    dimensions: vector.length,
    model: embedding.model,
    createdAt: embedding.createdAt,
    metadata: embedding.metadata,
  };
}

/* ============================================================================
 * VALIDACIÓN DE ENTRADAS
 * ========================================================================== */

export interface AIEmbeddingInputValidationOptions {
  readonly maximumTextLength?: number;
  readonly trimText?: boolean;
}

export function prepareEmbeddingInputs(
  inputs: readonly AIEmbeddingInput[],
  options: AIEmbeddingInputValidationOptions = {},
): readonly AIEmbeddingInput[] {
  const maximumTextLength =
    normalizePositiveInteger(
      options.maximumTextLength,
      DEFAULT_MAXIMUM_EMBEDDING_TEXT_LENGTH,
    );

  const trimText =
    options.trimText ?? true;

  const usedIds =
    new Set<AIIdentifier>();

  return inputs.map(
    (
      input,
      index,
    ): AIEmbeddingInput => {
      const id =
        input.id.trim();

      if (id.length === 0) {
        throw new AIEmbeddingServiceError(
          "INVALID_INPUT",
          `La entrada de embeddings en la posición ${index} no tiene un identificador válido.`,
        );
      }

      if (usedIds.has(id)) {
        throw new AIEmbeddingServiceError(
          "DUPLICATE_INPUT_ID",
          `El identificador de embedding "${id}" está duplicado.`,
          {
            inputId: id,
          },
        );
      }

      usedIds.add(id);

      const text = trimText
        ? input.text.trim()
        : input.text;

      if (text.length === 0) {
        throw new AIEmbeddingServiceError(
          "INVALID_INPUT",
          `La entrada de embedding "${id}" no contiene texto.`,
          {
            inputId: id,
          },
        );
      }

      if (
        text.length >
        maximumTextLength
      ) {
        throw new AIEmbeddingServiceError(
          "INVALID_INPUT",
          [
            `La entrada de embedding "${id}" supera la longitud máxima permitida.`,
            `Longitud recibida: ${text.length}.`,
            `Longitud máxima: ${maximumTextLength}.`,
          ].join(" "),
          {
            inputId: id,
          },
        );
      }

      return createPreparedInput(
        {
          ...input,
          id,
        },
        text,
      );
    },
  );
}

/* ============================================================================
 * VALIDACIÓN Y OPERACIONES VECTORIALES
 * ========================================================================== */

export interface AIEmbeddingVectorValidationOptions {
  readonly minimumDimensions?: number;
  readonly maximumDimensions?: number;
  readonly expectedDimensions?: number;
}

export function validateEmbeddingVector(
  vector: AIEmbeddingVector,
  options: AIEmbeddingVectorValidationOptions = {},
): void {
  const minimumDimensions =
    normalizePositiveInteger(
      options.minimumDimensions,
      DEFAULT_MINIMUM_EMBEDDING_DIMENSIONS,
    );

  const maximumDimensions =
    normalizePositiveInteger(
      options.maximumDimensions,
      DEFAULT_MAXIMUM_EMBEDDING_DIMENSIONS,
    );

  if (
    vector.length <
    minimumDimensions
  ) {
    throw new AIEmbeddingServiceError(
      "INVALID_VECTOR",
      [
        "El vector de embedding no contiene suficientes dimensiones.",
        `Dimensiones recibidas: ${vector.length}.`,
        `Mínimo permitido: ${minimumDimensions}.`,
      ].join(" "),
      {
        receivedDimensions:
          vector.length,
      },
    );
  }

  if (
    vector.length >
    maximumDimensions
  ) {
    throw new AIEmbeddingServiceError(
      "INVALID_VECTOR",
      [
        "El vector de embedding supera el máximo de dimensiones permitido.",
        `Dimensiones recibidas: ${vector.length}.`,
        `Máximo permitido: ${maximumDimensions}.`,
      ].join(" "),
      {
        receivedDimensions:
          vector.length,
      },
    );
  }

  if (
    options.expectedDimensions !== undefined &&
    vector.length !==
      options.expectedDimensions
  ) {
    throw new AIEmbeddingServiceError(
      "DIMENSION_MISMATCH",
      [
        "El vector de embedding tiene una cantidad de dimensiones diferente a la esperada.",
        `Esperadas: ${options.expectedDimensions}.`,
        `Recibidas: ${vector.length}.`,
      ].join(" "),
      {
        expectedDimensions:
          options.expectedDimensions,
        receivedDimensions:
          vector.length,
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
      throw new AIEmbeddingServiceError(
        "INVALID_VECTOR",
        `El vector contiene un valor no finito en la posición ${index}.`,
        {
          receivedDimensions:
            vector.length,
        },
      );
    }
  }
}

export function calculateVectorMagnitude(
  vector: AIEmbeddingVector,
): number {
  validateEmbeddingVector(
    vector,
  );

  const squaredSum =
    vector.reduce(
      (
        total,
        value,
      ) =>
        total +
        value * value,
      0,
    );

  return Math.sqrt(
    squaredSum,
  );
}

export function normalizeEmbeddingVector(
  vector: AIEmbeddingVector,
): AIEmbeddingVector {
  const magnitude =
    calculateVectorMagnitude(
      vector,
    );

  if (magnitude === 0) {
    throw new AIEmbeddingServiceError(
      "INVALID_VECTOR",
      "No se puede normalizar un vector cuya magnitud es cero.",
      {
        receivedDimensions:
          vector.length,
      },
    );
  }

  return Object.freeze(
    vector.map(
      (value) =>
        value / magnitude,
    ),
  );
}

export function calculateDotProduct(
  left: AIEmbeddingVector,
  right: AIEmbeddingVector,
): number {
  validateEmbeddingVector(
    left,
  );

  validateEmbeddingVector(
    right,
    {
      expectedDimensions:
        left.length,
    },
  );

  return left.reduce(
    (
      total,
      value,
      index,
    ) =>
      total +
      value *
        (right[index] ?? 0),
    0,
  );
}

export function calculateCosineSimilarity(
  left: AIEmbeddingVector,
  right: AIEmbeddingVector,
): number {
  const dotProduct =
    calculateDotProduct(
      left,
      right,
    );

  const leftMagnitude =
    calculateVectorMagnitude(
      left,
    );

  const rightMagnitude =
    calculateVectorMagnitude(
      right,
    );

  if (
    leftMagnitude === 0 ||
    rightMagnitude === 0
  ) {
    throw new AIEmbeddingServiceError(
      "INVALID_VECTOR",
      "No se puede calcular similitud coseno con un vector de magnitud cero.",
    );
  }

  const similarity =
    dotProduct /
    (
      leftMagnitude *
      rightMagnitude
    );

  return Math.max(
    -1,
    Math.min(
      1,
      similarity,
    ),
  );
}

/* ============================================================================
 * CREACIÓN DE ENTRADAS
 * ========================================================================== */

export function createEmbeddingInput(
  id: AIIdentifier,
  text: string,
  metadata?: AIMetadata,
): AIEmbeddingInput {
  const input: {
    id: AIIdentifier;
    text: string;
    metadata?: AIMetadata;
  } = {
    id,
    text,
  };

  if (metadata !== undefined) {
    input.metadata = metadata;
  }

  return prepareEmbeddingInputs(
    [input],
  )[0] as AIEmbeddingInput;
}

export interface AICreateEmbeddingInputsOptions {
  readonly idPrefix?: string;
  readonly metadata?: AIMetadata;
  readonly maximumTextLength?: number;
  readonly trimText?: boolean;
}

export function createEmbeddingInputs(
  texts: readonly string[],
  options: AICreateEmbeddingInputsOptions = {},
): readonly AIEmbeddingInput[] {
  const prefix =
    options.idPrefix?.trim() ||
    "embedding-input";

  const inputs =
    texts.map(
      (
        text,
        index,
      ): AIEmbeddingInput => {
        const id =
          `${prefix}-${index + 1}`;

        if (
          options.metadata === undefined
        ) {
          return {
            id,
            text,
          };
        }

        return {
          id,
          text,
          metadata:
            options.metadata,
        };
      },
    );

  return prepareEmbeddingInputs(
    inputs,
    {
      maximumTextLength:
        options.maximumTextLength,
      trimText:
        options.trimText,
    },
  );
}

/* ============================================================================
 * DIVISIÓN POR LOTES
 * ========================================================================== */

export function splitEmbeddingInputsIntoBatches(
  inputs: readonly AIEmbeddingInput[],
  batchSize: number =
    DEFAULT_EMBEDDING_BATCH_SIZE,
): readonly (
  readonly AIEmbeddingInput[]
)[] {
      const normalizedBatchSize =
    normalizePositiveInteger(
      batchSize,
      DEFAULT_EMBEDDING_BATCH_SIZE,
    );

  const batches:
    AIEmbeddingInput[][] = [];

  for (
    let index = 0;
    index < inputs.length;
    index += normalizedBatchSize
  ) {
    batches.push(
      inputs.slice(
        index,
        index +
          normalizedBatchSize,
      ),
    );
  }

  return batches;
}

/* ============================================================================
 * VALIDACIÓN DE RESPUESTAS
 * ========================================================================== */

interface AIValidateProviderResponseOptions {
  readonly expectedInputs:
    readonly AIEmbeddingInput[];
  readonly expectedDimensions?:
    number;
  readonly normalizeVectors:
    boolean;
  readonly batchIndex:
    number;
}

function validateProviderResponse(
  response: AIEmbeddingResponse,
  options:
    AIValidateProviderResponseOptions,
): readonly AIEmbedding[] {
  const expectedIds =
    new Set(
      options.expectedInputs.map(
        (input) => input.id,
      ),
    );

  if (
    response.embeddings.length !==
    options.expectedInputs.length
  ) {
    throw new AIEmbeddingServiceError(
      "PROVIDER_RESPONSE_INVALID",
      [
        "El proveedor devolvió una cantidad incorrecta de embeddings.",
        `Esperados: ${options.expectedInputs.length}.`,
        `Recibidos: ${response.embeddings.length}.`,
      ].join(" "),
      {
        batchIndex:
          options.batchIndex,
        providerModel:
          response.model,
      },
    );
  }

  if (
    response.model.trim().length === 0
  ) {
    throw new AIEmbeddingServiceError(
      "PROVIDER_RESPONSE_INVALID",
      "El proveedor no informó el modelo utilizado para generar los embeddings.",
      {
        batchIndex:
          options.batchIndex,
      },
    );
  }

  const returnedIds =
    new Set<AIIdentifier>();

  return response.embeddings.map(
    (
      embedding,
    ): AIEmbedding => {
      if (
        !expectedIds.has(
          embedding.id,
        )
      ) {
        throw new AIEmbeddingServiceError(
          "PROVIDER_RESPONSE_INVALID",
          `El proveedor devolvió un embedding desconocido con identificador "${embedding.id}".`,
          {
            inputId:
              embedding.id,
            batchIndex:
              options.batchIndex,
            providerModel:
              response.model,
          },
        );
      }

      if (
        returnedIds.has(
          embedding.id,
        )
      ) {
        throw new AIEmbeddingServiceError(
          "PROVIDER_RESPONSE_INVALID",
          `El proveedor devolvió más de una vez el embedding "${embedding.id}".`,
          {
            inputId:
              embedding.id,
            batchIndex:
              options.batchIndex,
            providerModel:
              response.model,
          },
        );
      }

      returnedIds.add(
        embedding.id,
      );

      validateEmbeddingVector(
        embedding.vector,
        {
          expectedDimensions:
            options.expectedDimensions,
        },
      );

      if (
        embedding.dimensions !==
        embedding.vector.length
      ) {
        throw new AIEmbeddingServiceError(
          "DIMENSION_MISMATCH",
          [
            `El embedding "${embedding.id}" declara una cantidad incorrecta de dimensiones.`,
            `Declaradas: ${embedding.dimensions}.`,
            `Vector recibido: ${embedding.vector.length}.`,
          ].join(" "),
          {
            inputId:
              embedding.id,
            expectedDimensions:
              embedding.dimensions,
            receivedDimensions:
              embedding.vector.length,
            batchIndex:
              options.batchIndex,
            providerModel:
              response.model,
          },
        );
      }

      if (
        embedding.model.trim().length ===
        0
      ) {
        throw new AIEmbeddingServiceError(
          "PROVIDER_RESPONSE_INVALID",
          `El embedding "${embedding.id}" no contiene el nombre del modelo utilizado.`,
          {
            inputId:
              embedding.id,
            batchIndex:
              options.batchIndex,
            providerModel:
              response.model,
          },
        );
      }

      if (
        embedding.createdAt.trim().length ===
        0
      ) {
        throw new AIEmbeddingServiceError(
          "PROVIDER_RESPONSE_INVALID",
          `El embedding "${embedding.id}" no contiene una fecha de creación válida.`,
          {
            inputId:
              embedding.id,
            batchIndex:
              options.batchIndex,
            providerModel:
              response.model,
          },
        );
      }

      const vector =
        options.normalizeVectors
          ? normalizeEmbeddingVector(
              embedding.vector,
            )
          : embedding.vector;

      return createValidatedEmbedding(
        embedding,
        vector,
      );
    },
  );
}

/* ============================================================================
 * SERVICIO PRINCIPAL
 * ========================================================================== */

export function createEmbeddingService(
  config: AIEmbeddingServiceConfig,
): AIEmbeddingService {
  const batchSize =
    normalizePositiveInteger(
      config.batchSize,
      DEFAULT_EMBEDDING_BATCH_SIZE,
    );

  const maximumTextLength =
    normalizePositiveInteger(
      config.maximumTextLength,
      DEFAULT_MAXIMUM_EMBEDDING_TEXT_LENGTH,
    );

  const trimInputs =
    config.trimInputs ?? true;

  const normalizeVectors =
    config.normalizeVectors ??
    false;

  const rejectEmptyRequests =
    config.rejectEmptyRequests ??
    true;

  const defaultModel =
    config.defaultModel?.trim() ||
    undefined;

  return {
    async embed(
      request: AIEmbeddingRequest,
    ): Promise<AIEmbeddingResponse> {
      const startedAt =
        Date.now();

      throwIfAborted(
        request.signal,
      );

      if (
        request.inputs.length === 0
      ) {
        if (rejectEmptyRequests) {
          throw new AIEmbeddingServiceError(
            "INVALID_INPUT",
            "La solicitud de embeddings no contiene entradas.",
          );
        }

        return {
          embeddings: [],
          model:
            request.model?.trim() ||
            defaultModel ||
            "unknown",
          usageTokens: 0,
          durationMilliseconds: 0,
        };
      }

      const preparedInputs =
        prepareEmbeddingInputs(
          request.inputs,
          {
            maximumTextLength,
            trimText:
              trimInputs,
          },
        );

      const batches =
        splitEmbeddingInputsIntoBatches(
          preparedInputs,
          batchSize,
        );

      const requestedModel =
        request.model?.trim() ||
        defaultModel;

      const embeddings:
        AIEmbedding[] = [];

      let resolvedModel:
        string | undefined;

      let resolvedDimensions:
        number | undefined;

      let totalUsageTokens = 0;

      let hasUsageTokens =
        false;

      for (
        let batchIndex = 0;
        batchIndex < batches.length;
        batchIndex += 1
      ) {
        throwIfAborted(
          request.signal,
        );

        const batch =
          batches[batchIndex];

        if (batch === undefined) {
          continue;
        }

        const batchRequest =
          createBatchRequest(
            batch,
            requestedModel,
            request.signal,
          );

        let response:
          AIEmbeddingResponse;

        try {
          response =
            await config.provider.embed(
              batchRequest,
            );
        } catch (error) {
          if (
            request.signal?.aborted
          ) {
            throw new AIEmbeddingServiceError(
              "REQUEST_CANCELLED",
              "La generación de embeddings fue cancelada.",
              {
                batchIndex,
              },
              error,
            );
          }

          throw new AIEmbeddingServiceError(
            "EMBEDDING_ERROR",
            `El proveedor no pudo generar el lote de embeddings ${batchIndex + 1}.`,
            {
              batchIndex,
              providerModel:
                requestedModel,
            },
            error,
          );
        }

        throwIfAborted(
          request.signal,
        );

        const responseModel =
          response.model.trim();

        if (
          resolvedModel !== undefined &&
          resolvedModel !==
            responseModel
        ) {
          throw new AIEmbeddingServiceError(
            "PROVIDER_RESPONSE_INVALID",
            [
              "El proveedor utilizó modelos diferentes durante la misma solicitud.",
              `Modelo inicial: "${resolvedModel}".`,
              `Modelo recibido: "${responseModel}".`,
            ].join(" "),
            {
              batchIndex,
              providerModel:
                responseModel,
            },
          );
        }

        const firstEmbedding =
          response.embeddings[0];

        const batchDimensions =
          firstEmbedding?.vector.length;

        if (
          batchDimensions !== undefined &&
          resolvedDimensions !== undefined &&
          batchDimensions !==
            resolvedDimensions
        ) {
          throw new AIEmbeddingServiceError(
            "DIMENSION_MISMATCH",
            [
              "El proveedor devolvió dimensiones diferentes entre lotes.",
              `Dimensiones esperadas: ${resolvedDimensions}.`,
              `Dimensiones recibidas: ${batchDimensions}.`,
            ].join(" "),
            {
              expectedDimensions:
                resolvedDimensions,
              receivedDimensions:
                batchDimensions,
              batchIndex,
              providerModel:
                responseModel,
            },
          );
        }

        const validatedEmbeddings =
          validateProviderResponse(
            response,
            {
              expectedInputs:
                batch,
              expectedDimensions:
                resolvedDimensions,
              normalizeVectors,
              batchIndex,
            },
          );

        if (
          resolvedModel === undefined
        ) {
          resolvedModel =
            responseModel;
        }

        if (
          resolvedDimensions === undefined &&
          validatedEmbeddings[0] !==
            undefined
        ) {
          resolvedDimensions =
            validatedEmbeddings[0]
              .dimensions;
        }

        embeddings.push(
          ...validatedEmbeddings,
        );

        if (
          response.usageTokens !==
          undefined
        ) {
          totalUsageTokens +=
            response.usageTokens;

          hasUsageTokens =
            true;
        }
      }

      const finalModel =
        resolvedModel ??
        requestedModel ??
        "unknown";

      const result: {
        embeddings:
          readonly AIEmbedding[];
        model: string;
        usageTokens?: number;
        durationMilliseconds?: number;
      } = {
        embeddings,
        model:
          finalModel,
        durationMilliseconds:
          Date.now() -
          startedAt,
      };

      if (hasUsageTokens) {
        result.usageTokens =
          totalUsageTokens;
      }

      return result;
    },
  };
}

export * from "./embeddings";