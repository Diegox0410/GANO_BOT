/** Registros de servicios de embeddings y runtimes por tenant. */
import { RuntimeError } from "./errors.js";

import type { AIEmbeddingService } from "../embeddings.js";
import type { AssistantRuntime } from "./runtime.js";
import type {
  EmbeddingServiceRegistry,
  RuntimeRegistryEntry,
} from "./types.js";

function normalizeId(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new RuntimeError(
      "INVALID_RUNTIME_CONFIGURATION",
      `${label} debe contener un identificador válido.`,
    );
  }
  return normalized;
}

function createRuntimeKey(tenantId: string, assistantId: string): string {
  return JSON.stringify([
    normalizeId(tenantId, "El tenant"),
    normalizeId(assistantId, "El asistente"),
  ]);
}

export class DefaultEmbeddingServiceRegistry implements EmbeddingServiceRegistry {
  private readonly services = new Map<string, AIEmbeddingService>();

  public register(id: string, service: AIEmbeddingService, replace = false): void {
    const normalizedId = normalizeId(id, "El servicio de embeddings");
    if (this.services.has(normalizedId) && !replace) {
      throw new RuntimeError(
        "RUNTIME_ALREADY_REGISTERED",
        `El servicio de embeddings "${normalizedId}" ya está registrado.`,
        { serviceId: normalizedId },
      );
    }
    this.services.set(normalizedId, service);
  }

  public has(id: string): boolean {
    return this.services.has(normalizeId(id, "El servicio de embeddings"));
  }

  public get(id: string): AIEmbeddingService | undefined {
    return this.services.get(normalizeId(id, "El servicio de embeddings"));
  }

  public require(id: string): AIEmbeddingService {
    const normalizedId = normalizeId(id, "El servicio de embeddings");
    const service = this.services.get(normalizedId);
    if (service === undefined) {
      throw new RuntimeError(
        "SERVICE_NOT_FOUND",
        `El servicio de embeddings "${normalizedId}" no está registrado.`,
        { serviceId: normalizedId },
      );
    }
    return service;
  }

  public list(): readonly string[] {
    return Object.freeze([...this.services.keys()]);
  }
}

export class RuntimeRegistry {
  private readonly runtimes = new Map<string, AssistantRuntime>();

  public register(runtime: AssistantRuntime, replace = false): void {
    const descriptor = runtime.descriptor;
    const key = createRuntimeKey(descriptor.tenantId, descriptor.id);
    if (this.runtimes.has(key) && !replace) {
      throw new RuntimeError(
        "RUNTIME_ALREADY_REGISTERED",
        `El runtime del asistente "${descriptor.id}" ya está registrado para el tenant "${descriptor.tenantId}".`,
        { tenantId: descriptor.tenantId, assistantId: descriptor.id },
      );
    }
    this.runtimes.set(key, runtime);
  }

  public has(tenantId: string, assistantId: string): boolean {
    return this.runtimes.has(createRuntimeKey(tenantId, assistantId));
  }

  public get(tenantId: string, assistantId: string): AssistantRuntime | undefined {
    return this.runtimes.get(createRuntimeKey(tenantId, assistantId));
  }

  public require(tenantId: string, assistantId: string): AssistantRuntime {
    const runtime = this.get(tenantId, assistantId);
    if (runtime === undefined) {
      throw new RuntimeError(
        "RUNTIME_NOT_FOUND",
        `No existe un runtime para el asistente "${assistantId}" del tenant "${tenantId}".`,
        { tenantId, assistantId },
      );
    }
    return runtime;
  }

  public remove(tenantId: string, assistantId: string): boolean {
    return this.runtimes.delete(createRuntimeKey(tenantId, assistantId));
  }

  public list(tenantId?: string): readonly RuntimeRegistryEntry[] {
    const normalizedTenantId = tenantId === undefined ? undefined : normalizeId(tenantId, "El tenant");
    return Object.freeze(
      [...this.runtimes.values()]
        .filter((runtime) => normalizedTenantId === undefined || runtime.descriptor.tenantId === normalizedTenantId)
        .map((runtime) => Object.freeze({
          tenantId: runtime.descriptor.tenantId,
          assistantId: runtime.descriptor.id,
          descriptor: runtime.descriptor,
        })),
    );
  }
}

export function createEmbeddingServiceRegistry(): EmbeddingServiceRegistry {
  return new DefaultEmbeddingServiceRegistry();
}

export function createRuntimeRegistry(): RuntimeRegistry {
  return new RuntimeRegistry();
}
