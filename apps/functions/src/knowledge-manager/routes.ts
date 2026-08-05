import type {
  KnowledgeManagerPermission,
  KnowledgeManagerPrincipal,
} from "@gano-bot/ai-core/knowledge-manager";
import {
  KnowledgeManagerError,
  KnowledgeManagerService,
} from "@gano-bot/ai-core/knowledge-manager";
import { BackendApiError } from "../errors.js";
import type { ApiPermission, ApiPrincipal } from "../contracts.js";
import { KnowledgeManagerJobService } from "./jobs.js";
const ALL: readonly KnowledgeManagerPermission[] = Object.freeze([
  "knowledge:read",
  "knowledge:create",
  "knowledge:update",
  "knowledge:delete",
  "knowledge:archive",
  "knowledge:restore",
  "knowledge:associate",
  "documents:read",
  "documents:create",
  "documents:update",
  "documents:delete",
  "documents:reprocess",
  "ingestion:read",
  "ingestion:execute",
  "ingestion:cancel",
  "versions:read",
  "versions:restore",
]);
function apiPermission(permission: KnowledgeManagerPermission): ApiPermission {
  if (
    permission === "documents:read" ||
    permission === "versions:read" ||
    permission === "ingestion:read"
  )
    return "knowledge:read";
  if (permission === "documents:create") return "knowledge:create";
  if (permission === "documents:delete") return "knowledge:delete";
  if (permission === "ingestion:execute") return "ingestion:execute";
  if (
    permission === "knowledge:create" ||
    permission === "knowledge:read" ||
    permission === "knowledge:update" ||
    permission === "knowledge:delete"
  )
    return permission;
  return "knowledge:update";
}
function principal(value: ApiPrincipal): KnowledgeManagerPrincipal {
  const admin = value.permissions.includes("admin:*");
  const allowed = ALL.filter(
    (permission) =>
      admin || value.permissions.includes(apiPermission(permission)),
  );
  return Object.freeze({
    actorId: value.actorId,
    tenantId: value.tenantId,
    permissions: Object.freeze(allowed),
  });
}
function body(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new BackendApiError(
      "BAD_REQUEST",
      "El cuerpo debe ser un objeto.",
      400,
    );
  return value as Readonly<Record<string, unknown>>;
}
function normalize(error: unknown): never {
  if (error instanceof KnowledgeManagerError) {
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : error.code === "FORBIDDEN" || error.code === "TENANT_MISMATCH"
          ? 403
          : error.code === "CONFLICT"
            ? 409
            : 400;
    throw new BackendApiError(
      status === 404
        ? "KNOWLEDGE_NOT_FOUND"
        : status === 403
          ? "FORBIDDEN"
          : status === 409
            ? "CONFLICT"
            : "BAD_REQUEST",
      error.message,
      status,
      undefined,
      error,
    );
  }
  throw error;
}
export interface KnowledgeManagerRouteContext {
  readonly principal: ApiPrincipal;
  readonly readJson: () => Promise<unknown>;
  readonly success: (data: unknown, status?: number) => Response;
}
const JOBS = new WeakMap<KnowledgeManagerService, KnowledgeManagerJobService>();
function jobs(service: KnowledgeManagerService): KnowledgeManagerJobService {
  const existing = JOBS.get(service);
  if (existing !== undefined) return existing;
  const created = new KnowledgeManagerJobService(service);
  JOBS.set(service, created);
  return created;
}
export async function routeKnowledgeManager(
  request: Request,
  service: KnowledgeManagerService,
  context: KnowledgeManagerRouteContext,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/v1/knowledge-manager")) return undefined;
  const segments = url.pathname.split("/").filter(Boolean);
  const actor = principal(context.principal);
  const jobService = jobs(service);
  try {
    if (
      segments.length === 3 &&
      segments[2] === "bases" &&
      request.method === "GET"
    )
      return context.success(
        await service.listBases(actor, {
          search: url.searchParams.get("search") ?? undefined,
          page: Number(url.searchParams.get("page") ?? 1),
          pageSize: Number(url.searchParams.get("pageSize") ?? 20),
        }),
      );
    if (
      segments.length === 3 &&
      segments[2] === "bases" &&
      request.method === "POST"
    ) {
      const data = body(await context.readJson());
      if (typeof data.name !== "string")
        throw new BackendApiError("BAD_REQUEST", "name es obligatorio.", 400);
      return context.success(
        await service.createBase(actor, {
          name: data.name,
          ...(typeof data.description === "string"
            ? { description: data.description }
            : {}),
        }),
        201,
      );
    }
    if (
      segments.length === 4 &&
      segments[2] === "bases" &&
      request.method === "GET"
    )
      return context.success(await service.getBase(actor, segments[3] ?? ""));
    if (
      segments.length === 4 &&
      segments[2] === "bases" &&
      request.method === "PATCH"
    ) {
      const data = body(await context.readJson());
      return context.success(
        await service.updateBase(actor, segments[3] ?? "", {
          ...(typeof data.name === "string" ? { name: data.name } : {}),
          ...(typeof data.description === "string"
            ? { description: data.description }
            : {}),
        }),
      );
    }
    if (
      segments.length === 5 &&
      segments[2] === "bases" &&
      segments[4] === "duplicate" &&
      request.method === "POST"
    )
      return context.success(
        await service.duplicateBase(actor, segments[3] ?? ""),
        201,
      );
    if (
      segments.length === 5 &&
      segments[2] === "bases" &&
      segments[4] === "archive" &&
      request.method === "POST"
    )
      return context.success(
        await service.archiveBase(actor, segments[3] ?? ""),
      );
    if (
      segments.length === 5 &&
      segments[2] === "bases" &&
      segments[4] === "restore" &&
      request.method === "POST"
    )
      return context.success(
        await service.restoreBase(actor, segments[3] ?? ""),
      );
    if (
      segments.length === 4 &&
      segments[2] === "bases" &&
      request.method === "DELETE"
    )
      return context.success({
        deleted: await service.deleteBase(actor, segments[3] ?? ""),
      });
    if (
      segments.length === 5 &&
      segments[2] === "bases" &&
      segments[4] === "documents" &&
      request.method === "GET"
    )
      return context.success(
        await service.listDocuments(actor, segments[3] ?? ""),
      );
    if (
      segments.length === 5 &&
      segments[2] === "bases" &&
      segments[4] === "folders" &&
      request.method === "GET"
    )
      return context.success(
        await service.listFolders(actor, segments[3] ?? ""),
      );
    if (
      segments.length === 5 &&
      segments[2] === "bases" &&
      segments[4] === "folders" &&
      request.method === "POST"
    ) {
      const data = body(await context.readJson());
      if (typeof data.name !== "string")
        throw new BackendApiError("BAD_REQUEST", "name es obligatorio.", 400);
      return context.success(
        await service.createFolder(
          actor,
          segments[3] ?? "",
          data.name,
          typeof data.parentId === "string" ? data.parentId : undefined,
        ),
        201,
      );
    }
    if (
      segments.length === 4 &&
      segments[2] === "folders" &&
      request.method === "PATCH"
    ) {
      const data = body(await context.readJson());
      if (typeof data.baseId !== "string" || typeof data.name !== "string")
        throw new BackendApiError(
          "BAD_REQUEST",
          "baseId y name son obligatorios.",
          400,
        );
      return context.success(
        await service.renameFolder(
          actor,
          data.baseId,
          segments[3] ?? "",
          data.name,
        ),
      );
    }
    if (
      segments.length === 5 &&
      segments[2] === "bases" &&
      segments[4] === "collections" &&
      request.method === "GET"
    )
      return context.success(
        await service.listCollections(actor, segments[3] ?? ""),
      );
    if (
      segments.length === 5 &&
      segments[2] === "bases" &&
      segments[4] === "collections" &&
      request.method === "POST"
    ) {
      const data = body(await context.readJson());
      if (typeof data.name !== "string")
        throw new BackendApiError("BAD_REQUEST", "name es obligatorio.", 400);
      return context.success(
        await service.createCollection(actor, segments[3] ?? "", data.name),
        201,
      );
    }
    if (
      segments.length === 5 &&
      segments[2] === "bases" &&
      segments[4] === "documents" &&
      request.method === "POST"
    ) {
      const contentType = request.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().startsWith("multipart/form-data"))
        throw new BackendApiError(
          "UNSUPPORTED_MEDIA_TYPE",
          "Se requiere multipart/form-data.",
          415,
        );
      const form = await request.formData();
      const assistantId = form.get("assistantId");
      if (typeof assistantId !== "string" || assistantId.trim() === "")
        throw new BackendApiError(
          "BAD_REQUEST",
          "assistantId es obligatorio.",
          400,
        );
      const files = form
        .getAll("files")
        .filter((value): value is File => value instanceof File);
      return context.success(
        await jobService.create(
          actor,
          segments[3] ?? "",
          assistantId,
          Object.freeze(files),
        ),
        202,
      );
    }
    if (
      segments.length === 4 &&
      segments[2] === "documents" &&
      request.method === "GET"
    )
      return context.success(
        await service.getDocument(actor, segments[3] ?? ""),
      );
    if (
      segments.length === 4 &&
      segments[2] === "documents" &&
      request.method === "PATCH"
    ) {
      const data = body(await context.readJson());
      return context.success(
        await service.updateDocument(actor, segments[3] ?? "", {
          ...(typeof data.title === "string" ? { title: data.title } : {}),
          ...(Array.isArray(data.tags) &&
          data.tags.every((tag) => typeof tag === "string")
            ? { tags: data.tags as readonly string[] }
            : {}),
        }),
      );
    }
    if (
      segments.length === 4 &&
      segments[2] === "documents" &&
      request.method === "DELETE"
    )
      return context.success({
        deleted: await service.deleteDocument(actor, segments[3] ?? ""),
      });
    if (
      segments.length === 5 &&
      segments[2] === "documents" &&
      segments[4] === "preview" &&
      request.method === "GET"
    )
      return context.success(
        await service.previewDocument(actor, segments[3] ?? ""),
      );
    if (
      segments.length === 5 &&
      segments[2] === "documents" &&
      segments[4] === "archive" &&
      request.method === "POST"
    )
      return context.success(
        await service.archiveDocument(actor, segments[3] ?? ""),
      );
    if (
      segments.length === 5 &&
      segments[2] === "documents" &&
      segments[4] === "restore" &&
      request.method === "POST"
    )
      return context.success(
        await service.restoreDocument(actor, segments[3] ?? ""),
      );
    if (
      segments.length === 5 &&
      segments[2] === "documents" &&
      segments[4] === "reprocess" &&
      request.method === "POST"
    )
      return context.success(
        await service.reprocessDocument(
          actor,
          segments[3] ?? "",
          request.signal,
        ),
      );
    if (
      segments.length === 5 &&
      segments[2] === "documents" &&
      segments[4] === "reindex" &&
      request.method === "POST"
    )
      return context.success(
        await service.reindexDocument(actor, segments[3] ?? "", request.signal),
      );
    if (
      segments.length === 5 &&
      segments[2] === "bases" &&
      segments[4] === "reindex" &&
      request.method === "POST"
    )
      return context.success(
        await service.reindexKnowledgeBase(
          actor,
          segments[3] ?? "",
          request.signal,
        ),
      );
    if (
      segments.length === 5 &&
      segments[2] === "bases" &&
      segments[4] === "versions" &&
      request.method === "GET"
    )
      return context.success(await service.versions(actor, segments[3] ?? ""));
    if (
      segments.length === 5 &&
      segments[2] === "documents" &&
      segments[4] === "versions" &&
      request.method === "GET"
    )
      return context.success(await service.versions(actor, segments[3] ?? ""));
    if (
      segments.length === 3 &&
      segments[2] === "jobs" &&
      request.method === "GET"
    )
      return context.success(jobService.list(actor));
    if (
      segments.length === 4 &&
      segments[2] === "jobs" &&
      request.method === "GET"
    )
      return context.success(jobService.get(actor, segments[3] ?? ""));
    if (
      segments.length === 5 &&
      segments[2] === "jobs" &&
      segments[4] === "cancel" &&
      request.method === "POST"
    )
      return context.success(jobService.cancel(actor, segments[3] ?? ""));
    if (
      segments.length === 5 &&
      segments[2] === "jobs" &&
      segments[4] === "retry" &&
      request.method === "POST"
    )
      return context.success(await jobService.retry(actor, segments[3] ?? ""));
    if (
      segments.length === 3 &&
      segments[2] === "statistics" &&
      request.method === "GET"
    )
      return context.success(await service.statistics(actor));
    if (
      segments.length === 3 &&
      segments[2] === "activity" &&
      request.method === "GET"
    )
      return context.success(await service.activity(actor));
    if (
      segments.length === 6 &&
      segments[2] === "bases" &&
      segments[4] === "assistants" &&
      request.method === "POST"
    )
      return context.success(
        await service.associateAssistant(
          actor,
          segments[3] ?? "",
          segments[5] ?? "",
        ),
      );
    if (
      segments.length === 6 &&
      segments[2] === "bases" &&
      segments[4] === "assistants" &&
      request.method === "DELETE"
    )
      return context.success(
        await service.disassociateAssistant(
          actor,
          segments[3] ?? "",
          segments[5] ?? "",
        ),
      );
    throw new BackendApiError(
      "NOT_FOUND",
      "Ruta de Knowledge Manager no encontrada.",
      404,
    );
  } catch (error) {
    normalize(error);
  }
}
