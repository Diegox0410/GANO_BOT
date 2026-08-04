export type MemoryErrorCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_SCOPE"
  | "ISOLATION_VIOLATION"
  | "STORE_FAILED"
  | "SUMMARY_FAILED"
  | "EXTRACTION_FAILED"
  | "INVALID_RETENTION"
  | "CONSENT_REQUIRED"
  | "REQUEST_CANCELLED"
  | "TIMEOUT";
export class MemoryError extends Error {
  public override readonly name = "MemoryError";
  public constructor(
    public readonly code: MemoryErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
  }
}
export function validateMemoryScope(
  scope: import("./types.js").MemoryScope,
): void {
  if (
    [
      scope.tenantId,
      scope.assistantId,
      scope.userId,
      scope.conversationId,
      scope.requestId,
      scope.correlationId,
    ].some((value) => value.trim().length === 0)
  )
    throw new MemoryError(
      "INVALID_SCOPE",
      "El scope de memoria requiere todos los identificadores.",
    );
}
