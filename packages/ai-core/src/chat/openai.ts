/**
 * @package @gano-bot/ai-core
 * @file chat/openai.ts
 * @version 1.0.0
 *
 * Proveedor conversacional OpenAI mediante API REST.
 *
 * Responsabilidades:
 * - Convertir solicitudes AIChatRequest al formato de OpenAI.
 * - Ejecutar solicitudes HTTP mediante fetch.
 * - Normalizar respuestas, uso de tokens y llamadas a herramientas.
 * - Integrarse con BaseAIChatProvider.
 * - No depender directamente del SDK oficial de OpenAI.
 */

import {
  AIChatProviderError,
  BaseAIChatProvider,
  createAIChatAssistantMessage,
  throwIfAIChatAborted,
} from "./base";

import type {
  BaseAIChatProviderConfig,
} from "./base";

import type {
  AIChatFinishReason,
  AIChatGenerationResult,
  AIChatMessage,
  AIChatProviderCapabilities,
  AIChatProviderDescriptor,
  AIChatRequest,
  AIChatToolCall,
  AIChatToolDefinition,
  AIChatUsage,
} from "./types";

import type {
  AIIdentifier,
  AIMetadata,
} from "../types";

/* ============================================================================
 * CONSTANTES
 * ========================================================================== */

export const DEFAULT_OPENAI_CHAT_BASE_URL =
  "https://api.openai.com/v1";

export const DEFAULT_OPENAI_CHAT_MODEL =
  "gpt-4.1-mini";

export const DEFAULT_OPENAI_CHAT_TIMEOUT_MS =
  60_000;

/* ============================================================================
 * CONFIGURACIÓN
 * ========================================================================== */

export interface OpenAIChatProviderConfig {
  /**
   * Clave privada de OpenAI.
   */
  readonly apiKey:
    string;

  /**
   * Modelo predeterminado.
   */
  readonly model?:
    string;

  /**
   * URL base de la API.
   */
  readonly baseUrl?:
    string;

  /**
   * Identificador opcional de organización.
   */
  readonly organization?:
    string;

  /**
   * Identificador opcional de proyecto.
   */
  readonly project?:
    string;

  /**
   * Tiempo máximo de espera en milisegundos.
   */
  readonly timeoutMilliseconds?:
    number;

  /**
   * Encabezados HTTP adicionales.
   */
  readonly headers?:
    Readonly<Record<string, string>>;

  /**
   * Implementación alternativa de fetch.
   *
   * Útil para pruebas, Firebase Functions o entornos personalizados.
   */
  readonly fetchImplementation?:
    typeof fetch;

  /**
   * Observadores del ciclo de vida.
   */
  readonly lifecycleListeners?:
    BaseAIChatProviderConfig["lifecycleListeners"];

  /**
   * Metadatos públicos del proveedor.
   */
  readonly metadata?:
    AIMetadata;
}

interface ResolvedOpenAIChatProviderConfig {
  readonly apiKey:
    string;

  readonly model:
    string;

  readonly baseUrl:
    string;

  readonly organization:
    string | undefined;

  readonly project:
    string | undefined;

  readonly timeoutMilliseconds:
    number;

  readonly headers:
    Readonly<Record<string, string>>;

  readonly fetchImplementation:
    typeof fetch;
}

/* ============================================================================
 * TIPOS INTERNOS DE OPENAI
 * ========================================================================== */

type OpenAIChatRole =
  | "system"
  | "developer"
  | "user"
  | "assistant"
  | "tool";

interface OpenAIChatFunctionCall {
  readonly name:
    string;

  readonly arguments:
    string;
}

interface OpenAIChatToolCall {
  readonly id:
    string;

  readonly type:
    "function";

  readonly function:
    OpenAIChatFunctionCall;
}

interface OpenAIChatRequestMessage {
  readonly role:
    OpenAIChatRole;

  readonly content?:
    string | null;

  readonly name?:
    string;

  readonly tool_call_id?:
    string;

  readonly tool_calls?:
    readonly OpenAIChatToolCall[];
}

interface OpenAIChatFunctionDefinition {
  readonly name:
    string;

  readonly description?:
    string;

  readonly parameters:
    unknown;
}

interface OpenAIChatToolDefinition {
  readonly type:
    "function";

  readonly function:
    OpenAIChatFunctionDefinition;
}

interface OpenAIChatCompletionRequestBody {
  readonly model:
    string;

  readonly messages:
    readonly OpenAIChatRequestMessage[];

  readonly tools?:
    readonly OpenAIChatToolDefinition[];

  readonly temperature?:
    number;

  readonly top_p?:
    number;

  readonly max_completion_tokens?:
    number;

  readonly stop?:
    readonly string[];

  readonly seed?:
    number;

  readonly response_format?:
    {
      readonly type:
        "text" | "json_object";
    };
}

interface OpenAIChatCompletionMessage {
  readonly role?:
    string;

  readonly content?:
    string | null;

  readonly tool_calls?:
    readonly OpenAIChatToolCall[];
}

interface OpenAIChatCompletionChoice {
  readonly index?:
    number;

  readonly message?:
    OpenAIChatCompletionMessage;

  readonly finish_reason?:
    string | null;
}

interface OpenAIChatCompletionUsage {
  readonly prompt_tokens?:
    number;

  readonly completion_tokens?:
    number;

  readonly total_tokens?:
    number;

  readonly prompt_tokens_details?:
    {
      readonly cached_tokens?:
        number;
    };

  readonly completion_tokens_details?:
    {
      readonly reasoning_tokens?:
        number;
    };
}

interface OpenAIChatCompletionResponse {
  readonly id?:
    string;

  readonly model?:
    string;

  readonly choices?:
    readonly OpenAIChatCompletionChoice[];

  readonly usage?:
    OpenAIChatCompletionUsage;

  readonly error?:
    {
      readonly message?:
        string;

      readonly type?:
        string;

      readonly code?:
        string | number | null;
    };
}

/* ============================================================================
 * CONFIGURACIÓN Y DESCRIPTOR
 * ========================================================================== */

function normalizeRequiredText(
  value:
    string,

  fieldName:
    string,
): string {
  const normalized =
    value.trim();

  if (
    normalized.length === 0
  ) {
    throw new AIChatProviderError(
      "INVALID_CONFIGURATION",
      `La configuración de OpenAI requiere un valor válido para "${fieldName}".`,
      {
        providerId:
          "openai",
      },
    );
  }

  return normalized;
}

function normalizeOptionalText(
  value:
    string | undefined,
): string | undefined {
  const normalized =
    value?.trim();

  return (
    normalized !== undefined &&
    normalized.length > 0
  )
    ? normalized
    : undefined;
}

function normalizeBaseUrl(
  value:
    string | undefined,
): string {
  const normalized =
    normalizeOptionalText(
      value,
    ) ??
    DEFAULT_OPENAI_CHAT_BASE_URL;

  return normalized.replace(
    /\/+$/g,
    "",
  );
}

function resolveTimeoutMilliseconds(
  value:
    number | undefined,
): number {
  const timeout =
    value ??
    DEFAULT_OPENAI_CHAT_TIMEOUT_MS;

  if (
    !Number.isFinite(
      timeout,
    ) ||
    timeout <= 0
  ) {
    throw new AIChatProviderError(
      "INVALID_CONFIGURATION",
      "El tiempo de espera de OpenAI debe ser un número mayor que cero.",
      {
        providerId:
          "openai",
      },
    );
  }

  return Math.floor(
    timeout,
  );
}

function resolveOpenAIConfig(
  config:
    OpenAIChatProviderConfig,
): ResolvedOpenAIChatProviderConfig {
  const fetchImplementation =
    config.fetchImplementation ??
    globalThis.fetch;

  if (
    typeof fetchImplementation !==
    "function"
  ) {
    throw new AIChatProviderError(
      "INVALID_CONFIGURATION",
      "El entorno actual no dispone de una implementación válida de fetch.",
      {
        providerId:
          "openai",
      },
    );
  }

  return Object.freeze({
    apiKey:
      normalizeRequiredText(
        config.apiKey,
        "apiKey",
      ),

    model:
      normalizeOptionalText(
        config.model,
      ) ??
      DEFAULT_OPENAI_CHAT_MODEL,

    baseUrl:
      normalizeBaseUrl(
        config.baseUrl,
      ),

    organization:
      normalizeOptionalText(
        config.organization,
      ),

    project:
      normalizeOptionalText(
        config.project,
      ),

    timeoutMilliseconds:
      resolveTimeoutMilliseconds(
        config.timeoutMilliseconds,
      ),

    headers:
      Object.freeze({
        ...(
          config.headers ??
          {}
        ),
      }),

    fetchImplementation,
  });
}

function createOpenAICapabilities():
  AIChatProviderCapabilities {
  return Object.freeze({
    supportsStreaming:
      false,

    supportsTools:
      true,

    supportsJson:
      true,

    supportsMultimodal:
      false,

    supportsSeed:
      true,
  });
}

function createOpenAIDescriptor(
  model:
    string,

  metadata:
    AIMetadata | undefined,
): AIChatProviderDescriptor {
  const descriptor: {
    id: string;
    name: "openai";
    displayName: string;
    defaultModel: string;
    capabilities: AIChatProviderCapabilities;
    enabled: boolean;
    metadata?: AIMetadata;
  } = {
    id:
      "openai",

    name:
      "openai",

    displayName:
      "OpenAI",

    defaultModel:
      model,

    capabilities:
      createOpenAICapabilities(),

    enabled:
      true,
  };

  if (
    metadata !== undefined
  ) {
    descriptor.metadata =
      metadata;
  }

  return Object.freeze(
    descriptor,
  );
}

/* ============================================================================
 * CONVERSIÓN DE MENSAJES
 * ========================================================================== */

function resolveToolCallsFromMetadata(
  message:
    AIChatMessage,
): readonly OpenAIChatToolCall[] | undefined {
  const metadata =
    message.metadata;

  if (
    metadata === undefined
  ) {
    return undefined;
  }

  const storedValue =
    metadata[
      "toolCalls"
    ];

  if (
    typeof storedValue !==
    "string"
  ) {
    return undefined;
  }

  let candidate:
    unknown;

  try {
    candidate =
      JSON.parse(
        storedValue,
      ) as unknown;
  } catch {
    return undefined;
  }

  if (
    !Array.isArray(
      candidate,
    )
  ) {
    return undefined;
  }

  const calls:
    OpenAIChatToolCall[] =
      [];

  for (
    const item of candidate
  ) {
    if (
      typeof item !==
        "object" ||
      item === null
    ) {
      continue;
    }

    const record =
      item as Readonly<
        Record<string, unknown>
      >;

    const id =
      typeof record["id"] ===
      "string"
        ? record["id"].trim()
        : "";

    const name =
      typeof record["name"] ===
      "string"
        ? record["name"].trim()
        : "";

    const argumentsValue =
      record[
        "arguments"
      ];

    if (
      id.length === 0 ||
      name.length === 0
    ) {
      continue;
    }

    let serializedArguments:
      string;

    if (
      typeof argumentsValue ===
      "string"
    ) {
      serializedArguments =
        argumentsValue;
    } else {
      try {
        serializedArguments =
          JSON.stringify(
            argumentsValue ??
            {},
          );
      } catch {
        serializedArguments =
          "{}";
      }
    }

    calls.push({
      id,

      type:
        "function",

      function: {
        name,

        arguments:
          serializedArguments,
      },
    });
  }

  return calls.length > 0
    ? Object.freeze(
        calls,
      )
    : undefined;
}
function convertMessage(
  message:
    AIChatMessage,
): OpenAIChatRequestMessage {
  const common: {
    role: OpenAIChatRole;
    content?: string | null;
    name?: string;
    tool_call_id?: string;
    tool_calls?: readonly OpenAIChatToolCall[];
  } = {
    role:
      message.role,
  };

  if (
    message.role ===
    "tool"
  ) {
    common.content =
      message.content;

    if (
      message.toolCallId !==
      undefined
    ) {
      common.tool_call_id =
        message.toolCallId;
    }

    return common;
  }

  const toolCalls =
    message.role ===
    "assistant"
      ? resolveToolCallsFromMetadata(
          message,
        )
      : undefined;

  if (
    toolCalls !== undefined
  ) {
    common.tool_calls =
      toolCalls;

    common.content =
      message.content.length > 0
        ? message.content
        : null;
  } else {
    common.content =
      message.content;
  }

  if (
    message.name !==
    undefined
  ) {
    common.name =
      message.name;
  }

  return common;
}

function convertMessages(
  request:
    AIChatRequest,
): readonly OpenAIChatRequestMessage[] {
  const messages:
    OpenAIChatRequestMessage[] =
      [];

  if (
    request.systemPrompt !==
    undefined &&
    request.systemPrompt.trim()
      .length > 0
  ) {
    messages.push({
      role:
        "system",

      content:
        request.systemPrompt.trim(),
    });
  }

  messages.push(
    ...request.messages.map(
      convertMessage,
    ),
  );

  return Object.freeze(
    messages,
  );
}

/* ============================================================================
 * CONVERSIÓN DE HERRAMIENTAS
 * ========================================================================== */

function readToolField(
  tool:
    AIChatToolDefinition,

  key:
    string,
): unknown {
  return (
    tool as unknown as
      Readonly<
        Record<string, unknown>
      >
  )[key];
}

function convertTool(
  tool:
    AIChatToolDefinition,
): OpenAIChatToolDefinition {
  const nameCandidate =
    readToolField(
      tool,
      "name",
    );

  const descriptionCandidate =
    readToolField(
      tool,
      "description",
    );

  const parametersCandidate =
    readToolField(
      tool,
      "parameters",
    ) ??
    readToolField(
      tool,
      "inputSchema",
    );

  const name =
    typeof nameCandidate ===
    "string"
      ? nameCandidate.trim()
      : "";

  if (
    name.length === 0
  ) {
    throw new AIChatProviderError(
      "INVALID_REQUEST",
      "Todas las herramientas enviadas a OpenAI deben tener un nombre válido.",
      {
        providerId:
          "openai",
      },
    );
  }

  const definition: {
    name: string;
    description?: string;
    parameters: unknown;
  } = {
    name,

    parameters:
      parametersCandidate ??
      {
        type:
          "object",

        properties:
          {},

        additionalProperties:
          false,
      },
  };

  if (
    typeof descriptionCandidate ===
      "string" &&
    descriptionCandidate.trim()
      .length > 0
  ) {
    definition.description =
      descriptionCandidate.trim();
  }

  return {
    type:
      "function",

    function:
      definition,
  };
}

function convertTools(
  tools:
    readonly AIChatToolDefinition[] |
    undefined,
): readonly OpenAIChatToolDefinition[] | undefined {
  if (
    tools === undefined ||
    tools.length === 0
  ) {
    return undefined;
  }

  return Object.freeze(
    tools.map(
      convertTool,
    ),
  );
}

/* ============================================================================
 * CONSTRUCCIÓN DE LA SOLICITUD
 * ========================================================================== */

function createRequestBody(
  request:
    AIChatRequest,

  model:
    string,
): OpenAIChatCompletionRequestBody {
  const tools =
    convertTools(
      request.tools,
    );

  const options =
    request.options;

  const body: {
    model: string;
    messages: readonly OpenAIChatRequestMessage[];
    tools?: readonly OpenAIChatToolDefinition[];
    temperature?: number;
    top_p?: number;
    max_completion_tokens?: number;
    stop?: readonly string[];
    seed?: number;
    response_format?: {
      type:
        "text" | "json_object";
    };
  } = {
    model,

    messages:
      convertMessages(
        request,
      ),
  };

  if (
    tools !== undefined
  ) {
    body.tools =
      tools;
  }

  if (
    options?.temperature !==
    undefined
  ) {
    body.temperature =
      options.temperature;
  }

  if (
    options?.topP !==
    undefined
  ) {
    body.top_p =
      options.topP;
  }

  if (
    options?.maximumOutputTokens !==
    undefined
  ) {
    body.max_completion_tokens =
      options.maximumOutputTokens;
  }

  if (
    options?.stopSequences !==
      undefined &&
    options.stopSequences.length >
      0
  ) {
    body.stop =
      options.stopSequences;
  }

  if (
    options?.seed !==
    undefined
  ) {
    body.seed =
      options.seed;
  }

  if (
    options?.responseFormat !==
    undefined
  ) {
    body.response_format = {
      type:
        options.responseFormat ===
        "json"
          ? "json_object"
          : "text",
    };
  }

  return body;
}

/* ============================================================================
 * NORMALIZACIÓN DE RESPUESTAS
 * ========================================================================== */

function normalizeFinishReason(
  value:
    string | null | undefined,
): AIChatFinishReason {
  switch (
    value
  ) {
    case "stop":
      return "stop";

    case "length":
      return "length";

    case "tool_calls":
    case "function_call":
      return "tool_calls";

    case "content_filter":
      return "content_filter";

    default:
      return "unknown";
  }
}

function normalizeUsage(
  usage:
    OpenAIChatCompletionUsage |
    undefined,
): AIChatUsage | undefined {
  if (
    usage === undefined
  ) {
    return undefined;
  }

  const inputTokens =
    usage.prompt_tokens ??
    0;

  const outputTokens =
    usage.completion_tokens ??
    0;

  const totalTokens =
    usage.total_tokens ??
    (
      inputTokens +
      outputTokens
    );

  const result: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedInputTokens?: number;
    reasoningTokens?: number;
  } = {
    inputTokens,

    outputTokens,

    totalTokens,
  };

  const cachedInputTokens =
    usage
      .prompt_tokens_details
      ?.cached_tokens;

  if (
    cachedInputTokens !==
    undefined
  ) {
    result.cachedInputTokens =
      cachedInputTokens;
  }

  const reasoningTokens =
    usage
      .completion_tokens_details
      ?.reasoning_tokens;

  if (
    reasoningTokens !==
    undefined
  ) {
    result.reasoningTokens =
      reasoningTokens;
  }

  return Object.freeze(
    result,
  );
}

function parseToolArguments(
  value:
    string,
): unknown {
  const normalized =
    value.trim();

  if (
    normalized.length === 0
  ) {
    return {};
  }

  try {
    return JSON.parse(
      normalized,
    ) as unknown;
  } catch {
    return value;
  }
}

function normalizeToolCalls(
  calls:
    readonly OpenAIChatToolCall[] |
    undefined,
): readonly AIChatToolCall[] {
  if (
    calls === undefined
  ) {
    return Object.freeze(
      [],
    );
  }

  return Object.freeze(
    calls.map(
      (
        call,
        index,
      ) => {
        const id =
          call.id.trim().length > 0
            ? call.id
            : `openai_tool_${index + 1}`;

        return Object.freeze({
          id:
            id as AIIdentifier,

          name:
            call.function.name,

          arguments:
            parseToolArguments(
              call.function.arguments,
            ),
        }) as AIChatToolCall;
      },
    ),
  );
}

/* ============================================================================
 * CONTROL DE TIEMPO Y CANCELACIÓN
 * ========================================================================== */

interface CombinedAbortController {
  readonly signal:
    AbortSignal;

  readonly dispose:
    () => void;

  readonly didTimeout:
    () => boolean;
}

function createCombinedAbortController(
  externalSignal:
    AbortSignal | undefined,

  timeoutMilliseconds:
    number,
): CombinedAbortController {
  const controller =
    new AbortController();

  let timedOut =
    false;

  const timeoutId =
    setTimeout(
      () => {
        timedOut =
          true;

        controller.abort();
      },
      timeoutMilliseconds,
    );

  const handleExternalAbort =
    (): void => {
      controller.abort();
    };

  if (
    externalSignal !== undefined
  ) {
    if (
      externalSignal.aborted
    ) {
      controller.abort();
    } else {
      externalSignal.addEventListener(
        "abort",
        handleExternalAbort,
        {
          once:
            true,
        },
      );
    }
  }

  return {
    signal:
      controller.signal,

    dispose:
      () => {
        clearTimeout(
          timeoutId,
        );

        externalSignal
          ?.removeEventListener(
            "abort",
            handleExternalAbort,
          );
      },

    didTimeout:
      () =>
        timedOut,
  };
}

/* ============================================================================
 * IMPLEMENTACIÓN
 * ========================================================================== */

export class OpenAIChatProvider
  extends BaseAIChatProvider {
  private readonly openAIConfig:
    ResolvedOpenAIChatProviderConfig;

  public constructor(
    config:
      OpenAIChatProviderConfig,
  ) {
    const resolved =
      resolveOpenAIConfig(
        config,
      );

    const descriptor =
      createOpenAIDescriptor(
        resolved.model,
        config.metadata,
      );

    super({
      descriptor,

      defaultModel:
        resolved.model,

      lifecycleListeners:
        config.lifecycleListeners,
    });

    this.openAIConfig =
      resolved;
  }

  protected async generateChatResponse(
    request:
      AIChatRequest,

    model:
      string,
  ): Promise<AIChatGenerationResult> {
    throwIfAIChatAborted(
      request.signal,
      {
        providerId:
          this.descriptor.id,

        providerName:
          this.descriptor.name,

        model,

        requestId:
          request.requestId,
      },
    );

    const abortController =
      createCombinedAbortController(
        request.signal,
        this.openAIConfig
          .timeoutMilliseconds,
      );

    try {
      const response =
        await this.openAIConfig
          .fetchImplementation(
            `${this.openAIConfig.baseUrl}/chat/completions`,
            {
              method:
                "POST",

              headers:
                this.createHeaders(),

              body:
                JSON.stringify(
                  createRequestBody(
                    request,
                    model,
                  ),
                ),

              signal:
                abortController.signal,
            },
          );

      const payload =
        await this.readResponsePayload(
          response,
        );

      if (
        !response.ok
      ) {
        throw this.createHTTPError(
          response.status,
          payload,
          request,
          model,
        );
      }

      return this.normalizeResponse(
        payload,
        request,
        model,
      );
    } catch (error) {
      if (
        abortController.didTimeout()
      ) {
        throw new AIChatProviderError(
          "PROVIDER_ERROR",
          `La solicitud a OpenAI excedió el tiempo máximo de ${this.openAIConfig.timeoutMilliseconds} ms.`,
          {
            providerId:
              this.descriptor.id,

            providerName:
              this.descriptor.name,

            model,

            requestId:
              request.requestId,

            retryable:
              true,
          },
          error,
        );
      }

      throw error;
    } finally {
      abortController.dispose();
    }
  }

  private createHeaders():
    Readonly<Record<string, string>> {
    const headers: Record<
      string,
      string
    > = {
      "Content-Type":
        "application/json",

      Authorization:
        `Bearer ${this.openAIConfig.apiKey}`,

      ...this.openAIConfig.headers,
    };

    if (
      this.openAIConfig
        .organization !==
      undefined
    ) {
      headers[
        "OpenAI-Organization"
      ] =
        this.openAIConfig
          .organization;
    }

    if (
      this.openAIConfig.project !==
      undefined
    ) {
      headers[
        "OpenAI-Project"
      ] =
        this.openAIConfig.project;
    }

    return headers;
  }

  private async readResponsePayload(
    response:
      Response,
  ): Promise<OpenAIChatCompletionResponse> {
    const text =
      await response.text();

    if (
      text.trim().length === 0
    ) {
      return {};
    }

    try {
      return JSON.parse(
        text,
      ) as OpenAIChatCompletionResponse;
    } catch (error) {
      throw new AIChatProviderError(
        "INVALID_PROVIDER_RESPONSE",
        "OpenAI devolvió una respuesta que no contiene JSON válido.",
        {
          providerId:
            this.descriptor.id,

          providerName:
            this.descriptor.name,

          statusCode:
            response.status,
        },
        error,
      );
    }
  }

  private createHTTPError(
    statusCode:
      number,

    payload:
      OpenAIChatCompletionResponse,

    request:
      AIChatRequest,

    model:
      string,
  ): AIChatProviderError {
    const providerMessage =
      payload.error?.message
        ?.trim();

    const message =
      providerMessage !==
        undefined &&
      providerMessage.length > 0
        ? providerMessage
        : `OpenAI respondió con el estado HTTP ${statusCode}.`;

    return new AIChatProviderError(
      "PROVIDER_ERROR",
      message,
      {
        providerId:
          this.descriptor.id,

        providerName:
          this.descriptor.name,

        model,

        requestId:
          request.requestId,

        statusCode,

        retryable:
          statusCode === 408 ||
          statusCode === 409 ||
          statusCode === 429 ||
          statusCode >= 500,
      },
      payload,
    );
  }

  private normalizeResponse(
    payload:
      OpenAIChatCompletionResponse,

    request:
      AIChatRequest,

    requestedModel:
      string,
  ): AIChatGenerationResult {
    const choice =
      payload.choices?.[0];

    const message =
      choice?.message;

    if (
      choice === undefined ||
      message === undefined
    ) {
      throw new AIChatProviderError(
        "INVALID_PROVIDER_RESPONSE",
        "OpenAI no devolvió ninguna opción de respuesta válida.",
        {
          providerId:
            this.descriptor.id,

          providerName:
            this.descriptor.name,

          model:
            requestedModel,

          requestId:
            request.requestId,
        },
        payload,
      );
    }

    const content =
      message.content ??
      "";

    const toolCalls =
      normalizeToolCalls(
        message.tool_calls,
      );

    if (
      content.length === 0 &&
      toolCalls.length === 0
    ) {
      throw new AIChatProviderError(
        "INVALID_PROVIDER_RESPONSE",
        "OpenAI devolvió una respuesta sin contenido ni llamadas a herramientas.",
        {
          providerId:
            this.descriptor.id,

          providerName:
            this.descriptor.name,

          model:
            requestedModel,

          requestId:
            request.requestId,
        },
        payload,
      );
    }

    const messageMetadata: AIMetadata =
  toolCalls.length > 0
    ? {
        toolCalls:
          JSON.stringify(
            toolCalls.map(
              (
                toolCall,
              ) => ({
                id:
                  toolCall.id,

                name:
                  toolCall.name,

                arguments:
                  toolCall.arguments,
              }),
            ),
          ),
      }
    : {};
    const assistantMessage =
      createAIChatAssistantMessage({
        messageId:
          payload.id as
            | AIIdentifier
            | undefined,

        content,

        toolCalls,

        metadata:
          messageMetadata,
      });

    const usage =
      normalizeUsage(
        payload.usage,
      );

    const result: {
      provider: "openai";
      model: string;
      content: string;
      message: typeof assistantMessage;
      toolCalls: readonly AIChatToolCall[];
      finishReason: AIChatFinishReason;
      usage?: AIChatUsage;
      raw: OpenAIChatCompletionResponse;
    } = {
      provider:
        "openai",

      model:
        normalizeOptionalText(
          payload.model,
        ) ??
        requestedModel,

      content,

      message:
        assistantMessage,

      toolCalls,

      finishReason:
        normalizeFinishReason(
          choice.finish_reason,
        ),

      raw:
        payload,
    };

    if (
      usage !== undefined
    ) {
      result.usage =
        usage;
    }

    return Object.freeze(
      result,
    );
  }
}

/* ============================================================================
 * FACTORÍA
 * ========================================================================== */

/**
 * Crea un proveedor conversacional de OpenAI.
 */
export function createOpenAIChatProvider(
  config:
    OpenAIChatProviderConfig,
): OpenAIChatProvider {
  return new OpenAIChatProvider(
    config,
  );
} 