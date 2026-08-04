import type { AIIdentifier, AIISODateString, AIMetadata } from "../types.js";

export type KnowledgeSourceKind =
  | "pdf" | "docx" | "txt" | "markdown" | "html" | "csv" | "json" | "xlsx"
  | "firestore" | "google-drive" | "notion" | "sharepoint" | "website" | "api" | "custom";

export type KnowledgeDocumentStatus =
  | "pending" | "loading" | "parsing" | "chunking" | "embedding" | "indexing"
  | "ready" | "partial" | "failed" | "archived";

export interface KnowledgePermissions {
  readonly public: boolean;
  readonly allowedActorIds?: readonly AIIdentifier[];
  readonly allowedRoleIds?: readonly AIIdentifier[];
  readonly deniedActorIds?: readonly AIIdentifier[];
}

export interface KnowledgeDocumentIdentity {
  readonly tenantId: AIIdentifier;
  readonly assistantId: AIIdentifier;
  readonly knowledgeBaseId: AIIdentifier;
  readonly documentId: AIIdentifier;
  readonly version: string;
}

export interface KnowledgeDocument extends KnowledgeDocumentIdentity {
  readonly checksum: string;
  readonly title: string;
  readonly source: string;
  readonly sourceKind: KnowledgeSourceKind;
  readonly mimeType: string;
  readonly language: string;
  readonly createdAt: AIISODateString;
  readonly updatedAt: AIISODateString;
  readonly metadata: AIMetadata;
  readonly permissions: KnowledgePermissions;
  readonly tags: readonly string[];
  readonly status: KnowledgeDocumentStatus;
}

export interface KnowledgeDocumentSection {
  readonly id: AIIdentifier;
  readonly title?: string;
  readonly text: string;
  readonly level?: number;
  readonly page?: number;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly metadata?: AIMetadata;
}

export interface KnowledgeProgress {
  readonly stage: KnowledgeDocumentStatus;
  readonly completed: number;
  readonly total?: number;
  readonly message?: string;
}

export type KnowledgeProgressListener = (progress: KnowledgeProgress) => void | Promise<void>;

export interface KnowledgeOperationContext {
  readonly requestId: AIIdentifier;
  readonly correlationId: AIIdentifier;
  readonly tenantId: AIIdentifier;
  readonly assistantId: AIIdentifier;
  readonly knowledgeBaseId: AIIdentifier;
  readonly actorId?: AIIdentifier;
  readonly signal?: AbortSignal;
  readonly onProgress?: KnowledgeProgressListener;
  readonly metadata?: AIMetadata;
}

export interface KnowledgeConfiguration {
  readonly defaultLanguage?: string;
  readonly deduplicate?: boolean;
  readonly allowReingestion?: boolean;
  readonly allowReindexing?: boolean;
  readonly continueOnPartialError?: boolean;
  readonly maximumDocumentBytes?: number;
  readonly maximumChunksPerDocument?: number;
  readonly metadata?: AIMetadata;
}
