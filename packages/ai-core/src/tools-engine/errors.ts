export type ToolErrorCode =
  | "INVALID_CONFIGURATION"
  | "TOOL_NOT_FOUND"
  | "TOOL_DISABLED"
  | "DUPLICATE_TOOL"
  | "PERMISSION_DENIED"
  | "INVALID_ARGUMENTS"
  | "CONFIRMATION_REQUIRED"
  | "INVALID_CONFIRMATION"
  | "TIMEOUT"
  | "CANCELLED"
  | "EXECUTION_FAILED"
  | "INVALID_RESULT"
  | "AUDIT_FAILED"
  | "CALL_LIMIT_EXCEEDED"
  | "LOOP_DETECTED"
  | "ISOLATION_VIOLATION";
export class ToolError extends Error {
  public override readonly name = "ToolError";
  public constructor(
    public readonly code: ToolErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
  }
}
export interface ToolValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
  readonly expected?: string;
  readonly received?: string;
}
