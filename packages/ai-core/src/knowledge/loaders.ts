import type { AIMetadata } from "../types.js";
import type { KnowledgeConnectorContent } from "./connectors.js";
import type { KnowledgeDocumentIdentity, KnowledgeOperationContext, KnowledgeSourceKind } from "./types.js";

export interface LoadedDocument extends KnowledgeDocumentIdentity {
  readonly title: string;
  readonly source: string;
  readonly sourceKind: KnowledgeSourceKind;
  readonly mimeType: string;
  readonly language?: string;
  readonly content: string | Uint8Array;
  readonly size: number;
  readonly checksum?: string;
  readonly metadata?: AIMetadata;
}

export interface DocumentLoadRequest {
  readonly identity: KnowledgeDocumentIdentity;
  readonly title: string;
  readonly source: string;
  readonly sourceKind: KnowledgeSourceKind;
  readonly language?: string;
  readonly connectorContent: KnowledgeConnectorContent;
  readonly context: KnowledgeOperationContext;
  readonly metadata?: AIMetadata;
}

export interface DocumentLoader {
  readonly id: string;
  readonly sourceKinds: readonly KnowledgeSourceKind[];
  readonly mimeTypes: readonly string[];
  supports(request: DocumentLoadRequest): boolean;
  load(request: DocumentLoadRequest): Promise<LoadedDocument>;
}

export type FunctionalDocumentLoaderHandler = (request: DocumentLoadRequest) => Promise<LoadedDocument>;

export function createDocumentLoader(input: {
  readonly id: string;
  readonly sourceKinds: readonly KnowledgeSourceKind[];
  readonly mimeTypes: readonly string[];
  readonly load: FunctionalDocumentLoaderHandler;
  readonly supports?: (request: DocumentLoadRequest) => boolean;
}): DocumentLoader {
  return Object.freeze({
    id: input.id.trim(),
    sourceKinds: Object.freeze([...input.sourceKinds]),
    mimeTypes: Object.freeze([...input.mimeTypes]),
    supports: input.supports ?? ((request: DocumentLoadRequest) => input.sourceKinds.includes(request.sourceKind) || input.mimeTypes.includes(request.connectorContent.mimeType)),
    load: input.load,
  });
}
