import type { AIMetadata } from "../types.js";
import type { LoadedDocument } from "./loaders.js";
import type { KnowledgeDocumentIdentity, KnowledgeDocumentSection, KnowledgeOperationContext } from "./types.js";

export interface ParsedDocument extends KnowledgeDocumentIdentity {
  readonly title: string;
  readonly source: string;
  readonly mimeType: string;
  readonly language: string;
  readonly text: string;
  readonly sections: readonly KnowledgeDocumentSection[];
  readonly metadata?: AIMetadata;
}

export interface DocumentParseRequest {
  readonly document: LoadedDocument;
  readonly context: KnowledgeOperationContext;
}

export interface DocumentParser {
  readonly id: string;
  readonly mimeTypes: readonly string[];
  supports(document: LoadedDocument): boolean;
  parse(request: DocumentParseRequest): Promise<ParsedDocument>;
}

export type FunctionalDocumentParserHandler = (request: DocumentParseRequest) => Promise<ParsedDocument>;

export function createDocumentParser(input: {
  readonly id: string;
  readonly mimeTypes: readonly string[];
  readonly parse: FunctionalDocumentParserHandler;
  readonly supports?: (document: LoadedDocument) => boolean;
}): DocumentParser {
  return Object.freeze({
    id: input.id.trim(), mimeTypes: Object.freeze([...input.mimeTypes]),
    supports: input.supports ?? ((document: LoadedDocument) => input.mimeTypes.includes(document.mimeType)),
    parse: input.parse,
  });
}
