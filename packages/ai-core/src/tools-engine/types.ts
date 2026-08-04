import type { AIChatToolCall, AIChatToolDefinition } from "../chat/types.js";
import type {
  AIIdentifier,
  AIMetadata,
  AIUnknownRecord,
  AIToolParameterSchema,
} from "../types.js";
export type ToolId = AIIdentifier;
export type ToolCategory =
  | "knowledge"
  | "business"
  | "calculation"
  | "text"
  | "data"
  | "memory"
  | "runtime"
  | "storage"
  | "network"
  | "system"
  | "custom";
export type ToolRiskLevel = "safe" | "low" | "medium" | "high" | "critical";
export type ToolExecutionStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "timed-out"
  | "denied"
  | "invalid-arguments"
  | "confirmation-required";
export interface ToolArgumentSchema extends Omit<
  AIToolParameterSchema,
  "items" | "properties"
> {
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly items?: ToolArgumentSchema;
  readonly properties?: Readonly<Record<string, ToolArgumentSchema>>;
}
export interface ToolDescriptor {
  readonly id: ToolId;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly category: ToolCategory;
  readonly riskLevel: ToolRiskLevel;
  readonly inputSchema: ToolArgumentSchema;
  readonly outputSchema?: ToolArgumentSchema;
  readonly requiredPermissions: readonly string[];
  readonly confirmationPolicy:
    "never" | "always" | "risk-based" | "destructive-only" | "custom";
  readonly timeoutMs: number;
  readonly enabled: boolean;
  readonly tenantId?: AIIdentifier;
  readonly assistantId?: AIIdentifier;
  readonly tags: readonly string[];
  readonly metadata?: AIMetadata;
}
export interface ToolExecutionContext {
  readonly tenantId: AIIdentifier;
  readonly assistantId: AIIdentifier;
  readonly actorId: AIIdentifier;
  readonly conversationId: AIIdentifier;
  readonly requestId: AIIdentifier;
  readonly correlationId: AIIdentifier;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly allowedToolIds: readonly ToolId[];
  readonly allowedCategories: readonly ToolCategory[];
  readonly maximumRiskLevel: ToolRiskLevel;
  readonly confirmationIds?: readonly string[];
  readonly memoryContext?: unknown;
  readonly ragContext?: unknown;
  readonly signal?: AbortSignal;
  readonly metadata?: AIMetadata;
}
export interface ToolExecutionRequest {
  readonly call: AIChatToolCall;
  readonly context: ToolExecutionContext;
}
export interface ToolSafeError {
  readonly code: string;
  readonly message: string;
}
export interface ToolExecutionResult {
  readonly status: ToolExecutionStatus;
  readonly toolId: ToolId;
  readonly executionId: AIIdentifier;
  readonly requestId: AIIdentifier;
  readonly correlationId: AIIdentifier;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMilliseconds: number;
  readonly output?: unknown;
  readonly warnings: readonly string[];
  readonly metadata?: AIMetadata;
  readonly error?: ToolSafeError;
  readonly auditId?: AIIdentifier;
  readonly confirmationRequestId?: AIIdentifier;
  readonly confirmationReason?: string;
  readonly metrics: ToolExecutionMetrics;
}
export interface ToolExecutionMetrics {
  readonly resolveMilliseconds: number;
  readonly permissionMilliseconds: number;
  readonly validationMilliseconds: number;
  readonly confirmationMilliseconds: number;
  readonly executionMilliseconds: number;
  readonly normalizationMilliseconds: number;
  readonly auditMilliseconds: number;
  readonly totalMilliseconds: number;
  readonly attemptedCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly deniedCount: number;
  readonly cancelledCount: number;
  readonly timedOutCount: number;
  readonly confirmationRequiredCount: number;
}
export interface ToolHandler {
  execute(
    argumentsValue: AIUnknownRecord,
    context: ToolExecutionContext,
  ): Promise<unknown>;
}
export interface ToolDefinition {
  readonly descriptor: ToolDescriptor;
  readonly handler: ToolHandler;
}
export interface ToolPermissionDecision {
  readonly allowed: boolean;
  readonly reason: string;
}
export interface ToolPermissionPolicy {
  authorize(
    tool: ToolDescriptor,
    context: ToolExecutionContext,
  ): Promise<ToolPermissionDecision>;
}
export interface ToolConfirmationDecision {
  readonly required: boolean;
  readonly reason: string;
}
export interface ToolConfirmationPolicy {
  evaluate(
    tool: ToolDescriptor,
    context: ToolExecutionContext,
  ): Promise<ToolConfirmationDecision>;
}
export interface ToolAuditEvent {
  readonly auditId: AIIdentifier;
  readonly timestamp: string;
  readonly tenantId: AIIdentifier;
  readonly assistantId: AIIdentifier;
  readonly actorId: AIIdentifier;
  readonly conversationId: AIIdentifier;
  readonly requestId: AIIdentifier;
  readonly correlationId: AIIdentifier;
  readonly toolId: ToolId;
  readonly toolVersion: string;
  readonly category: ToolCategory;
  readonly riskLevel: ToolRiskLevel;
  readonly status: ToolExecutionStatus;
  readonly durationMilliseconds: number;
  readonly permissionDecision: string;
  readonly confirmationDecision: string;
  readonly errorCode?: string;
  readonly metadata?: AIMetadata;
}
export interface ToolAuditSink {
  write(event: ToolAuditEvent): Promise<void>;
  list(): Promise<readonly ToolAuditEvent[]>;
}
export interface ToolRegistry {
  register(tool: ToolDefinition, replace?: boolean): void;
  registerMany(tools: readonly ToolDefinition[], replace?: boolean): void;
  get(id: ToolId): ToolDefinition | undefined;
  require(id: ToolId): ToolDefinition;
  list(filter?: {
    readonly tenantId?: string;
    readonly assistantId?: string;
    readonly category?: ToolCategory;
    readonly permission?: string;
  }): readonly ToolDefinition[];
  enable(id: ToolId): void;
  disable(id: ToolId): void;
  unregister(id: ToolId): boolean;
}
export interface ToolExecutor {
  execute(request: ToolExecutionRequest): Promise<ToolExecutionResult>;
  executeMany(
    requests: readonly ToolExecutionRequest[],
    limits?: ToolExecutionLimits,
  ): Promise<readonly ToolExecutionResult[]>;
}
export interface ToolExecutionLimits {
  readonly maximumCallsPerTurn?: number;
  readonly maximumSequentialCalls?: number;
  readonly maximumTotalMilliseconds?: number;
}
export type ToolPipelinePhase =
  | "beforeResolve"
  | "afterResolve"
  | "beforePermissionCheck"
  | "afterPermissionCheck"
  | "beforeValidation"
  | "afterValidation"
  | "beforeConfirmation"
  | "beforeExecution"
  | "afterExecution"
  | "onError"
  | "onAudit";
export interface ToolPipelineEvent {
  readonly phase: ToolPipelinePhase;
  readonly request: ToolExecutionRequest;
  readonly tool?: ToolDescriptor;
  readonly result?: ToolExecutionResult;
}
export interface ToolPipelineHook {
  readonly critical?: boolean;
  handle(event: ToolPipelineEvent): void | Promise<void>;
}
export interface ToolDependencies {
  readonly registry: ToolRegistry;
  readonly permissionPolicy?: ToolPermissionPolicy;
  readonly confirmationPolicy?: ToolConfirmationPolicy;
  readonly auditSink?: ToolAuditSink;
  readonly now?: () => string;
  readonly generateId?: (prefix: string) => string;
  readonly hooks?: readonly ToolPipelineHook[];
}
export interface ToolServices {
  readonly registry: ToolRegistry;
  readonly executor: ToolExecutor;
  readonly audit?: ToolAuditSink;
}
export interface ToolChatAdapter {
  definitions(
    tools: readonly ToolDefinition[],
  ): readonly AIChatToolDefinition[];
  request(
    call: AIChatToolCall,
    context: ToolExecutionContext,
  ): ToolExecutionRequest;
  resultMessage(result: ToolExecutionResult): import("../types.js").AIMessage;
}
