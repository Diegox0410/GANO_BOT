import type {
  AIMetadata,
  AIMessage,
  AssistantDescriptor,
} from "@gano-bot/ai-core";
import type {
  ToolDescriptor,
  ToolExecutionResult,
} from "@gano-bot/ai-core/tools-engine";
export type ApiRole =
  | "guest"
  | "user"
  | "operator"
  | "assistant-admin"
  | "tenant-admin"
  | "platform-admin";
export type ApiPermission =
  | "platform:read"
  | "platform:write"
  | "platform:admin"
  | "tenants:read"
  | "tenants:create"
  | "tenants:update"
  | "tenants:suspend"
  | "tenants:archive"
  | "users:read"
  | "users:create"
  | "users:update"
  | "users:suspend"
  | "users:delete"
  | "users:invite"
  | "assistants:read"
  | "assistants:create"
  | "assistants:update"
  | "assistants:publish"
  | "assistants:archive"
  | "assistants:delete"
  | "assistants:write"
  | "conversations:read"
  | "conversations:write"
  | "conversations:delete"
  | "conversations:export"
  | "chat:execute"
  | "knowledge:read"
  | "knowledge:write"
  | "knowledge:create"
  | "knowledge:update"
  | "knowledge:delete"
  | "ingestion:execute"
  | "tools:execute"
  | "tools:admin"
  | "tools:read"
  | "tools:configure"
  | "metrics:read"
  | "usage:read"
  | "costs:read"
  | "audit:read"
  | "audit:export"
  | "security:read"
  | "security:update"
  | "admin:*";
export interface ApiPrincipal {
  readonly actorId: string;
  readonly tenantId: string;
  readonly roles: readonly ApiRole[];
  readonly permissions: readonly ApiPermission[];
  readonly assistantIds?: readonly string[];
  readonly authenticated: boolean;
}
export interface ApiRequestContext {
  readonly requestId: string;
  readonly correlationId: string;
  readonly tenantId: string;
  readonly assistantId?: string;
  readonly conversationId?: string;
  readonly principal: ApiPrincipal;
  readonly locale: string;
  readonly userAgent?: string;
  readonly clientIp?: string;
  readonly startedAt: string;
  readonly signal: AbortSignal;
}
export interface AuthenticationResult {
  readonly principal?: ApiPrincipal;
  readonly reason?: string;
}
export interface AuthenticationProvider {
  authenticate(
    request: Request,
    signal: AbortSignal,
  ): Promise<AuthenticationResult>;
}
export interface TokenVerifier {
  verify(token: string, signal: AbortSignal): Promise<ApiPrincipal | undefined>;
}
export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "RATE_LIMITED"
  | "REQUEST_TIMEOUT"
  | "REQUEST_CANCELLED"
  | "ASSISTANT_NOT_FOUND"
  | "CONVERSATION_NOT_FOUND"
  | "KNOWLEDGE_NOT_FOUND"
  | "TOOL_CONFIRMATION_REQUIRED"
  | "TOOL_EXECUTION_FAILED"
  | "INGESTION_FAILED"
  | "PROVIDER_FAILED"
  | "RAG_FAILED"
  | "INTERNAL_ERROR"
  | "SERVICE_UNAVAILABLE";
export interface ApiErrorDetail {
  readonly path?: string;
  readonly message: string;
}
export interface ApiSuccessResponse<T> {
  readonly success: true;
  readonly data: T;
  readonly requestId: string;
  readonly correlationId: string;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
}
export interface ApiErrorResponse {
  readonly success: false;
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly details: readonly ApiErrorDetail[];
  };
  readonly requestId: string;
  readonly correlationId: string;
}
export interface ConversationApiResource {
  readonly id: string;
  readonly tenantId: string;
  readonly assistantId: string;
  readonly ownerId: string;
  readonly messages: readonly AIMessage[];
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface ConversationRepository {
  save(value: ConversationApiResource): Promise<void>;
  get(
    tenantId: string,
    assistantId: string,
    id: string,
    actorId: string,
    others?: boolean,
  ): Promise<ConversationApiResource | undefined>;
  list(
    tenantId: string,
    actorId: string,
    others?: boolean,
  ): Promise<readonly ConversationApiResource[]>;
  delete(
    tenantId: string,
    assistantId: string,
    id: string,
    actorId: string,
    others?: boolean,
  ): Promise<boolean>;
}
export interface ChatApiRequest {
  readonly assistantId: string;
  readonly conversationId?: string;
  readonly message: string;
  readonly locale?: string;
  readonly metadata?: AIMetadata;
  readonly groundingMode?:
    "private-strict" | "private-preferred" | "general-allowed";
  readonly toolConfirmationIds?: readonly string[];
}
export interface CitationApiResource {
  readonly id: string;
  readonly title: string;
  readonly documentId?: string;
  readonly page?: number;
  readonly section?: string;
  readonly score?: number;
}
export interface ChatApiResponse {
  readonly conversationId: string;
  readonly message: AIMessage;
  readonly citations: readonly CitationApiResource[];
  readonly toolResults: readonly ToolExecutionResult[];
}
export type ChatStreamEventType =
  | "request.accepted"
  | "assistant.resolved"
  | "retrieval.started"
  | "retrieval.completed"
  | "generation.started"
  | "tool.requested"
  | "tool.confirmation-required"
  | "tool.started"
  | "tool.completed"
  | "citation.available"
  | "message.completed"
  | "error"
  | "done";
export interface ChatStreamEvent {
  readonly type: ChatStreamEventType;
  readonly timestamp: string;
  readonly data?: unknown;
}
export interface AssistantApiResource {
  readonly descriptor: AssistantDescriptor;
}
export interface KnowledgeBaseApiResource {
  readonly id: string;
  readonly tenantId: string;
  readonly assistantId: string;
  readonly name: string;
  readonly status: "active" | "disabled";
}
export interface DocumentApiResource {
  readonly id: string;
  readonly tenantId: string;
  readonly assistantId: string;
  readonly knowledgeBaseId: string;
  readonly title: string;
  readonly mediaType: string;
  readonly status: string;
  readonly metadata?: AIMetadata;
}
export interface IngestionJobApiResource {
  readonly id: string;
  readonly tenantId: string;
  readonly assistantId: string;
  readonly fixtureId: string;
  readonly status:
    | "queued"
    | "processing"
    | "completed"
    | "partially-completed"
    | "failed"
    | "cancelled";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly error?: string;
}
export interface ToolApiResource {
  readonly descriptor: ToolDescriptor;
}
export interface ApiHealth {
  readonly status: "ok" | "degraded";
  readonly timestamp: string;
  readonly checks?: Readonly<Record<string, boolean>>;
}
export interface ApiMetrics {
  readonly requests: number;
  readonly errors: number;
  readonly durationsMilliseconds: readonly number[];
  readonly byStatus: Readonly<Record<string, number>>;
}
export interface RateLimitPolicy {
  readonly limit: number;
  readonly windowMilliseconds: number;
}
export interface RateLimitResult {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly resetAt: string;
  readonly retryAfterSeconds?: number;
}
export interface RateLimiter {
  consume(
    key: string,
    policy: RateLimitPolicy,
    now: number,
  ): Promise<RateLimitResult>;
}
export interface RequestAuditEvent {
  readonly requestId: string;
  readonly correlationId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly method: string;
  readonly endpoint: string;
  readonly status: number;
  readonly durationMilliseconds: number;
  readonly errorCode?: ApiErrorCode;
}
export interface RequestAuditSink {
  write(event: RequestAuditEvent): Promise<void>;
}
export interface Logger {
  log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    metadata: Readonly<Record<string, string | number | boolean | null>>,
  ): void;
}
export interface MetricsSink {
  record(status: number, durationMilliseconds: number): void;
  snapshot(): ApiMetrics;
}
