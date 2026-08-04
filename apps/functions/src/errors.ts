import type { ApiErrorCode, ApiErrorDetail } from "./contracts.js";
export class BackendApiError extends Error {
  public constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly status: number,
    public readonly details: readonly ApiErrorDetail[] = Object.freeze([]),
    public override readonly cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "BackendApiError";
  }
}
export function normalizeBackendError(error: unknown): BackendApiError {
  if (error instanceof BackendApiError) return error;
  if (error instanceof DOMException && error.name === "AbortError")
    return new BackendApiError(
      "REQUEST_CANCELLED",
      "La solicitud fue cancelada.",
      499,
      [],
      error,
    );
  return new BackendApiError(
    "INTERNAL_ERROR",
    "No fue posible completar la solicitud.",
    500,
    [],
    error,
  );
}
