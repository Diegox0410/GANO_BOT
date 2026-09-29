import { BackendApiError } from "../errors.js";
import type { StudioAssistantConfiguration, StudioMutationContext, StudioPublishedVersion, StudioRepository } from "./contracts.js";

const clone = <T>(value: T): T => structuredClone(value);
const ID = /^[a-z0-9][a-z0-9-]{2,63}$/;

export function validateStudioConfiguration(value: StudioAssistantConfiguration): readonly string[] {
  const errors: string[] = [];
  if (!ID.test(value.id)) errors.push("assistantId inválido");
  if (!value.identity.name.trim()) errors.push("identity.name es obligatorio");
  if (!value.identity.locale.trim()) errors.push("identity.locale es obligatorio");
  if (value.behavior.systemPrompt.length > 12000) errors.push("systemPrompt supera 12000 caracteres");
  if (value.rag.minimumScore < 0 || value.rag.minimumScore > 1) errors.push("rag.minimumScore debe estar entre 0 y 1");
  if (value.rag.enabled && value.rag.groundingMode === "private-strict" && value.rag.knowledgeBaseIds.length === 0)
    errors.push("RAG privado estricto requiere knowledgeBaseIds");
  if (value.tools.enabled && value.tools.allowlist.length === 0) errors.push("Tools habilitados requieren allowlist");
  if (value.tools.maximumCalls < 1 || value.tools.maximumRounds < 1) errors.push("Límites de tools inválidos");
  return Object.freeze(errors);
}

export class StudioControlPlane {
  public constructor(private readonly repository: StudioRepository) {}

  public list(tenantId: string): Promise<readonly StudioAssistantConfiguration[]> {
    return this.repository.list(tenantId);
  }

  public get(tenantId: string, assistantId: string): Promise<StudioAssistantConfiguration | undefined> {
    return this.repository.get(tenantId, assistantId);
  }

  public async saveDraft(input: StudioAssistantConfiguration, context: StudioMutationContext): Promise<StudioAssistantConfiguration> {
    if (input.tenantId !== context.principal.tenantId)
      throw new BackendApiError("FORBIDDEN", "No se permite escribir en otro tenant.", 403);
    if (!context.principal.permissions.includes("assistants:write") && !context.principal.permissions.includes("assistants:update"))
      throw new BackendApiError("FORBIDDEN", "No tienes permiso para editar asistentes.", 403);

    const current = await this.repository.get(input.tenantId, input.id);
    const next = Object.freeze({
      ...clone(input),
      version: (current?.version ?? 0) + 1,
      status: "draft" as const,
      createdAt: current?.createdAt ?? context.now,
      createdBy: current?.createdBy ?? context.principal.actorId,
      updatedAt: context.now,
      updatedBy: context.principal.actorId,
    });
    await this.repository.save(next);
    return next;
  }

  public async publish(tenantId: string, assistantId: string, context: StudioMutationContext): Promise<StudioPublishedVersion> {
    if (tenantId !== context.principal.tenantId)
      throw new BackendApiError("FORBIDDEN", "No se permite publicar en otro tenant.", 403);
    if (!context.principal.permissions.includes("assistants:publish"))
      throw new BackendApiError("FORBIDDEN", "No tienes permiso para publicar.", 403);

    const current = await this.repository.get(tenantId, assistantId);
    if (!current) throw new BackendApiError("ASSISTANT_NOT_FOUND", "No existe el asistente.", 404);
    const errors = validateStudioConfiguration(current);
    if (errors.length) throw new BackendApiError("BAD_REQUEST", `Configuración inválida: ${errors.join("; ")}`, 400);

    const publishedConfig = Object.freeze({
      ...clone(current),
      status: "published" as const,
      updatedAt: context.now,
      updatedBy: context.principal.actorId,
    });
    await this.repository.save(publishedConfig);
    const published = Object.freeze({
      tenantId,
      assistantId,
      version: publishedConfig.version,
      configuration: publishedConfig,
      publishedAt: context.now,
      publishedBy: context.principal.actorId,
    });
    await this.repository.savePublished(published);
    return published;
  }

  public async archive(tenantId: string, assistantId: string, context: StudioMutationContext): Promise<StudioAssistantConfiguration> {
    const current = await this.repository.get(tenantId, assistantId);
    if (!current) throw new BackendApiError("ASSISTANT_NOT_FOUND", "No existe el asistente.", 404);
    return this.saveDraft(Object.freeze({ ...current, status: "archived" }), context).then(async saved => {
      const archived = Object.freeze({ ...saved, status: "archived" as const });
      await this.repository.save(archived);
      return archived;
    });
  }

  public async resolvePublished(tenantId: string, assistantId: string): Promise<StudioAssistantConfiguration> {
    const value = await this.repository.getPublished(tenantId, assistantId);
    if (!value) throw new BackendApiError("ASSISTANT_NOT_FOUND", "No existe una versión publicada.", 404);
    return value.configuration;
  }
}
