/** Instancia ejecutable e inmutable de un asistente. */
import type {
  AssistantDefinition,
  AssistantDescriptor,
  RuntimeExecution,
  RuntimePipeline,
  RuntimeResult,
  RuntimeServices,
} from "./types.js";

export interface AssistantRuntimeComponents {
  readonly definition: AssistantDefinition;
  readonly services: RuntimeServices;
  readonly pipeline: RuntimePipeline;
}

export class AssistantRuntime {
  public readonly definition: AssistantDefinition;
  public readonly descriptor: AssistantDescriptor;
  public readonly services: RuntimeServices;
  private readonly pipeline: RuntimePipeline;

  public constructor(components: AssistantRuntimeComponents) {
    this.definition = components.definition;
    this.descriptor = components.definition.descriptor;
    this.services = components.services;
    this.pipeline = components.pipeline;
  }

  public execute(execution: RuntimeExecution): Promise<RuntimeResult> {
    return this.pipeline.execute(execution);
  }

  public run(execution: RuntimeExecution): Promise<RuntimeResult> {
    return this.execute(execution);
  }
}
