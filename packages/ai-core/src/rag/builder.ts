import { RAGError } from "./errors.js";
import { createRAGPipeline } from "./pipeline.js";
import type {
  RAGConfiguration,
  RAGDependencies,
  RAGServices,
} from "./types.js";
export class RAGBuilder {
  private dependencies: RAGDependencies | undefined;
  private configuration: RAGConfiguration = {
    groundingMode: "strict-private-knowledge",
  };
  public withDependencies(dependencies: RAGDependencies): this {
    this.dependencies = dependencies;
    return this;
  }
  public withConfiguration(configuration: RAGConfiguration): this {
    this.configuration = configuration;
    return this;
  }
  public build(): RAGServices {
    if (this.dependencies === undefined)
      throw new RAGError(
        "INVALID_CONFIGURATION",
        "RAGBuilder requiere dependencias.",
      );
    return Object.freeze({
      pipeline: createRAGPipeline(this.dependencies, this.configuration),
      configuration: Object.freeze({ ...this.configuration }),
    });
  }
}
export function createRAGBuilder(): RAGBuilder {
  return new RAGBuilder();
}
