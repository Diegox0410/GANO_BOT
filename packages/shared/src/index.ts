/**
 * @gano-bot/shared
 *
 * Tipos, contratos, constantes y utilidades compartidas por todas
 * las aplicaciones y paquetes del monorepo GanoBot.
 *
 * Este paquete no debe depender de React, Firebase, proveedores de IA
 * ni implementaciones concretas del negocio.
 */

export const GANO_BOT_SHARED_VERSION = "0.1.0" as const;

export const GANO_BOT_APP_NAME = "GanoBot" as const;

/**
 * Identificador genérico utilizado por entidades, mensajes,
 * conversaciones, documentos y solicitudes.
 */
export type Identifier = string;

/**
 * Fecha serializada utilizando el estándar ISO 8601.
 *
 * Ejemplo:
 * 2026-07-28T19:03:35.857Z
 */
export type ISODateString = string;

/**
 * Utilidad que permite que una propiedad también pueda ser null.
 */
export type Nullable<T> = T | null;

/**
 * Utilidad que representa un valor que puede estar ausente.
 */
export type Optional<T> = T | undefined;

/**
 * Utilidad para construir objetos parcialmente profundos.
 */
export type DeepPartial<T> = {
  [Key in keyof T]?: T[Key] extends object
    ? DeepPartial<T[Key]>
    : T[Key];
};

/**
 * Utilidad para construir objetos de solo lectura de forma profunda.
 */
export type DeepReadonly<T> = {
  readonly [Key in keyof T]: T[Key] extends object
    ? DeepReadonly<T[Key]>
    : T[Key];
};

/**
 * Estado genérico para operaciones asíncronas.
 */
export type AsyncStatus =
  | "idle"
  | "loading"
  | "success"
  | "error";

/**
 * Entidad base utilizada por modelos persistentes.
 */
export interface EntityBase {
  id: Identifier;
  createdAt?: ISODateString;
  updatedAt?: ISODateString;
}

/**
 * Referencia mínima de un usuario.
 */
export interface UserReference {
  id: Identifier;
  displayName?: string;
  email?: string;
  photoUrl?: string;
}

/**
 * Roles admitidos dentro de una conversación.
 */
export type ChatRole =
  | "system"
  | "user"
  | "assistant"
  | "tool";

/**
 * Estado de procesamiento de un mensaje.
 */
export type ChatMessageStatus =
  | "pending"
  | "streaming"
  | "completed"
  | "failed";

/**
 * Tipo de contenido representado por un mensaje.
 */
export type ChatContentType =
  | "text"
  | "markdown"
  | "error"
  | "system";

/**
 * Referencia de una fuente utilizada para producir una respuesta.
 */
export interface ChatSourceReference {
  id: Identifier;
  title: string;

  excerpt?: string;
  documentId?: Identifier;
  url?: string;

  score?: number;
  page?: number;

  metadata?: Record<string, unknown>;
}

/**
 * Mensaje individual de una conversación.
 */
export interface ChatMessage extends EntityBase {
  role: ChatRole;
  content: string;

  contentType?: ChatContentType;
  status?: ChatMessageStatus;

  conversationId?: Identifier;
  userId?: Identifier;

  sources?: ChatSourceReference[];

  metadata?: Record<string, unknown>;
}

/**
 * Estado de una conversación.
 */
export type ConversationStatus =
  | "active"
  | "archived"
  | "deleted";

/**
 * Conversación completa de GanoBot.
 */
export interface Conversation extends EntityBase {
  title?: string;
  status: ConversationStatus;

  userId?: Identifier;
  messages: ChatMessage[];

  context?: GanoBotContext;

  lastMessageAt?: ISODateString;

  metadata?: Record<string, unknown>;
}

/**
 * Información contextual del módulo de Gano Sim Premium desde el cual
 * se está utilizando GanoBot.
 */
export interface GanoBotContext {
  userId?: Identifier;
  sessionId?: Identifier;

  moduleId?: string;
  moduleName?: string;
  route?: string;

  currentRank?: string;
  packageCode?: string;
  cycleId?: Identifier;

  language?: string;
  timezone?: string;

  selectedEntityId?: Identifier;
  selectedEntityType?: string;

  metadata?: Record<string, unknown>;
}

/**
 * Error estandarizado para respuestas internas o HTTP.
 */
export interface ApiError {
  code: string;
  message: string;

  details?: Record<string, unknown>;
}

/**
 * Respuesta exitosa estandarizada.
 */
export interface ApiSuccessResponse<TData> {
  success: true;
  data: TData;

  requestId?: Identifier;
  timestamp?: ISODateString;

  metadata?: Record<string, unknown>;
}

/**
 * Respuesta fallida estandarizada.
 */
export interface ApiErrorResponse {
  success: false;
  error: ApiError;

  requestId?: Identifier;
  timestamp?: ISODateString;

  metadata?: Record<string, unknown>;
}

/**
 * Resultado genérico utilizado entre frontend, funciones y paquetes.
 */
export type ApiResponse<TData> =
  | ApiSuccessResponse<TData>
  | ApiErrorResponse;

/**
 * Datos para una colección paginada.
 */
export interface PaginatedData<TItem> {
  items: TItem[];

  total: number;
  page: number;
  pageSize: number;

  hasNextPage: boolean;
  hasPreviousPage: boolean;

  nextCursor?: string;
}

/**
 * Respuesta paginada estandarizada.
 */
export type PaginatedResponse<TItem> = ApiResponse<
  PaginatedData<TItem>
>;

/**
 * Comprueba si una respuesta representa una operación exitosa.
 */
export function isApiSuccess<TData>(
  response: ApiResponse<TData>,
): response is ApiSuccessResponse<TData> {
  return response.success;
}

/**
 * Comprueba si una respuesta representa una operación fallida.
 */
export function isApiError<TData>(
  response: ApiResponse<TData>,
): response is ApiErrorResponse {
  return !response.success;
}

/**
 * Crea una respuesta exitosa.
 */
export function createApiSuccess<TData>(
  data: TData,
  options: {
    requestId?: Identifier;
    timestamp?: ISODateString;
    metadata?: Record<string, unknown>;
  } = {},
): ApiSuccessResponse<TData> {
  const response: ApiSuccessResponse<TData> = {
    success: true,
    data,
  };

  if (options.requestId !== undefined) {
    response.requestId = options.requestId;
  }

  if (options.timestamp !== undefined) {
    response.timestamp = options.timestamp;
  }

  if (options.metadata !== undefined) {
    response.metadata = options.metadata;
  }

  return response;
}

/**
 * Crea una respuesta de error.
 */
export function createApiError(
  error: ApiError,
  options: {
    requestId?: Identifier;
    timestamp?: ISODateString;
    metadata?: Record<string, unknown>;
  } = {},
): ApiErrorResponse {
  const response: ApiErrorResponse = {
    success: false,
    error,
  };

  if (options.requestId !== undefined) {
    response.requestId = options.requestId;
  }

  if (options.timestamp !== undefined) {
    response.timestamp = options.timestamp;
  }

  if (options.metadata !== undefined) {
    response.metadata = options.metadata;
  }

  return response;
}

/**
 * Crea un identificador suficientemente único para operaciones locales.
 *
 * Para entidades persistentes se deberá utilizar posteriormente el ID
 * producido por Firestore o por el backend.
 */
export function createLocalIdentifier(
  prefix = "id",
): Identifier {
  const safePrefix = prefix.trim() || "id";

  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return `${safePrefix}_${globalThis.crypto.randomUUID()}`;
  }

  const timestamp = Date.now().toString(36);
  const randomPart = Math.random()
    .toString(36)
    .slice(2, 10);

  return `${safePrefix}_${timestamp}_${randomPart}`;
}

/**
 * Devuelve la fecha actual serializada como ISO 8601.
 */
export function createISODateString(
  date: Date = new Date(),
): ISODateString {
  return date.toISOString();
}

/**
 * Normaliza texto eliminando espacios exteriores.
 */
export function normalizeText(
  value: string | null | undefined,
): string {
  return value?.trim() ?? "";
}

/**
 * Comprueba que una cadena tenga contenido útil.
 */
export function isNonEmptyString(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}

/**
 * Limita un valor numérico entre un mínimo y un máximo.
 */
export function clampNumber(
  value: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }

  if (minimum > maximum) {
    return Math.min(
      minimum,
      Math.max(maximum, value),
    );
  }

  return Math.min(
    maximum,
    Math.max(minimum, value),
  );
}

/**
 * Elimina duplicados de una colección utilizando una clave.
 */
export function uniqueBy<TItem>(
  items: readonly TItem[],
  selector: (item: TItem) => string,
): TItem[] {
  const knownKeys = new Set<string>();
  const result: TItem[] = [];

  for (const item of items) {
    const key = selector(item);

    if (knownKeys.has(key)) {
      continue;
    }

    knownKeys.add(key);
    result.push(item);
  }

  return result;
}

/**
 * Comprueba de manera exhaustiva una unión discriminada.
 */
export function assertNever(
  value: never,
  message = "Se recibió un valor no contemplado.",
): never {
  throw new Error(
    `${message} Valor: ${String(value)}`,
  );
}