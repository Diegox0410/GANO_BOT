import type { AIIdentifier, AIMetadata } from "../types.js";
import { freezeKnowledgeMetadata } from "./metadata.js";
import type { KnowledgeDocumentIdentity } from "./types.js";

export interface ChunkMetadata extends KnowledgeDocumentIdentity {
  readonly chunkIndex: number;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly page?: number;
  readonly section?: string;
  readonly heading?: string;
  readonly language: string;
  readonly checksum: string;
  readonly metadata: AIMetadata;
}

export interface KnowledgeChunk {
  readonly id: AIIdentifier;
  readonly content: string;
  readonly tokenCount?: number;
  readonly metadata: ChunkMetadata;
}

export function createDeterministicKnowledgeId(value: string, prefix = "knowledge"): AIIdentifier {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function createKnowledgeChunk(input: {
  readonly identity: KnowledgeDocumentIdentity;
  readonly content: string;
  readonly index: number;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly language: string;
  readonly page?: number;
  readonly section?: string;
  readonly heading?: string;
  readonly tokenCount?: number;
  readonly metadata?: AIMetadata;
}): KnowledgeChunk {
  const content = input.content.trim();
  const checksum = createDeterministicKnowledgeId(content, "checksum");
  const id = createDeterministicKnowledgeId(
    [input.identity.tenantId, input.identity.assistantId, input.identity.knowledgeBaseId, input.identity.documentId, input.identity.version, input.index, checksum].join(":"),
    "chunk",
  );
  const metadata: ChunkMetadata = Object.freeze({
    ...input.identity,
    chunkIndex: input.index,
    startOffset: input.startOffset,
    endOffset: input.endOffset,
    ...(input.page !== undefined ? { page: input.page } : {}),
    ...(input.section !== undefined ? { section: input.section } : {}),
    ...(input.heading !== undefined ? { heading: input.heading } : {}),
    language: input.language,
    checksum,
    metadata: freezeKnowledgeMetadata(input.metadata),
  });
  return Object.freeze({ id, content, ...(input.tokenCount !== undefined ? { tokenCount: input.tokenCount } : {}), metadata });
}
