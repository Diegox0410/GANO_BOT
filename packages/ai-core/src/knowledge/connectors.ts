import type { KnowledgeSource, KnowledgeSourceItem, KnowledgeSourceListRequest, KnowledgeSourceListResult } from "./sources.js";
import type { KnowledgeOperationContext, KnowledgeSourceKind } from "./types.js";

export interface KnowledgeConnectorReadRequest {
  readonly source: KnowledgeSource;
  readonly item: KnowledgeSourceItem;
  readonly context: KnowledgeOperationContext;
}

export interface KnowledgeConnectorContent {
  readonly data: string | Uint8Array;
  readonly mimeType: string;
  readonly size: number;
  readonly etag?: string;
}

export interface KnowledgeConnector {
  readonly id: string;
  readonly kinds: readonly KnowledgeSourceKind[];
  list(request: KnowledgeSourceListRequest): Promise<KnowledgeSourceListResult>;
  read(request: KnowledgeConnectorReadRequest): Promise<KnowledgeConnectorContent>;
}

export type FunctionalKnowledgeConnectorList = (request: KnowledgeSourceListRequest) => Promise<KnowledgeSourceListResult>;
export type FunctionalKnowledgeConnectorRead = (request: KnowledgeConnectorReadRequest) => Promise<KnowledgeConnectorContent>;

export function createKnowledgeConnector(input: {
  readonly id: string;
  readonly kinds: readonly KnowledgeSourceKind[];
  readonly list: FunctionalKnowledgeConnectorList;
  readonly read: FunctionalKnowledgeConnectorRead;
}): KnowledgeConnector {
  return Object.freeze({ id: input.id.trim(), kinds: Object.freeze([...input.kinds]), list: input.list, read: input.read });
}
