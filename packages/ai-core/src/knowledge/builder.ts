import { createCitationBuilder } from "./citations.js";
import { createKnowledgeIngestionPipeline } from "./ingestion.js";
import { createKnowledgeRegistry } from "./registry.js";
import { createKnowledgeServices } from "./services.js";
import { KnowledgeError } from "./errors.js";

import type { CitationBuilder } from "./citations.js";
import type { KnowledgeEmbeddingRegistry } from "./embeddings.js";
import type { KnowledgeRegistry } from "./registry.js";
import type { KnowledgeRepository } from "./repository.js";
import type { Retriever } from "./retrieval.js";
import type { KnowledgeServices } from "./services.js";
import type { KnowledgeConfiguration } from "./types.js";

export class KnowledgeBuilder {
  private configuration: KnowledgeConfiguration = {};
  private registry: KnowledgeRegistry = createKnowledgeRegistry();
  private repository: KnowledgeRepository | undefined;
  private embeddings: KnowledgeEmbeddingRegistry | undefined;
  private retriever: Retriever | undefined;
  private citations: CitationBuilder = createCitationBuilder();

  public withConfiguration(configuration: KnowledgeConfiguration): this { this.configuration = configuration; return this; }
  public withRegistry(registry: KnowledgeRegistry): this { this.registry = registry; return this; }
  public withRepository(repository: KnowledgeRepository): this { this.repository = repository; return this; }
  public withEmbeddings(embeddings: KnowledgeEmbeddingRegistry): this { this.embeddings = embeddings; return this; }
  public withRetriever(retriever: Retriever): this { this.retriever = retriever; return this; }
  public withCitationBuilder(citations: CitationBuilder): this { this.citations = citations; return this; }

  public build(): KnowledgeServices {
    if (this.repository === undefined) throw new KnowledgeError("INVALID_CONFIGURATION", "KnowledgeBuilder requiere KnowledgeRepository.");
    const ingestion = createKnowledgeIngestionPipeline({ registry: this.registry, repository: this.repository, configuration: this.configuration });
    return createKnowledgeServices({
      configuration: this.configuration, registry: this.registry, repository: this.repository, ingestion,
      ...(this.embeddings !== undefined ? { embeddings: this.embeddings } : {}),
      ...(this.retriever !== undefined ? { retriever: this.retriever } : {}),
      citations: this.citations,
    });
  }
}

export function createKnowledgeBuilder(): KnowledgeBuilder { return new KnowledgeBuilder(); }
