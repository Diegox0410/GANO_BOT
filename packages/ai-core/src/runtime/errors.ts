/** Errores estables del Assistant Runtime. */
import type { AIIdentifier, AIMetadata } from "../types.js";

export type RuntimeErrorCode =
  | "INVALID_ASSISTANT_DEFINITION"
  | "INVALID_RUNTIME_CONFIGURATION"
  | "ASSISTANT_NOT_FOUND"
  | "ASSISTANT_DISABLED"
  | "RUNTIME_ALREADY_REGISTERED"
  | "RUNTIME_NOT_FOUND"
  | "SERVICE_NOT_FOUND"
  | "TENANT_MISMATCH"
  | "ASSISTANT_MISMATCH"
  | "EXECUTION_CANCELLED"
  | "EXECUTION_FAILED";

export interface RuntimeErrorDetails {
  readonly tenantId?: AIIdentifier;
  readonly assistantId?: AIIdentifier;
  readonly requestId?: AIIdentifier;
  readonly correlationId?: AIIdentifier;
  readonly serviceId?: string;
  readonly stage?: string;
  readonly metadata?: AIMetadata;
}

export class RuntimeError extends Error {
  public override readonly name = "RuntimeError";

  public constructor(
    public readonly code: RuntimeErrorCode,
    message: string,
    public readonly details?: RuntimeErrorDetails,
    public override readonly cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
  }
}

export class RuntimeConfigurationError extends RuntimeError {
  public constructor(message: string, details?: RuntimeErrorDetails, cause?: unknown) {
    super("INVALID_RUNTIME_CONFIGURATION", message, details, cause);
  }
}

export class RuntimeExecutionError extends RuntimeError {
  public constructor(message: string, details?: RuntimeErrorDetails, cause?: unknown) {
    super("EXECUTION_FAILED", message, details, cause);
  }
}
