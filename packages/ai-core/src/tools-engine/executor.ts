import { ToolError } from "./errors.js";
import { validateToolArguments } from "./schema.js";
import {
  DefaultToolConfirmationPolicy,
  SecureToolPermissionPolicy,
} from "./policies.js";
import type {
  ToolAuditEvent,
  ToolDependencies,
  ToolExecutionLimits,
  ToolExecutionRequest,
  ToolExecutionResult,
  ToolExecutor,
  ToolExecutionStatus,
} from "./types.js";
function safeError(code: string, message: string) {
  return Object.freeze({ code, message });
}
export class DefaultToolExecutor implements ToolExecutor {
  private readonly now;
  private readonly generateId;
  private readonly permission;
  private readonly confirmation;
  public constructor(private readonly dependencies: ToolDependencies) {
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.generateId =
      dependencies.generateId ??
      ((prefix) =>
        `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    this.permission =
      dependencies.permissionPolicy ?? new SecureToolPermissionPolicy();
    this.confirmation =
      dependencies.confirmationPolicy ?? new DefaultToolConfirmationPolicy();
  }
  public async execute(
    request: ToolExecutionRequest,
  ): Promise<ToolExecutionResult> {
    const startedAt = this.now();
    const started = Date.now();
    const executionId = this.generateId("tool-execution");
    let status: ToolExecutionStatus = "failed";
    let output: unknown;
    let error;
    let permissionDecision = "not-checked";
    let confirmationDecision = "not-checked";
    let confirmationRequestId: string | undefined;
    let tool;
    try {
      await this.emit("beforeResolve", request);
      tool = this.dependencies.registry.require(request.call.name);
      await this.emit("afterResolve", request, tool.descriptor);
      if (!tool.descriptor.enabled)
        throw new ToolError(
          "TOOL_DISABLED",
          "La herramienta está deshabilitada.",
        );
      const descriptor = tool.descriptor;
      if (
        (descriptor.tenantId !== undefined &&
          descriptor.tenantId !== request.context.tenantId) ||
        (descriptor.assistantId !== undefined &&
          descriptor.assistantId !== request.context.assistantId)
      )
        throw new ToolError(
          "ISOLATION_VIOLATION",
          "La herramienta pertenece a otro scope.",
        );
      await this.emit("beforePermissionCheck", request, descriptor);
      const decision = await this.permission.authorize(
        descriptor,
        request.context,
      );
      await this.emit("afterPermissionCheck", request, descriptor);
      permissionDecision = decision.reason;
      if (!decision.allowed) {
        status = "denied";
        throw new ToolError(
          "PERMISSION_DENIED",
          "La ejecución no está autorizada.",
        );
      }
      await this.emit("beforeValidation", request, descriptor);
      const issues = validateToolArguments(
        request.call.arguments,
        descriptor.inputSchema,
      );
      if (issues.length > 0) {
        status = "invalid-arguments";
        throw new ToolError(
          "INVALID_ARGUMENTS",
          `Argumentos inválidos: ${issues.map((issue) => `${issue.path}:${issue.code}`).join(", ")}`,
        );
      }
      await this.emit("afterValidation", request, descriptor);
      await this.emit("beforeConfirmation", request, descriptor);
      const confirmation = await this.confirmation.evaluate(
        descriptor,
        request.context,
      );
      confirmationDecision = confirmation.reason;
      confirmationRequestId = `confirm-${request.call.id}`;
      if (
        confirmation.required &&
        !request.context.confirmationIds?.includes(confirmationRequestId)
      ) {
        status = "confirmation-required";
        return await this.finish({
          request,
          tool,
          status,
          executionId,
          startedAt,
          started,
          permissionDecision,
          confirmationDecision,
          confirmationRequestId,
          confirmationReason: `Confirmar acción ${descriptor.name} (${descriptor.riskLevel}).`,
        });
      }
      const controller = new AbortController();
      const onAbort = () => controller.abort(request.context.signal?.reason);
      request.context.signal?.addEventListener("abort", onAbort, {
        once: true,
      });
      const timer = setTimeout(
        () =>
          controller.abort(
            new ToolError("TIMEOUT", "La herramienta excedió el timeout."),
          ),
        descriptor.timeoutMs,
      );
      try {
        if (request.context.signal?.aborted === true)
          throw new ToolError("CANCELLED", "La ejecución fue cancelada.");
        const scopedContext = { ...request.context, signal: controller.signal };
        await this.emit("beforeExecution", request, descriptor);
        output = await Promise.race([
          tool.handler.execute(request.call.arguments, scopedContext),
          new Promise<never>((_resolve, reject) =>
            controller.signal.addEventListener(
              "abort",
              () => reject(controller.signal.reason),
              { once: true },
            ),
          ),
        ]);
        status = "completed";
        await this.emit("afterExecution", request, descriptor);
      } finally {
        clearTimeout(timer);
        request.context.signal?.removeEventListener("abort", onAbort);
      }
    } catch (caught) {
      await this.emit("onError", request, tool?.descriptor);
      const normalized =
        caught instanceof ToolError
          ? caught
          : new ToolError(
              "EXECUTION_FAILED",
              "La herramienta no pudo ejecutarse.",
              caught,
            );
      if (status === "failed")
        status =
          normalized.code === "TIMEOUT"
            ? "timed-out"
            : normalized.code === "CANCELLED"
              ? "cancelled"
              : normalized.code === "PERMISSION_DENIED"
                ? "denied"
                : normalized.code === "INVALID_ARGUMENTS"
                  ? "invalid-arguments"
                  : "failed";
      error = safeError(normalized.code, normalized.message);
    }
    return this.finish({
      request,
      tool,
      status,
      executionId,
      startedAt,
      started,
      permissionDecision,
      confirmationDecision,
      output,
      error,
      ...(confirmationRequestId !== undefined ? { confirmationRequestId } : {}),
    });
  }
  public async executeMany(
    requests: readonly ToolExecutionRequest[],
    limits: ToolExecutionLimits = {},
  ): Promise<readonly ToolExecutionResult[]> {
    const maximum = limits.maximumCallsPerTurn ?? 8;
    if (requests.length > maximum)
      throw new ToolError(
        "CALL_LIMIT_EXCEEDED",
        "Se excedió el máximo de herramientas por turno.",
      );
    const seen = new Set<string>();
    const results: ToolExecutionResult[] = [];
    const started = Date.now();
    for (const request of requests) {
      const signature = `${request.call.name}:${JSON.stringify(request.call.arguments)}`;
      if (seen.has(signature))
        throw new ToolError(
          "LOOP_DETECTED",
          "Se detectó una llamada repetida.",
        );
      seen.add(signature);
      if (Date.now() - started > (limits.maximumTotalMilliseconds ?? 60_000))
        throw new ToolError("TIMEOUT", "Se agotó el presupuesto total.");
      results.push(await this.execute(request));
    }
    return Object.freeze(results);
  }
  private async finish(input: {
    readonly request: ToolExecutionRequest;
    readonly tool?: ReturnType<ToolDependencies["registry"]["get"]>;
    readonly status: ToolExecutionStatus;
    readonly executionId: string;
    readonly startedAt: string;
    readonly started: number;
    readonly permissionDecision: string;
    readonly confirmationDecision: string;
    readonly output?: unknown;
    readonly error?: { readonly code: string; readonly message: string };
    readonly confirmationRequestId?: string;
    readonly confirmationReason?: string;
  }): Promise<ToolExecutionResult> {
    const completedAt = this.now();
    const auditId = this.generateId("tool-audit");
    const descriptor = input.tool?.descriptor;
    const event: ToolAuditEvent = Object.freeze({
      auditId,
      timestamp: completedAt,
      tenantId: input.request.context.tenantId,
      assistantId: input.request.context.assistantId,
      actorId: input.request.context.actorId,
      conversationId: input.request.context.conversationId,
      requestId: input.request.context.requestId,
      correlationId: input.request.context.correlationId,
      toolId: descriptor?.id ?? input.request.call.name,
      toolVersion: descriptor?.version ?? "unknown",
      category: descriptor?.category ?? "custom",
      riskLevel: descriptor?.riskLevel ?? "safe",
      status: input.status,
      durationMilliseconds: Date.now() - input.started,
      permissionDecision: input.permissionDecision,
      confirmationDecision: input.confirmationDecision,
      ...(input.error !== undefined ? { errorCode: input.error.code } : {}),
    });
    await this.dependencies.auditSink?.write(event);
    await this.emit("onAudit", input.request, descriptor);
    return Object.freeze({
      status: input.status,
      toolId: event.toolId,
      executionId: input.executionId,
      requestId: event.requestId,
      correlationId: event.correlationId,
      startedAt: input.startedAt,
      completedAt,
      durationMilliseconds: event.durationMilliseconds,
      ...(input.output !== undefined ? { output: input.output } : {}),
      warnings: Object.freeze([]),
      metrics: Object.freeze({
        resolveMilliseconds: 0,
        permissionMilliseconds: 0,
        validationMilliseconds: 0,
        confirmationMilliseconds: 0,
        executionMilliseconds: event.durationMilliseconds,
        normalizationMilliseconds: 0,
        auditMilliseconds: 0,
        totalMilliseconds: event.durationMilliseconds,
        attemptedCount: 1,
        completedCount: input.status === "completed" ? 1 : 0,
        failedCount:
          input.status === "failed" || input.status === "invalid-arguments"
            ? 1
            : 0,
        deniedCount: input.status === "denied" ? 1 : 0,
        cancelledCount: input.status === "cancelled" ? 1 : 0,
        timedOutCount: input.status === "timed-out" ? 1 : 0,
        confirmationRequiredCount:
          input.status === "confirmation-required" ? 1 : 0,
      }),
      ...(input.error !== undefined ? { error: input.error } : {}),
      auditId,
      ...(input.confirmationRequestId !== undefined
        ? { confirmationRequestId: input.confirmationRequestId }
        : {}),
      ...(input.confirmationReason !== undefined
        ? { confirmationReason: input.confirmationReason }
        : {}),
    });
  }
  private async emit(
    phase: import("./types.js").ToolPipelinePhase,
    request: ToolExecutionRequest,
    tool?: import("./types.js").ToolDescriptor,
  ): Promise<void> {
    for (const hook of this.dependencies.hooks ?? []) {
      try {
        await hook.handle(
          Object.freeze({
            phase,
            request,
            ...(tool !== undefined ? { tool } : {}),
          }),
        );
      } catch (error) {
        if (hook.critical === true)
          throw new ToolError(
            "EXECUTION_FAILED",
            `Falló el hook crítico ${phase}.`,
            error,
          );
      }
    }
  }
}
export function createToolExecutor(
  dependencies: ToolDependencies,
): ToolExecutor {
  return new DefaultToolExecutor(dependencies);
}
