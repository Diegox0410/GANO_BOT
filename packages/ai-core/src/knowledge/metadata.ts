import type { AIMetadata } from "../types.js";
import type { KnowledgePermissions } from "./types.js";

export const EMPTY_KNOWLEDGE_METADATA: AIMetadata = Object.freeze({});
export const PUBLIC_KNOWLEDGE_PERMISSIONS: KnowledgePermissions = Object.freeze({ public: true });

export function freezeKnowledgeMetadata(metadata: AIMetadata | undefined): AIMetadata {
  return Object.freeze({ ...(metadata ?? {}) });
}

export function freezeKnowledgePermissions(permissions: KnowledgePermissions): KnowledgePermissions {
  return Object.freeze({
    public: permissions.public,
    ...(permissions.allowedActorIds !== undefined ? { allowedActorIds: Object.freeze([...permissions.allowedActorIds]) } : {}),
    ...(permissions.allowedRoleIds !== undefined ? { allowedRoleIds: Object.freeze([...permissions.allowedRoleIds]) } : {}),
    ...(permissions.deniedActorIds !== undefined ? { deniedActorIds: Object.freeze([...permissions.deniedActorIds]) } : {}),
  });
}

export function normalizeKnowledgeTags(tags: readonly string[] | undefined): readonly string[] {
  return Object.freeze(
    [...new Set((tags ?? []).map((tag) => tag.trim().toLowerCase()).filter((tag) => tag.length > 0))],
  );
}
