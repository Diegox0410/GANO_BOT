import { BackendApiError } from "../errors.js";
import { authorize } from "../security.js";
import type { ApiPrincipal } from "../contracts.js";
import type { StudioAssistantConfiguration } from "./contracts.js";
import type { StudioControlPlane } from "./service.js";

export interface StudioRouteContext {
  readonly principal: ApiPrincipal;
  readonly now: string;
  readonly readJson: () => Promise<unknown>;
  readonly success: (data: unknown, status?: number) => Response;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BackendApiError("BAD_REQUEST", "Configuración Studio inválida.", 400);
  }
  return value as Readonly<Record<string, unknown>>;
}

function configuration(value: unknown, principal: ApiPrincipal): StudioAssistantConfiguration {
  const input = record(value);
  if (input.tenantId !== undefined && input.tenantId !== principal.tenantId) {
    throw new BackendApiError("FORBIDDEN", "El tenant del cuerpo no está autorizado.", 403);
  }
  if (
    typeof input.id !== "string" ||
    typeof input.identity !== "object" || input.identity === null ||
    typeof input.behavior !== "object" || input.behavior === null ||
    typeof input.rag !== "object" || input.rag === null ||
    typeof input.memory !== "object" || input.memory === null ||
    typeof input.tools !== "object" || input.tools === null ||
    !Array.isArray(input.channels)
  ) {
    throw new BackendApiError("BAD_REQUEST", "Configuración Studio incompleta.", 400);
  }
  return Object.freeze({
    ...input,
    tenantId: principal.tenantId,
  }) as unknown as StudioAssistantConfiguration;
}

export async function routeStudio(
  request: Request,
  studio: StudioControlPlane,
  context: StudioRouteContext,
): Promise<Response | undefined> {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  if (segments[0] !== "v1" || segments[1] !== "studio" || segments[2] !== "assistants") {
    return undefined;
  }
  const assistantId = segments[3];
  const action = segments[4];
  const tenantId = context.principal.tenantId;
  const mutationContext = Object.freeze({ principal: context.principal, now: context.now });

  if (request.method === "GET" && assistantId === undefined) {
    authorize(context.principal, "assistants:read", tenantId);
    return context.success(await studio.list(tenantId));
  }
  if (request.method === "GET" && assistantId !== undefined && action === undefined) {
    authorize(context.principal, "assistants:read", tenantId, assistantId);
    const value = await studio.get(tenantId, assistantId);
    if (value === undefined) throw new BackendApiError("ASSISTANT_NOT_FOUND", "No existe el asistente.", 404);
    return context.success(value);
  }
  if ((request.method === "POST" || request.method === "PUT" || request.method === "PATCH") && action === undefined) {
    const value = configuration(await context.readJson(), context.principal);
    if (assistantId !== undefined && assistantId !== value.id) {
      throw new BackendApiError("BAD_REQUEST", "El assistantId de ruta y cuerpo no coincide.", 400);
    }
    const saved = await studio.saveDraft(value, mutationContext);
    return context.success(saved, request.method === "POST" ? 201 : 200);
  }
  if (request.method === "POST" && assistantId !== undefined && action === "publish") {
    return context.success(await studio.publish(tenantId, assistantId, mutationContext));
  }
  if (request.method === "POST" && assistantId !== undefined && action === "archive") {
    return context.success(await studio.archive(tenantId, assistantId, mutationContext));
  }
  throw new BackendApiError("NOT_FOUND", "Operación Studio no disponible.", 404);
}
