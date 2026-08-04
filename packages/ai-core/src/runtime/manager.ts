/** Administración multi-tenant de runtimes construidos. */
import { AssistantFactory } from "./factory.js";
import { RuntimeRegistry } from "./registry.js";

import type { AssistantRuntime } from "./runtime.js";
import type {
  AssistantRuntimeConfig,
  RuntimeExecution,
  RuntimeRegistryEntry,
  RuntimeResult,
} from "./types.js";

export interface AssistantManagerConfig {
  readonly factory?: AssistantFactory;
  readonly registry?: RuntimeRegistry;
}

export class AssistantManager {
  private readonly factory: AssistantFactory;
  private readonly registry: RuntimeRegistry;

  public constructor(config: AssistantManagerConfig = {}) {
    this.factory = config.factory ?? new AssistantFactory();
    this.registry = config.registry ?? new RuntimeRegistry();
  }

  public create(config: AssistantRuntimeConfig, replace = false): AssistantRuntime {
    const runtime = this.factory.create(config);
    this.registry.register(runtime, replace);
    return runtime;
  }

  public register(runtime: AssistantRuntime, replace = false): void {
    this.registry.register(runtime, replace);
  }

  public get(tenantId: string, assistantId: string): AssistantRuntime | undefined {
    return this.registry.get(tenantId, assistantId);
  }

  public require(tenantId: string, assistantId: string): AssistantRuntime {
    return this.registry.require(tenantId, assistantId);
  }

  public remove(tenantId: string, assistantId: string): boolean {
    return this.registry.remove(tenantId, assistantId);
  }

  public list(tenantId?: string): readonly RuntimeRegistryEntry[] {
    return this.registry.list(tenantId);
  }

  public execute(execution: RuntimeExecution): Promise<RuntimeResult> {
    const context = execution.context;
    return this.registry.require(context.tenantId, context.assistantId).execute(execution);
  }
}

export function createAssistantManager(config: AssistantManagerConfig = {}): AssistantManager {
  return new AssistantManager(config);
}
