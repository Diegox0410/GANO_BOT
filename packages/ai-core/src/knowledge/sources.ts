import type { AIIdentifier, AIMetadata } from "../types.js";
import type { KnowledgeOperationContext, KnowledgeSourceKind } from "./types.js";

export interface KnowledgeSource {
  readonly id: AIIdentifier;
  readonly kind: KnowledgeSourceKind;
  readonly name: string;
  readonly uri?: string;
  readonly mimeType?: string;
  readonly enabled: boolean;
  readonly metadata?: AIMetadata;
}

export interface KnowledgeSourceItem {
  readonly sourceId: AIIdentifier;
  readonly externalId: string;
  readonly name: string;
  readonly uri?: string;
  readonly mimeType?: string;
  readonly size?: number;
  readonly modifiedAt?: string;
  readonly metadata?: AIMetadata;
}

export interface KnowledgeSourceListRequest {
  readonly source: KnowledgeSource;
  readonly context: KnowledgeOperationContext;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface KnowledgeSourceListResult {
  readonly items: readonly KnowledgeSourceItem[];
  readonly nextCursor?: string;
}

export function createKnowledgeSource(source: KnowledgeSource): KnowledgeSource {
  const id = source.id.trim();
  const name = source.name.trim();
  if (id.length === 0 || name.length === 0) throw new Error("KnowledgeSource requiere id y name válidos.");
  return Object.freeze({ ...source, id, name, ...(source.metadata !== undefined ? { metadata: Object.freeze({ ...source.metadata }) } : {}) });
}
