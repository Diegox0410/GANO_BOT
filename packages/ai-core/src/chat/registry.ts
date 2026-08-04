/** Registro mutable y aislado de proveedores conversacionales. */
import { AIChatProviderError } from "./base";

import type {
  AIChatProvider,
  AIChatProviderDescriptor,
} from "./types";

export interface RegisterAIChatProviderOptions {
  readonly replace?: boolean;
  readonly enabled?: boolean;
  readonly makeDefault?: boolean;
}

export interface AIChatProviderRegistryConfig {
  readonly providers?: readonly AIChatProvider[];
  readonly defaultProviderId?: string;
}

interface RegistryEntry {
  readonly provider: AIChatProvider;
  enabled: boolean;
}

function normalizeProviderId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new AIChatProviderError(
      "INVALID_REQUEST",
      "El identificador del proveedor no puede estar vacío.",
      { providerId: "registry" },
    );
  }
  return normalized;
}

export class AIChatProviderRegistry {
  private readonly entries = new Map<string, RegistryEntry>();
  private defaultProviderId: string | undefined;

  public constructor(config: AIChatProviderRegistryConfig = {}) {
    for (const provider of config.providers ?? []) {
      this.register(provider);
    }
    if (config.defaultProviderId !== undefined) {
      this.setDefault(config.defaultProviderId);
    }
  }

  public register(
    provider: AIChatProvider,
    options: RegisterAIChatProviderOptions = {},
  ): void {
    const id = normalizeProviderId(provider.descriptor.id);
    const existing = this.entries.get(id);
    if (existing !== undefined && options.replace !== true) {
      throw new AIChatProviderError(
        "INVALID_CONFIGURATION",
        `El proveedor conversacional "${id}" ya está registrado.`,
        { providerId: id },
      );
    }
    const enabled = options.enabled ?? provider.descriptor.enabled;
    this.entries.set(id, { provider, enabled });
    if (options.makeDefault === true) {
      if (!enabled) {
        this.entries.set(id, { provider, enabled: false });
        throw new AIChatProviderError(
          "INVALID_CONFIGURATION",
          `El proveedor deshabilitado "${id}" no puede ser predeterminado.`,
          { providerId: id },
        );
      }
      this.defaultProviderId = id;
    } else if (existing !== undefined && this.defaultProviderId === id && !enabled) {
      this.defaultProviderId = undefined;
    }
  }

  public replace(provider: AIChatProvider): void {
    this.register(provider, { replace: true });
  }

  public enable(providerId: string): void {
    const id = normalizeProviderId(providerId);
    const entry = this.requireEntry(id);
    entry.enabled = true;
  }

  public disable(providerId: string): void {
    const id = normalizeProviderId(providerId);
    const entry = this.requireEntry(id);
    entry.enabled = false;
    if (this.defaultProviderId === id) this.defaultProviderId = undefined;
  }

  public isEnabled(providerId: string): boolean {
    const id = normalizeProviderId(providerId);
    return this.entries.get(id)?.enabled === true;
  }

  public has(providerId: string): boolean {
    return this.entries.has(normalizeProviderId(providerId));
  }

  public get(providerId?: string): AIChatProvider | undefined {
    const id = providerId === undefined ? this.defaultProviderId : normalizeProviderId(providerId);
    if (id === undefined) return undefined;
    const entry = this.entries.get(id);
    return entry?.enabled === true ? entry.provider : undefined;
  }

  public require(providerId?: string): AIChatProvider {
    const provider = this.get(providerId);
    if (provider !== undefined) return provider;
    const id = providerId === undefined ? this.defaultProviderId : normalizeProviderId(providerId);
    const label = id ?? "predeterminado";
    throw new AIChatProviderError(
      "INVALID_CONFIGURATION",
      `El proveedor conversacional "${label}" no está registrado o está deshabilitado.`,
      { providerId: id ?? "registry" },
    );
  }

  public list(): readonly AIChatProvider[] {
    return Object.freeze(
      [...this.entries.values()]
        .filter((entry) => entry.enabled)
        .map((entry) => entry.provider),
    );
  }

  public listAll(): readonly AIChatProvider[] {
    return Object.freeze([...this.entries.values()].map((entry) => entry.provider));
  }

  public listDescriptors(): readonly AIChatProviderDescriptor[] {
    return Object.freeze([...this.entries.values()].map((entry) => {
      const descriptor = entry.provider.descriptor;
      const result: {
        id: string;
        name: AIChatProviderDescriptor["name"];
        displayName: string;
        defaultModel?: string;
        capabilities: AIChatProviderDescriptor["capabilities"];
        enabled: boolean;
        metadata?: AIChatProviderDescriptor["metadata"];
      } = {
        id: descriptor.id,
        name: descriptor.name,
        displayName: descriptor.displayName,
        capabilities: descriptor.capabilities,
        enabled: entry.enabled,
      };
      if (descriptor.defaultModel !== undefined) result.defaultModel = descriptor.defaultModel;
      if (descriptor.metadata !== undefined) result.metadata = descriptor.metadata;
      return Object.freeze(result);
    }));
  }

  public setDefault(providerId: string): void {
    const id = normalizeProviderId(providerId);
    const entry = this.requireEntry(id);
    if (!entry.enabled) {
      throw new AIChatProviderError(
        "INVALID_CONFIGURATION",
        `El proveedor deshabilitado "${id}" no puede ser predeterminado.`,
        { providerId: id },
      );
    }
    this.defaultProviderId = id;
  }

  public getDefault(): AIChatProvider | undefined {
    return this.get();
  }

  public getDefaultProviderId(): string | undefined {
    return this.defaultProviderId;
  }

  private requireEntry(providerId: string): RegistryEntry {
    const entry = this.entries.get(providerId);
    if (entry === undefined) {
      throw new AIChatProviderError(
        "INVALID_CONFIGURATION",
        `El proveedor conversacional "${providerId}" no está registrado.`,
        { providerId },
      );
    }
    return entry;
  }
}

export function createAIChatProviderRegistry(
  config: AIChatProviderRegistryConfig = {},
): AIChatProviderRegistry {
  return new AIChatProviderRegistry(config);
}
