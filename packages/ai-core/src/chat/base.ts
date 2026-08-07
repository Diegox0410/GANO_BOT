/**
 * @package @gano-bot/ai-core
 * @file chat/base.ts
 * @version 1.0.0
 *
 * Infraestructura base para proveedores conversacionales.
 *
 * Responsabilidades:
 * - Validar solicitudes de chat.
 * - Resolver el modelo que utilizará el proveedor.
 * - Controlar cancelaciones.
 * - Crear identificadores y fechas normalizadas.
 * - Construir mensajes del asistente.
 * - Emitir eventos del ciclo de vida.
 * - Normalizar respuestas de proveedores externos.
 *
 * Este módulo no realiza llamadas HTTP ni depende directamente
 * de OpenAI, Gemini, Firebase o cualquier servicio externo.
 */

import type {
  AIChatFinishReason,
  AIChatGenerationResult,
  AIChatLifecycleContext,
  AIChatLifecycleEvent,
  AIChatLifecycleListener,
  AIChatMessage,
  AIChatProvider,
  AIChatProviderDescriptor,
  AIChatRequest,
  AIChatResponse,
  AIChatStream,
  AIChatToolCall,
  AIChatUsage,
} from "./types.js";

import type {
  AIIdentifier,
  AIISODateString,
  AIMetadata,
} from "../types.js";

/* ============================================================================
 * CONSTANTES
 * ========================================================================== */

export const DEFAULT_CHAT_MODEL =
  "default" as const;

export const DEFAULT_CHAT_PROVIDER_ID =
  "unknown" as const;

/* ============================================================================
 * ERRORES
 * ========================================================================== */

export type AIChatProviderErrorCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_REQUEST"
  | "EMPTY_MESSAGES"
  | "INVALID_MESSAGE"
  | "MODEL_NOT_CONFIGURED"
  | "REQUEST_CANCELLED"
  | "PROVIDER_ERROR"
  | "INVALID_PROVIDER_RESPONSE"
  | "STREAMING_NOT_SUPPORTED";

export interface AIChatProviderErrorDetails {
  readonly providerId?:
    string;

  readonly providerName?:
    string;

  readonly model?:
    string;

  readonly requestId?:
    AIIdentifier;

  readonly messageIndex?:
    number;

  readonly statusCode?:
    number;

  readonly retryable?:
    boolean;

  readonly metadata?:
    AIMetadata;
}

export class AIChatProviderError
  extends Error {
  public override readonly name =
    "AIChatProviderError";

  public constructor(
    public readonly code:
      AIChatProviderErrorCode,

    message:
      string,

    public readonly details?:
      AIChatProviderErrorDetails,

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
 * CONFIGURACIÓN
 * ========================================================================== */

export interface BaseAIChatProviderConfig {
  /**
   * Descriptor público del proveedor.
   */
  readonly descriptor:
    AIChatProviderDescriptor;

  /**
   * Modelo utilizado cuando la solicitud no especifica uno.
   */
  readonly defaultModel?:
    string;

  /**
   * Observadores del ciclo de vida.
   */
  readonly lifecycleListeners?:
    readonly AIChatLifecycleListener[];

  /**
   * Permite solicitudes sin mensajes.
   *
   * Valor predeterminado: false.
   */
  readonly allowEmptyMessages?:
    boolean;

  /**
   * Elimina espacios al inicio y al final del contenido textual.
   *
   * Valor predeterminado: true.
   */
  readonly trimMessageContent?:
    boolean;
}

interface ResolvedBaseAIChatProviderConfig {
  readonly descriptor:
    AIChatProviderDescriptor;

  readonly defaultModel:
    string | undefined;

  readonly lifecycleListeners:
    readonly AIChatLifecycleListener[];

  readonly allowEmptyMessages:
    boolean;

  readonly trimMessageContent:
    boolean;
}

/* ============================================================================
 * UTILIDADES DE FECHA E IDENTIFICADORES
 * ========================================================================== */

export function createAIChatIdentifier(
  prefix = "chat",
): AIIdentifier {
  const normalizedPrefix =
    prefix
      .trim()
      .toLowerCase()
      .replace(
        /[^a-z0-9_-]+/g,
        "-",
      )
      .replace(
        /^-+|-+$/g,
        "",
      ) ||
    "chat";

  const timestamp =
    Date.now().toString(36);

  const randomPart =
    Math.random()
      .toString(36)
      .slice(2, 12);

  return `${normalizedPrefix}_${timestamp}_${randomPart}`;
}

export function createAIChatISODate():
  AIISODateString {
  return new Date().toISOString();
}

/* ============================================================================
 * CANCELACIÓN
 * ========================================================================== */

export function isAIChatAbortError(
  error:
    unknown,
): boolean {
  if (
    error instanceof Error &&
    error.name === "AbortError"
  ) {
    return true;
  }

  if (
    typeof error !== "object" ||
    error === null
  ) {
    return false;
  }

  const candidate =
    error as {
      readonly name?: unknown;
      readonly code?: unknown;
    };

  return (
    candidate.name ===
      "AbortError" ||
    candidate.code ===
      "ABORTED" ||
    candidate.code ===
      "REQUEST_CANCELLED"
  );
}

export function throwIfAIChatAborted(
  signal:
    AbortSignal | undefined,

  details?:
    AIChatProviderErrorDetails,
): void {
  if (
    signal?.aborted !== true
  ) {
    return;
  }

  throw new AIChatProviderError(
    "REQUEST_CANCELLED",
    "La solicitud conversacional fue cancelada.",
    details,
  );
}

/* ============================================================================
 * VALIDACIÓN DE CONFIGURACIÓN
 * ========================================================================== */

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

function validateDescriptor(
  descriptor:
    AIChatProviderDescriptor,
): AIChatProviderDescriptor {
  const id =
    descriptor.id
      .trim()
      .toLowerCase();

  if (
    id.length === 0
  ) {
    throw new AIChatProviderError(
      "INVALID_CONFIGURATION",
      "El descriptor del proveedor debe incluir un identificador válido.",
    );
  }

  if (
    !/^[a-z0-9][a-z0-9._-]*$/.test(
      id,
    )
  ) {
    throw new AIChatProviderError(
      "INVALID_CONFIGURATION",
      [
        `El identificador de proveedor "${descriptor.id}" no es válido.`,
        "Solo se permiten letras minúsculas, números, puntos, guiones y guiones bajos.",
      ].join(" "),
      {
        providerId:
          descriptor.id,
      },
    );
  }

  const displayName =
    descriptor.displayName.trim();

  if (
    displayName.length === 0
  ) {
    throw new AIChatProviderError(
      "INVALID_CONFIGURATION",
      `El proveedor "${id}" debe incluir un nombre visible.`,
      {
        providerId:
          id,
      },
    );
  }

  const defaultModel =
    normalizeOptionalText(
      descriptor.defaultModel,
    );

  const result: {
    id: string;
    name: AIChatProviderDescriptor["name"];
    displayName: string;
    defaultModel?: string;
    capabilities: AIChatProviderDescriptor["capabilities"];
    enabled: boolean;
    metadata?: AIMetadata;
  } = {
    id,
    name:
      descriptor.name,
    displayName,
    capabilities:
      descriptor.capabilities,
    enabled:
      descriptor.enabled,
  };

  if (
    defaultModel !== undefined
  ) {
    result.defaultModel =
      defaultModel;
  }

  if (
    descriptor.metadata !== undefined
  ) {
    result.metadata =
      descriptor.metadata;
  }

  return Object.freeze(
    result,
  );
}

function resolveBaseConfig(
  config:
    BaseAIChatProviderConfig,
): ResolvedBaseAIChatProviderConfig {
  const descriptor =
    validateDescriptor(
      config.descriptor,
    );

  const defaultModel =
    normalizeOptionalText(
      config.defaultModel,
    ) ??
    normalizeOptionalText(
      descriptor.defaultModel,
    );

  return Object.freeze({
    descriptor,
    defaultModel,
    lifecycleListeners:
      Object.freeze([
        ...(
          config.lifecycleListeners ??
          []
        ),
      ]),
    allowEmptyMessages:
      config.allowEmptyMessages ??
      false,
    trimMessageContent:
      config.trimMessageContent ??
      true,
  });
}

/* ============================================================================
 * VALIDACIÓN DE SOLICITUDES
 * ========================================================================== */

function validateMessage(
  message:
    AIChatMessage,

  index:
    number,

  trimContent:
    boolean,
): AIChatMessage {
  const id =
    message.id.trim();

  if (
    id.length === 0
  ) {
    throw new AIChatProviderError(
      "INVALID_MESSAGE",
      `El mensaje en la posición ${index} no tiene un identificador válido.`,
      {
        messageIndex:
          index,
      },
    );
  }

  const content =
    trimContent
      ? message.content.trim()
      : message.content;

  const hasParts =
    (
      message.parts?.length ??
      0
    ) > 0;

  if (
    content.length === 0 &&
    !hasParts &&
    message.role !== "assistant"
  ) {
    throw new AIChatProviderError(
      "INVALID_MESSAGE",
      `El mensaje "${id}" no contiene contenido.`,
      {
        messageIndex:
          index,
      },
    );
  }

  const result: {
    id: AIIdentifier;
    conversationId?: AIIdentifier;
    role: AIChatMessage["role"];
    content: string;
    contentType: AIChatMessage["contentType"];
    parts?: AIChatMessage["parts"];
    status: AIChatMessage["status"];
    createdAt: AIChatMessage["createdAt"];
    updatedAt: AIChatMessage["updatedAt"];
    name?: string;
    toolCallId?: AIIdentifier;
    metadata?: AIMetadata;
  } = {
    id,
    role:
      message.role,
    content,
    contentType:
      message.contentType,
    status:
      message.status,
    createdAt:
      message.createdAt,
    updatedAt:
      message.updatedAt,
  };

  if (
    message.conversationId !==
    undefined
  ) {
    result.conversationId =
      message.conversationId;
  }

  if (
    message.parts !== undefined
  ) {
    result.parts =
      message.parts;
  }

  if (
    message.name !== undefined
  ) {
    result.name =
      message.name;
  }

  if (
    message.toolCallId !==
    undefined
  ) {
    result.toolCallId =
      message.toolCallId;
  }

  if (
    message.metadata !==
    undefined
  ) {
    result.metadata =
      message.metadata;
  }

  return Object.freeze(
    result,
  );
}

export interface ValidateAIChatRequestOptions {
  readonly allowEmptyMessages?:
    boolean;

  readonly trimMessageContent?:
    boolean;
}

export function validateAIChatRequest(
  request:
    AIChatRequest,

  options:
    ValidateAIChatRequestOptions = {},
): AIChatRequest {
  throwIfAIChatAborted(
    request.signal,
    {
      requestId:
        request.requestId,
    },
  );

  const requestId =
    request.requestId.trim();

  if (
    requestId.length === 0
  ) {
    throw new AIChatProviderError(
      "INVALID_REQUEST",
      "La solicitud conversacional debe incluir un requestId válido.",
    );
  }

  const allowEmptyMessages =
    options.allowEmptyMessages ??
    false;

  if (
    request.messages.length === 0 &&
    !allowEmptyMessages
  ) {
    throw new AIChatProviderError(
      "EMPTY_MESSAGES",
      "La solicitud conversacional debe contener al menos un mensaje.",
      {
        requestId,
      },
    );
  }

  const trimMessageContent =
    options.trimMessageContent ??
    true;

  const messages =
    request.messages.map(
      (
        message,
        index,
      ) =>
        validateMessage(
          message,
          index,
          trimMessageContent,
        ),
    );

  const model =
    normalizeOptionalText(
      request.model,
    );

  const systemPrompt =
    normalizeOptionalText(
      request.systemPrompt,
    );

  const result: {
    requestId: AIIdentifier;
    model?: string;
    systemPrompt?: string;
    messages: readonly AIChatMessage[];
    tools?: AIChatRequest["tools"];
    options?: AIChatRequest["options"];
    signal?: AbortSignal;
    metadata?: AIMetadata;
  } = {
    requestId,
    messages:
      Object.freeze(
        messages,
      ),
  };

  if (
    model !== undefined
  ) {
    result.model =
      model;
  }

  if (
    systemPrompt !== undefined
  ) {
    result.systemPrompt =
      systemPrompt;
  }

  if (
    request.tools !== undefined
  ) {
    result.tools =
      request.tools;
  }

  if (
    request.options !== undefined
  ) {
    result.options =
      request.options;
  }

  if (
    request.signal !== undefined
  ) {
    result.signal =
      request.signal;
  }

  if (
    request.metadata !==
    undefined
  ) {
    result.metadata =
      request.metadata;
  }

  return Object.freeze(
    result,
  );
}

/* ============================================================================
 * CREACIÓN DE MENSAJES Y RESPUESTAS
 * ========================================================================== */

export interface CreateAIChatAssistantMessageInput {
  readonly content:
    string;

  readonly messageId?:
    AIIdentifier;

  readonly conversationId?:
    AIIdentifier;

  readonly toolCalls?:
    readonly AIChatToolCall[];

  readonly metadata?:
    AIMetadata;

  readonly createdAt?:
    AIISODateString;
}

export function createAIChatAssistantMessage(
  input:
    CreateAIChatAssistantMessageInput,
): AIChatMessage {
  const createdAt =
    input.createdAt ??
    createAIChatISODate();

  const messageId =
    normalizeOptionalText(
      input.messageId,
    ) ??
    createAIChatIdentifier(
      "message",
    );

  const result: {
    id: AIIdentifier;
    conversationId?: AIIdentifier;
    role: "assistant";
    content: string;
    contentType: "text";
    status: "completed";
    createdAt: AIISODateString;
    updatedAt: AIISODateString;
    metadata?: AIMetadata;
  } = {
    id:
      messageId,
    role:
      "assistant",
    content:
      input.content,
    contentType:
      "text",
    status:
      "completed",
    createdAt,
    updatedAt:
      createdAt,
  };

  if (
    input.conversationId !==
    undefined
  ) {
    result.conversationId =
      input.conversationId;
  }

  if (
    input.metadata !==
    undefined
  ) {
    result.metadata =
      input.metadata;
  }

  return Object.freeze(
    result,
  );
}

export interface CreateAIChatResponseInput {
  readonly request:
    AIChatRequest;

  readonly result:
    AIChatGenerationResult;

  readonly responseId?:
    AIIdentifier;

  readonly createdAt?:
    AIISODateString;

  readonly durationMilliseconds?:
    number;
}

export function createAIChatResponse(
  input:
    CreateAIChatResponseInput,
): AIChatResponse {
  const responseId =
    normalizeOptionalText(
      input.responseId,
    ) ??
    createAIChatIdentifier(
      "response",
    );

  const createdAt =
    input.createdAt ??
    createAIChatISODate();

  const result: {
    id: AIIdentifier;
    requestId: AIIdentifier;
    provider: AIChatResponse["provider"];
    model: string;
    content: string;
    message: AIChatMessage;
    toolCalls: readonly AIChatToolCall[];
    finishReason: AIChatFinishReason;
    usage?: AIChatUsage;
    createdAt: AIISODateString;
    durationMilliseconds?: number;
    raw?: unknown;
    metadata?: AIMetadata;
  } = {
    id:
      responseId,
    requestId:
      input.request.requestId,
    provider:
      input.result.provider,
    model:
      input.result.model,
    content:
      input.result.content,
    message:
      input.result.message,
    toolCalls:
      Object.freeze([
        ...input.result.toolCalls,
      ]),
    finishReason:
      input.result.finishReason,
    createdAt,
  };

  if (
    input.result.usage !==
    undefined
  ) {
    result.usage =
      input.result.usage;
  }

  if (
    input.durationMilliseconds !==
    undefined
  ) {
    result.durationMilliseconds =
      input.durationMilliseconds;
  }

  if (
    input.result.raw !==
    undefined
  ) {
    result.raw =
      input.result.raw;
  }

  if (
    input.result.metadata !==
    undefined
  ) {
    result.metadata =
      input.result.metadata;
  }

  return Object.freeze(
    result,
  );
}

/* ============================================================================
 * CLASE BASE
 * ========================================================================== */

export abstract class BaseAIChatProvider
  implements AIChatProvider {
  public readonly descriptor:
    AIChatProviderDescriptor;

  public readonly name:
    AIChatProviderDescriptor["name"];

  protected readonly defaultModel:
    string | undefined;

  private readonly lifecycleListeners:
    readonly AIChatLifecycleListener[];

  private readonly allowEmptyMessages:
    boolean;

  private readonly trimMessageContent:
    boolean;

  protected constructor(
    config:
      BaseAIChatProviderConfig,
  ) {
    const resolved =
      resolveBaseConfig(
        config,
      );

    this.descriptor =
      resolved.descriptor;

    this.name =
      resolved.descriptor.name;

    this.defaultModel =
      resolved.defaultModel;

    this.lifecycleListeners =
      resolved.lifecycleListeners;

    this.allowEmptyMessages =
      resolved.allowEmptyMessages;

    this.trimMessageContent =
      resolved.trimMessageContent;
  }

  /**
   * Genera una respuesta conversacional normalizada.
   */
  public async generate(
    request:
      AIChatRequest,
  ): Promise<AIChatResponse> {
    const validatedRequest =
      validateAIChatRequest(
        request,
        {
          allowEmptyMessages:
            this.allowEmptyMessages,

          trimMessageContent:
            this.trimMessageContent,
        },
      );

    const model =
      this.resolveModel(
        validatedRequest.model,
      );

    const startedAt =
      Date.now();

    const context:
      AIChatLifecycleContext =
        Object.freeze({
          request:
            validatedRequest,

          providerId:
            this.descriptor.id,

          providerName:
            this.descriptor.name,

          model,

          startedAt,
        });

    await this.emitLifecycleEvent({
      type:
        "request-started",

      context,
    });

    try {
      throwIfAIChatAborted(
        validatedRequest.signal,
        {
          providerId:
            this.descriptor.id,

          providerName:
            this.descriptor.name,

          model,

          requestId:
            validatedRequest.requestId,
        },
      );

      const generationResult =
        await this.generateChatResponse(
          validatedRequest,
          model,
        );

      throwIfAIChatAborted(
        validatedRequest.signal,
        {
          providerId:
            this.descriptor.id,

          providerName:
            this.descriptor.name,

          model,

          requestId:
            validatedRequest.requestId,
        },
      );

      const response =
        createAIChatResponse({
          request:
            validatedRequest,

          result:
            generationResult,

          durationMilliseconds:
            Date.now() -
            startedAt,
        });

      await this.emitLifecycleEvent({
        type:
          "request-completed",

        context,

        response,
      });

      return response;
    } catch (error) {
      const normalizedError =
        this.normalizeProviderError(
          error,
          validatedRequest,
          model,
        );

      await this.emitLifecycleEvent({
        type:
          "request-failed",

        context,

        error:
          normalizedError,
      });

      throw normalizedError;
    }
  }

  /**
   * Streaming opcional.
   *
   * Las subclases pueden sobrescribirlo cuando el proveedor
   * soporte transmisión incremental.
   */
  public stream(
    request:
      AIChatRequest,
  ): AIChatStream {
    void request;

    throw new AIChatProviderError(
      "STREAMING_NOT_SUPPORTED",
      `El proveedor "${this.descriptor.id}" no soporta streaming.`,
      {
        providerId:
          this.descriptor.id,

        providerName:
          this.descriptor.name,

        retryable:
          false,
      },
    );
  }

  /**
   * Implementación específica del proveedor.
   */
  protected abstract generateChatResponse(
    request:
      AIChatRequest,

    model:
      string,
  ): Promise<AIChatGenerationResult>;

  /**
   * Resuelve el modelo solicitado o el modelo predeterminado.
   */
  protected resolveModel(
    requestedModel:
      string | undefined,
  ): string {
    const model =
      normalizeOptionalText(
        requestedModel,
      ) ??
      this.defaultModel;

    if (
      model === undefined
    ) {
      throw new AIChatProviderError(
        "MODEL_NOT_CONFIGURED",
        `El proveedor "${this.descriptor.id}" no tiene un modelo configurado.`,
        {
          providerId:
            this.descriptor.id,

          providerName:
            this.descriptor.name,
        },
      );
    }

    return model;
  }

  /**
   * Convierte errores externos a errores normalizados.
   */
  protected normalizeProviderError(
    error:
      unknown,

    request:
      AIChatRequest,

    model:
      string,
  ): AIChatProviderError {
    if (
      error instanceof
      AIChatProviderError
    ) {
      return error;
    }

    if (
      request.signal?.aborted ===
        true ||
      isAIChatAbortError(
        error,
      )
    ) {
      return new AIChatProviderError(
        "REQUEST_CANCELLED",
        `La solicitud al proveedor "${this.descriptor.id}" fue cancelada.`,
        {
          providerId:
            this.descriptor.id,

          providerName:
            this.descriptor.name,

          model,

          requestId:
            request.requestId,

          retryable:
            false,
        },
        error,
      );
    }

    return new AIChatProviderError(
      "PROVIDER_ERROR",
      `El proveedor "${this.descriptor.id}" no pudo generar una respuesta.`,
      {
        providerId:
          this.descriptor.id,

        providerName:
          this.descriptor.name,

        model,

        requestId:
          request.requestId,
      },
      error,
    );
  }

  /**
   * Emite un evento sin permitir que un observador rompa
   * el flujo principal de generación.
   */
  protected async emitLifecycleEvent(
    event:
      AIChatLifecycleEvent,
  ): Promise<void> {
    for (
      const listener of
      this.lifecycleListeners
    ) {
      try {
        await listener(
          event,
        );
      } catch {
        // Los errores de observabilidad no deben interrumpir
        // la generación principal.
      }
    }
  }
} 