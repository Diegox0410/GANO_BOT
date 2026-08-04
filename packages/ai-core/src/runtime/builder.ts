/** Constructor fluido y validado de AssistantRuntime. */
import { AssistantFactory } from "./factory.js";
import { RuntimeConfigurationError } from "./errors.js";

import type { AssistantRuntime } from "./runtime.js";
import type {
  AssistantDefinition,
  RuntimeDependencies,
  RuntimeHooks,
} from "./types.js";

export class RuntimeBuilder {
  private definition: AssistantDefinition | undefined;
  private dependencies: RuntimeDependencies | undefined;
  private hooks: RuntimeHooks | undefined;

  public withDefinition(definition: AssistantDefinition): this {
    this.definition = definition;
    return this;
  }

  public withDependencies(dependencies: RuntimeDependencies): this {
    this.dependencies = dependencies;
    return this;
  }

  public withHooks(hooks: RuntimeHooks): this {
    this.hooks = hooks;
    return this;
  }

  public build(factory?: AssistantFactory): AssistantRuntime {
    if (this.definition === undefined) {
      throw new RuntimeConfigurationError("RuntimeBuilder requiere AssistantDefinition.");
    }
    if (this.dependencies === undefined) {
      throw new RuntimeConfigurationError("RuntimeBuilder requiere RuntimeDependencies.", {
        tenantId: this.definition.descriptor.tenantId,
        assistantId: this.definition.descriptor.id,
      });
    }
    return (factory ?? new AssistantFactory()).create({
      definition: this.definition,
      dependencies: this.dependencies,
      ...(this.hooks !== undefined ? { hooks: this.hooks } : {}),
    });
  }
}

export function createRuntimeBuilder(): RuntimeBuilder {
  return new RuntimeBuilder();
}
