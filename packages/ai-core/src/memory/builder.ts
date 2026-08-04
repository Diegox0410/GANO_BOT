import { MemoryError } from "./errors.js";
import { createMemoryPipeline } from "./pipeline.js";
import type {
  MemoryConfiguration,
  MemoryDependencies,
  MemoryServices,
} from "./types.js";
export class MemoryBuilder {
  private dependencies: MemoryDependencies | undefined;
  private configuration: MemoryConfiguration = {};
  public withDependencies(dependencies: MemoryDependencies): this {
    this.dependencies = dependencies;
    return this;
  }
  public withConfiguration(configuration: MemoryConfiguration): this {
    this.configuration = configuration;
    return this;
  }
  public build(): MemoryServices {
    if (this.dependencies === undefined)
      throw new MemoryError(
        "INVALID_CONFIGURATION",
        "MemoryBuilder requiere dependencias.",
      );
    return Object.freeze({
      pipeline: createMemoryPipeline(this.dependencies, this.configuration),
      store: this.dependencies.store,
      configuration: Object.freeze({
        ...this.configuration,
        retention: Object.freeze({ ...this.configuration.retention }),
      }),
    });
  }
}
export function createMemoryBuilder(): MemoryBuilder {
  return new MemoryBuilder();
}
