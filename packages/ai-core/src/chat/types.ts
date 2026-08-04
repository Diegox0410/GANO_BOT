/**
 * @package @gano-bot/ai-core
 * @file chat/types.ts
 * @version 1.0.0
 *
 * Contratos públicos de la capa conversacional.
 *
 * Este módulo adapta los contratos generales AILLM* del núcleo
 * a una API especializada con nombres AIChat*.
 *
 * No contiene lógica de proveedores ni dependencias directas
 * de OpenAI, Gemini, Firebase o cualquier servicio externo.
 */

import type {
  AIIdentifier,
  AILLMFinishReason,
  AILLMGenerationOptions,
  AILLMModel,
  AILLMProvider,
  AILLMProviderName,
  AILLMRequest,
  AILLMResponse,
  AILLMStreamCompleted,
  AILLMStreamError,
  AILLMStreamEvent,
  AILLMStreamTextDelta,
  AILLMStreamToolCallDelta,
  AILLMStreamUsage,
  AILLMUsage,
  AIMessage,
  AIMessageContentPart,
  AIMessageContentType,
  AIMessageRole,
  AIMessageStatus,
  AIMetadata,
  AIToolCall,
  AIToolDefinition,
} from "../types";

/* ============================================================================
 * IDENTIFICADORES
 * ========================================================================== */

/**
 * Identificador de una solicitud de chat.
 */
export type AIChatRequestId =
  AIIdentifier;

/**
 * Identificador de una respuesta de chat.
 */
export type AIChatResponseId =
  AIIdentifier;

/**
 * Identificador de un mensaje de chat.
 */
export type AIChatMessageId =
  AIIdentifier;

/**
 * Nombre de un proveedor conversacional.
 */
export type AIChatProviderName =
  AILLMProviderName;

/* ============================================================================
 * MENSAJES
 * ========================================================================== */

/**
 * Rol de un mensaje dentro de una conversación.
 */
export type AIChatRole =
  AIMessageRole;

/**
 * Estado de procesamiento de un mensaje.
 */
export type AIChatMessageStatus =
  AIMessageStatus;

/**
 * Tipo principal de contenido de un mensaje.
 */
export type AIChatMessageContentType =
  AIMessageContentType;

/**
 * Parte multimodal o estructurada de un mensaje.
 */
export type AIChatMessageContentPart =
  AIMessageContentPart;

/**
 * Mensaje utilizado por la capa conversacional.
 *
 * Mantiene compatibilidad directa con AIMessage.
 */
export type AIChatMessage =
  AIMessage;

/* ============================================================================
 * HERRAMIENTAS
 * ========================================================================== */

/**
 * Definición de una herramienta disponible para el modelo.
 */
export type AIChatToolDefinition =
  AIToolDefinition;

/**
 * Llamada a una herramienta solicitada por el modelo.
 */
export type AIChatToolCall =
  AIToolCall;

/* ============================================================================
 * MODELOS
 * ========================================================================== */

/**
 * Información de un modelo conversacional.
 */
export type AIChatModel =
  AILLMModel;

/* ============================================================================
 * OPCIONES DE GENERACIÓN
 * ========================================================================== */

/**
 * Opciones utilizadas durante la generación de una respuesta.
 */
export type AIChatGenerationOptions =
  AILLMGenerationOptions;

/**
 * Motivo por el que finalizó una generación.
 */
export type AIChatFinishReason =
  AILLMFinishReason;

/**
 * Consumo de tokens reportado por el proveedor.
 */
export type AIChatUsage =
  AILLMUsage;

/* ============================================================================
 * SOLICITUD
 * ========================================================================== */

/**
 * Solicitud conversacional enviada a un proveedor.
 *
 * Es compatible directamente con AILLMRequest.
 */
export type AIChatRequest =
  AILLMRequest;

/**
 * Datos mínimos para construir una solicitud de chat.
 *
 * Este contrato resulta útil para servicios que generan internamente
 * el requestId antes de llamar al proveedor.
 */
export interface AIChatRequestInput {
  /**
   * Modelo solicitado.
   *
   * Cuando se omite, el proveedor debe utilizar su modelo
   * predeterminado.
   */
  readonly model?:
    string;

  /**
   * Instrucción principal del sistema.
   */
  readonly systemPrompt?:
    string;

  /**
   * Historial y mensaje actual de la conversación.
   */
  readonly messages:
    readonly AIChatMessage[];

  /**
   * Herramientas que el modelo puede solicitar.
   */
  readonly tools?:
    readonly AIChatToolDefinition[];

  /**
   * Parámetros de generación.
   */
  readonly options?:
    AIChatGenerationOptions;

  /**
   * Señal para cancelar la operación.
   */
  readonly signal?:
    AbortSignal;

  /**
   * Información adicional del consumidor.
   */
  readonly metadata?:
    AIMetadata;
}

/* ============================================================================
 * RESPUESTA
 * ========================================================================== */

/**
 * Respuesta conversacional normalizada.
 *
 * Es compatible directamente con AILLMResponse.
 */
export type AIChatResponse =
  AILLMResponse;

/**
 * Resultado mínimo esperado de una generación conversacional.
 *
 * Puede utilizarse internamente antes de completar campos como
 * identificadores, fechas, proveedor o duración.
 */
export interface AIChatGenerationResult {
  /**
   * Nombre del proveedor que produjo la respuesta.
   */
  readonly provider:
    AIChatProviderName;

  /**
   * Modelo utilizado realmente.
   */
  readonly model:
    string;

  /**
   * Contenido textual consolidado.
   */
  readonly content:
    string;

  /**
   * Mensaje normalizado del asistente.
   */
  readonly message:
    AIChatMessage;

  /**
   * Herramientas solicitadas por el modelo.
   */
  readonly toolCalls:
    readonly AIChatToolCall[];

  /**
   * Motivo de finalización.
   */
  readonly finishReason:
    AIChatFinishReason;

  /**
   * Consumo de tokens, cuando el proveedor lo entrega.
   */
  readonly usage?:
    AIChatUsage;

  /**
   * Respuesta original del proveedor.
   */
  readonly raw?:
    unknown;

  /**
   * Metadatos adicionales.
   */
  readonly metadata?:
    AIMetadata;
}

/* ============================================================================
 * STREAMING
 * ========================================================================== */

/**
 * Fragmento incremental de texto.
 */
export type AIChatStreamTextDelta =
  AILLMStreamTextDelta;

/**
 * Fragmento incremental de una llamada a herramienta.
 */
export type AIChatStreamToolCallDelta =
  AILLMStreamToolCallDelta;

/**
 * Evento con información de consumo.
 */
export type AIChatStreamUsage =
  AILLMStreamUsage;

/**
 * Evento que indica que la generación terminó.
 */
export type AIChatStreamCompleted =
  AILLMStreamCompleted;

/**
 * Evento de error durante una transmisión.
 */
export type AIChatStreamError =
  AILLMStreamError;

/**
 * Evento posible dentro de una transmisión conversacional.
 */
export type AIChatStreamEvent =
  AILLMStreamEvent;

/**
 * Alias semántico para consumidores que trabajan
 * con fragmentos de streaming.
 */
export type AIChatStreamChunk =
  AIChatStreamEvent;

/**
 * Flujo asíncrono de eventos conversacionales.
 */
export type AIChatStream =
  AsyncIterable<AIChatStreamEvent>;

/* ============================================================================
 * CAPACIDADES DEL PROVEEDOR
 * ========================================================================== */

/**
 * Capacidades declaradas por un proveedor conversacional.
 */
export interface AIChatProviderCapabilities {
  /**
   * Permite respuestas mediante streaming.
   */
  readonly supportsStreaming:
    boolean;

  /**
   * Permite llamadas a herramientas.
   */
  readonly supportsTools:
    boolean;

  /**
   * Permite solicitar respuestas JSON.
   */
  readonly supportsJson:
    boolean;

  /**
   * Permite mensajes con contenido multimodal.
   */
  readonly supportsMultimodal:
    boolean;

  /**
   * Permite utilizar una semilla determinista.
   */
  readonly supportsSeed:
    boolean;

  /**
   * Cantidad máxima conocida de tokens de contexto.
   */
  readonly maximumContextTokens?:
    number;

  /**
   * Cantidad máxima conocida de tokens de salida.
   */
  readonly maximumOutputTokens?:
    number;
}

/**
 * Descriptor público de un proveedor conversacional.
 */
export interface AIChatProviderDescriptor {
  /**
   * Identificador interno único.
   */
  readonly id:
    string;

  /**
   * Nombre utilizado por el contrato general AILLMProvider.
   */
  readonly name:
    AIChatProviderName;

  /**
   * Nombre legible para interfaces y diagnósticos.
   */
  readonly displayName:
    string;

  /**
   * Modelo predeterminado.
   */
  readonly defaultModel?:
    string;

  /**
   * Capacidades conocidas.
   */
  readonly capabilities:
    AIChatProviderCapabilities;

  /**
   * Indica si el proveedor está habilitado.
   */
  readonly enabled:
    boolean;

  /**
   * Metadatos adicionales.
   */
  readonly metadata?:
    AIMetadata;
}

/* ============================================================================
 * PROVEEDOR
 * ========================================================================== */

/**
 * Contrato principal de un proveedor conversacional.
 *
 * Extiende el contrato general AILLMProvider para conservar
 * compatibilidad con el núcleo existente.
 */
export interface AIChatProvider
  extends AILLMProvider {
  /**
   * Descriptor del proveedor.
   */
  readonly descriptor:
    AIChatProviderDescriptor;

  /**
   * Genera una respuesta completa.
   */
  generate(
    request: AIChatRequest,
  ): Promise<AIChatResponse>;

  /**
   * Genera una respuesta incremental.
   *
   * Es opcional porque algunos proveedores o modelos
   * pueden no soportar streaming.
   */
  stream?(
    request: AIChatRequest,
  ): AIChatStream;
}

/* ============================================================================
 * EVENTOS DEL CICLO DE VIDA
 * ========================================================================== */

/**
 * Contexto compartido por los eventos del ciclo de vida.
 */
export interface AIChatLifecycleContext {
  readonly request:
    AIChatRequest;

  readonly providerId:
    string;

  readonly providerName:
    AIChatProviderName;

  readonly model:
    string;

  readonly startedAt:
    number;
}

/**
 * Evento emitido antes de enviar la solicitud.
 */
export interface AIChatRequestStartedEvent {
  readonly type:
    "request-started";

  readonly context:
    AIChatLifecycleContext;
}

/**
 * Evento emitido después de recibir una respuesta completa.
 */
export interface AIChatRequestCompletedEvent {
  readonly type:
    "request-completed";

  readonly context:
    AIChatLifecycleContext;

  readonly response:
    AIChatResponse;
}

/**
 * Evento emitido cuando la solicitud falla.
 */
export interface AIChatRequestFailedEvent {
  readonly type:
    "request-failed";

  readonly context:
    AIChatLifecycleContext;

  readonly error:
    unknown;
}

/**
 * Eventos del ciclo de vida de una solicitud conversacional.
 */
export type AIChatLifecycleEvent =
  | AIChatRequestStartedEvent
  | AIChatRequestCompletedEvent
  | AIChatRequestFailedEvent;

/**
 * Observador de eventos del ciclo de vida.
 */
export type AIChatLifecycleListener = (
  event: AIChatLifecycleEvent,
) => void | Promise<void>;