import { createDeterministicKnowledgeId } from "./chunks.js";

import type { AIIdentifier, AIMetadata } from "../types.js";
import type { RetrievalResultItem } from "./retrieval.js";

export interface Citation {
  readonly id: AIIdentifier;
  readonly tenantId: AIIdentifier;
  readonly assistantId: AIIdentifier;
  readonly knowledgeBaseId: AIIdentifier;
  readonly documentId: AIIdentifier;
  readonly title: string;
  readonly chunkId: AIIdentifier;
  readonly version: string;
  readonly page?: number;
  readonly section?: string;
  readonly score: number;
  readonly source: string;
  readonly excerpt: string;
  readonly metadata?: AIMetadata;
}

export interface CitationBuildRequest {
  readonly results: readonly RetrievalResultItem[];
  readonly documents: Readonly<Record<string, { readonly title: string; readonly source: string; readonly metadata?: AIMetadata }>>;
  readonly maximumExcerptCharacters?: number;
}

export interface CitationBuilder { build(request: CitationBuildRequest): Promise<readonly Citation[]>; }

export class DefaultCitationBuilder implements CitationBuilder {
  public async build(request: CitationBuildRequest): Promise<readonly Citation[]> {
    const maximum = Math.max(1, Math.floor(request.maximumExcerptCharacters ?? 500));
    return Object.freeze(request.results.map((result) => {
      const chunk = result.chunk;
      const document = request.documents[chunk.metadata.documentId];
      const title = document?.title ?? chunk.metadata.documentId;
      const source = document?.source ?? "knowledge";
      return Object.freeze({
        id: createDeterministicKnowledgeId(`${chunk.id}:${result.score}`, "citation"),
        tenantId: chunk.metadata.tenantId,
        assistantId: chunk.metadata.assistantId,
        knowledgeBaseId: chunk.metadata.knowledgeBaseId,
        documentId: chunk.metadata.documentId,
        title,
        chunkId: chunk.id,
        version: chunk.metadata.version,
        ...(chunk.metadata.page !== undefined ? { page: chunk.metadata.page } : {}),
        ...(chunk.metadata.section !== undefined ? { section: chunk.metadata.section } : {}),
        score: result.score,
        source,
        excerpt: chunk.content.slice(0, maximum),
        ...(document?.metadata !== undefined ? { metadata: Object.freeze({ ...document.metadata }) } : {}),
      });
    }));
  }
}

export function createCitationBuilder(): CitationBuilder { return new DefaultCitationBuilder(); }
