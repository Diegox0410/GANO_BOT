import { KnowledgeError } from "./errors.js";

import type { ChunkingStrategy } from "./chunking.js";
import type { KnowledgeConnector } from "./connectors.js";
import type { DocumentLoader } from "./loaders.js";
import type { DocumentParser } from "./parser.js";
import type { KnowledgeSource } from "./sources.js";
import type { KnowledgeSourceKind } from "./types.js";
import type { VectorStore } from "./vectorStore.js";

function registerValue<T>(map: Map<string, T>, id: string, value: T, replace: boolean): void {
  const normalized = id.trim();
  if (normalized.length === 0) throw new KnowledgeError("INVALID_CONFIGURATION", "El identificador del registro no puede estar vacío.");
  if (map.has(normalized) && !replace) throw new KnowledgeError("INVALID_CONFIGURATION", `El elemento "${normalized}" ya está registrado.`);
  map.set(normalized, value);
}

function requireValue<T>(map: ReadonlyMap<string, T>, id: string, code: "SOURCE_NOT_FOUND" | "CONNECTOR_NOT_FOUND" | "LOADER_NOT_FOUND" | "PARSER_NOT_FOUND" | "CHUNKER_NOT_FOUND"): T {
  const value = map.get(id.trim());
  if (value === undefined) throw new KnowledgeError(code, `El elemento de conocimiento "${id}" no está registrado.`);
  return value;
}

export class KnowledgeRegistry {
  private readonly sources = new Map<string, KnowledgeSource>();
  private readonly connectors = new Map<string, KnowledgeConnector>();
  private readonly loaders = new Map<string, DocumentLoader>();
  private readonly parsers = new Map<string, DocumentParser>();
  private readonly chunkers = new Map<string, ChunkingStrategy>();
  private readonly vectorStores = new Map<string, VectorStore>();

  public registerSource(value: KnowledgeSource, replace = false): void { registerValue(this.sources, value.id, value, replace); }
  public registerConnector(value: KnowledgeConnector, replace = false): void { registerValue(this.connectors, value.id, value, replace); }
  public registerLoader(value: DocumentLoader, replace = false): void { registerValue(this.loaders, value.id, value, replace); }
  public registerParser(value: DocumentParser, replace = false): void { registerValue(this.parsers, value.id, value, replace); }
  public registerChunker(value: ChunkingStrategy, replace = false): void { registerValue(this.chunkers, value.id, value, replace); }
  public registerVectorStore(value: VectorStore, replace = false): void { registerValue(this.vectorStores, value.descriptor.id, value, replace); }

  public requireSource(id: string): KnowledgeSource { return requireValue(this.sources, id, "SOURCE_NOT_FOUND"); }
  public requireConnector(id: string): KnowledgeConnector { return requireValue(this.connectors, id, "CONNECTOR_NOT_FOUND"); }
  public requireLoader(id: string): DocumentLoader { return requireValue(this.loaders, id, "LOADER_NOT_FOUND"); }
  public requireParser(id: string): DocumentParser { return requireValue(this.parsers, id, "PARSER_NOT_FOUND"); }
  public requireChunker(id: string): ChunkingStrategy { return requireValue(this.chunkers, id, "CHUNKER_NOT_FOUND"); }
  public requireVectorStore(id: string): VectorStore {
    const value = this.vectorStores.get(id.trim());
    if (value === undefined) throw new KnowledgeError("VECTOR_STORE_ERROR", `El vector store "${id}" no está registrado.`);
    return value;
  }

  public findConnector(kind: KnowledgeSourceKind): KnowledgeConnector | undefined { return [...this.connectors.values()].find((value) => value.kinds.includes(kind)); }
  public findLoader(kind: KnowledgeSourceKind, mimeType: string): DocumentLoader | undefined {
    return [...this.loaders.values()].find((value) => value.sourceKinds.includes(kind) || value.mimeTypes.includes(mimeType));
  }
  public findParser(mimeType: string): DocumentParser | undefined { return [...this.parsers.values()].find((value) => value.mimeTypes.includes(mimeType)); }

  public listSources(): readonly KnowledgeSource[] { return Object.freeze([...this.sources.values()]); }
  public listConnectors(): readonly KnowledgeConnector[] { return Object.freeze([...this.connectors.values()]); }
  public listLoaders(): readonly DocumentLoader[] { return Object.freeze([...this.loaders.values()]); }
  public listParsers(): readonly DocumentParser[] { return Object.freeze([...this.parsers.values()]); }
  public listChunkers(): readonly ChunkingStrategy[] { return Object.freeze([...this.chunkers.values()]); }
  public listVectorStores(): readonly VectorStore[] { return Object.freeze([...this.vectorStores.values()]); }
}

export function createKnowledgeRegistry(): KnowledgeRegistry { return new KnowledgeRegistry(); }
