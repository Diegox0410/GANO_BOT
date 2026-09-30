/**
 * @package @gano-bot/ai-core
 * @file providers/registry.ts
 * @version 1.0.0
 *
 * Registro central de proveedores de embeddings.
 *
 * Responsabilidades:
 * - Registrar proveedores mediante un identificador único.
 * - Consultar proveedores registrados.
 * - Definir un proveedor predeterminado.
 * - Reemplazar o eliminar proveedores.
 * - Crear registros preconfigurados con OpenAI y Gemini.
 * - Mantener desacoplado el servicio de embeddings.
 */

import type {
  AIEmbeddingProvider,
} from "../types";

import {
  createGeminiEmbeddingProvider,
  type GeminiProviderConfig,
} from "./gemini.js";

import {
  createOpenAIEmbeddingProvider,
  type OpenAIProviderConfig,
} from "./openai.js";

/* ============================================================================
 * TIPOS PÚBLICOS
 * ========================================================================== */

/**
 * Identificadores nativos incluidos actualmente.
 *
 * El registro también admite identificadores personalizados.
 */
export type BuiltInEmbeddingProviderId =
  | "openai"
  | "gemini";

/**
 * Identificador general de proveedor.
 */
export type EmbeddingProviderId =
  BuiltInEmbeddingProviderId |
  (string & {});

/**
 * Información pública de un proveedor registrado.
 */
export interface RegisteredEmbeddingProvider {
  /**
   * Identificador único del proveedor.
   */
  readonly id:
    EmbeddingProviderId;

  /**
   * Nombre legible para interfaces o diagnósticos.
   */
  readonly displayName:
    string;

  /**
   * Instancia que implementa el contrato de embeddings.
   */
  readonly provider:
    AIEmbeddingProvider;

  /**
   * Modelo predeterminado asociado al registro.
   *
   * Es únicamente informativo. El proveedor puede resolver
   * su propio modelo predeterminado internamente.
   */
  readonly defaultModel?:
    string;

  /**
   * Indica si el proveedor está activo.
   */
  readonly enabled:
    boolean;
}

/**
 * Datos necesarios para registrar un proveedor.
 */
export interface RegisterEmbeddingProviderInput {
  readonly id:
    EmbeddingProviderId;

  readonly displayName?:
    string;

  readonly provider:
    AIEmbeddingProvider;

  readonly defaultModel?:
    string;

  readonly enabled?:
    boolean;

  /**
   * Permite reemplazar un proveedor existente.
   */
  readonly replaceExisting?:
    boolean;

  /**
   * Establece este proveedor como predeterminado.
   */
  readonly makeDefault?:
    boolean;
}

/**
 * Configuración inicial del registro.
 */
export interface EmbeddingProviderRegistryConfig {
  readonly providers?:
    readonly RegisterEmbeddingProviderInput[];

  readonly defaultProviderId?:
    EmbeddingProviderId;
}

/**
 * Configuración para crear un registro con proveedores nativos.
 */
export interface BuiltInEmbeddingProviderRegistryConfig {
  readonly openAI?:
    OpenAIProviderConfig;

  readonly gemini?:
    GeminiProviderConfig;

  /**
   * Proveedor que debe utilizarse por defecto.
   *
   * Cuando no se especifica:
   * - Se utiliza OpenAI si está configurado.
   * - En caso contrario, se utiliza Gemini.
   */
  readonly defaultProvider?:
    BuiltInEmbeddingProviderId;
}

/* ============================================================================
 * ERRORES
 * ========================================================================== */

export type EmbeddingProviderRegistryErrorCode =
  | "INVALID_PROVIDER_ID"
  | "INVALID_DISPLAY_NAME"
  | "PROVIDER_ALREADY_REGISTERED"
  | "PROVIDER_NOT_FOUND"
  | "PROVIDER_DISABLED"
  | "DEFAULT_PROVIDER_NOT_CONFIGURED"
  | "DEFAULT_PROVIDER_DISABLED"
  | "INVALID_DEFAULT_PROVIDER";

export class EmbeddingProviderRegistryError
  extends Error {
  public override readonly name =
    "EmbeddingProviderRegistryError";

  public constructor(
    public readonly code:
      EmbeddingProviderRegistryErrorCode,

    message: string,

    public readonly providerId?:
      EmbeddingProviderId,

    public override readonly cause?:
      unknown,
  ) {
    super(
      message,
      cause === undefined
        ? undefined
        : {
            cause,
          },
    );
  }
}

/* ============================================================================
 * CONTRATO DEL REGISTRO
 * ========================================================================== */

export interface EmbeddingProviderRegistry {
  /**
   * Registra un nuevo proveedor.
   */
  register(
    input: RegisterEmbeddingProviderInput,
  ): RegisteredEmbeddingProvider;

  /**
   * Elimina un proveedor.
   */
  unregister(
    providerId: EmbeddingProviderId,
  ): boolean;

  /**
   * Comprueba si existe un proveedor.
   */
  has(
    providerId: EmbeddingProviderId,
  ): boolean;

  /**
   * Obtiene un proveedor, incluso si se encuentra deshabilitado.
   */
  get(
    providerId: EmbeddingProviderId,
  ): RegisteredEmbeddingProvider | null;

  /**
   * Obtiene un proveedor activo.
   *
   * Lanza un error cuando no existe o está deshabilitado.
   */
  require(
    providerId: EmbeddingProviderId,
  ): AIEmbeddingProvider;

  /**
   * Devuelve todos los registros.
   */
  list():
    readonly RegisteredEmbeddingProvider[];

  /**
   * Devuelve únicamente los proveedores habilitados.
   */
  listEnabled():
    readonly RegisteredEmbeddingProvider[];

  /**
   * Habilita o deshabilita un proveedor.
   */
  setEnabled(
    providerId: EmbeddingProviderId,
    enabled: boolean,
  ): RegisteredEmbeddingProvider;

  /**
   * Define el proveedor predeterminado.
   */
  setDefault(
    providerId: EmbeddingProviderId,
  ): void;

  /**
   * Devuelve el identificador predeterminado.
   */
  getDefaultId():
    EmbeddingProviderId | null;

  /**
   * Devuelve el proveedor predeterminado activo.
   */
  getDefault():
    AIEmbeddingProvider;

  /**
   * Elimina todos los proveedores.
   */
  clear(): void;
}

/* ============================================================================
 * UTILIDADES
 * ========================================================================== */

function normalizeRequiredIdentifier(
  value: string,
): EmbeddingProviderId {
  const normalized =
    value.trim().toLowerCase();

  if (normalized.length === 0) {
    throw new EmbeddingProviderRegistryError(
      "INVALID_PROVIDER_ID",
      "El identificador del proveedor no puede estar vacío.",
    );
  }

  if (
    !/^[a-z0-9][a-z0-9._-]*$/.test(
      normalized,
    )
  ) {
    throw new EmbeddingProviderRegistryError(
      "INVALID_PROVIDER_ID",
      [
        `El identificador "${value}" no es válido.`,
        "Solo se permiten letras minúsculas, números, puntos, guiones y guiones bajos.",
      ].join(" "),
      normalized,
    );
  }

  return normalized;
}

function normalizeDisplayName(
  value: string | undefined,
  fallback: string,
): string {
  const normalized =
    value?.trim();

  if (
    normalized === undefined ||
    normalized.length === 0
  ) {
    return fallback;
  }

  return normalized;
}

function normalizeOptionalModel(
  value: string | undefined,
): string | undefined {
  const normalized =
    value?.trim();

  return normalized !== undefined &&
    normalized.length > 0
    ? normalized
    : undefined;
}

function cloneRegisteredProvider(
  value: RegisteredEmbeddingProvider,
): RegisteredEmbeddingProvider {
  const result: {
    id: EmbeddingProviderId;
    displayName: string;
    provider: AIEmbeddingProvider;
    defaultModel?: string;
    enabled: boolean;
  } = {
    id:
      value.id,
    displayName:
      value.displayName,
    provider:
      value.provider,
    enabled:
      value.enabled,
  };

  if (
    value.defaultModel !== undefined
  ) {
    result.defaultModel =
      value.defaultModel;
  }

  return Object.freeze(
    result,
  );
}

function createRegisteredProvider(
  input: RegisterEmbeddingProviderInput,
): RegisteredEmbeddingProvider {
  const id =
    normalizeRequiredIdentifier(
      input.id,
    );

  const displayName =
    normalizeDisplayName(
      input.displayName,
      id,
    );

  const defaultModel =
    normalizeOptionalModel(
      input.defaultModel,
    );

  const result: {
    id: EmbeddingProviderId;
    displayName: string;
    provider: AIEmbeddingProvider;
    defaultModel?: string;
    enabled: boolean;
  } = {
    id,
    displayName,
    provider:
      input.provider,
    enabled:
      input.enabled ??
      true,
  };

  if (
    defaultModel !== undefined
  ) {
    result.defaultModel =
      defaultModel;
  }

  return Object.freeze(
    result,
  );
}

/* ============================================================================
 * IMPLEMENTACIÓN
 * ========================================================================== */

export class DefaultEmbeddingProviderRegistry
  implements EmbeddingProviderRegistry {
  private readonly providers =
    new Map<
      EmbeddingProviderId,
      RegisteredEmbeddingProvider
    >();

  private defaultProviderId:
    EmbeddingProviderId | null =
      null;

  public constructor(
    config: EmbeddingProviderRegistryConfig = {},
  ) {
    for (
      const provider of
      config.providers ?? []
    ) {
      this.register(
        provider,
      );
    }

    if (
      config.defaultProviderId !==
      undefined
    ) {
      this.setDefault(
        config.defaultProviderId,
      );
    }
  }

  public register(
    input: RegisterEmbeddingProviderInput,
  ): RegisteredEmbeddingProvider {
    const registered =
      createRegisteredProvider(
        input,
      );

    const existing =
      this.providers.get(
        registered.id,
      );

    if (
      existing !== undefined &&
      input.replaceExisting !== true
    ) {
      throw new EmbeddingProviderRegistryError(
        "PROVIDER_ALREADY_REGISTERED",
        `El proveedor "${registered.id}" ya se encuentra registrado.`,
        registered.id,
      );
    }

    this.providers.set(
      registered.id,
      registered,
    );

    if (
      input.makeDefault === true ||
      this.defaultProviderId === null
    ) {
      this.defaultProviderId =
        registered.id;
    }

    return cloneRegisteredProvider(
      registered,
    );
  }

  public unregister(
    providerId: EmbeddingProviderId,
  ): boolean {
    const normalizedId =
      normalizeRequiredIdentifier(
        providerId,
      );

    const removed =
      this.providers.delete(
        normalizedId,
      );

    if (
      removed &&
      this.defaultProviderId ===
        normalizedId
    ) {
      this.defaultProviderId =
        this.findFirstEnabledProviderId();
    }

    return removed;
  }

  public has(
    providerId: EmbeddingProviderId,
  ): boolean {
    const normalizedId =
      normalizeRequiredIdentifier(
        providerId,
      );

    return this.providers.has(
      normalizedId,
    );
  }

  public get(
    providerId: EmbeddingProviderId,
  ): RegisteredEmbeddingProvider | null {
    const normalizedId =
      normalizeRequiredIdentifier(
        providerId,
      );

    const provider =
      this.providers.get(
        normalizedId,
      );

    return provider === undefined
      ? null
      : cloneRegisteredProvider(
          provider,
        );
  }

  public require(
    providerId: EmbeddingProviderId,
  ): AIEmbeddingProvider {
    const normalizedId =
      normalizeRequiredIdentifier(
        providerId,
      );

    const registered =
      this.providers.get(
        normalizedId,
      );

    if (
      registered === undefined
    ) {
      throw new EmbeddingProviderRegistryError(
        "PROVIDER_NOT_FOUND",
        `El proveedor "${normalizedId}" no se encuentra registrado.`,
        normalizedId,
      );
    }

    if (!registered.enabled) {
      throw new EmbeddingProviderRegistryError(
        "PROVIDER_DISABLED",
        `El proveedor "${normalizedId}" está deshabilitado.`,
        normalizedId,
      );
    }

    return registered.provider;
  }

  public list():
    readonly RegisteredEmbeddingProvider[] {
    return Object.freeze(
      Array.from(
        this.providers.values(),
        (
          provider,
        ) =>
          cloneRegisteredProvider(
            provider,
          ),
      ),
    );
  }

  public listEnabled():
    readonly RegisteredEmbeddingProvider[] {
    return Object.freeze(
      Array.from(
        this.providers.values(),
      )
        .filter(
          (
            provider,
          ) =>
            provider.enabled,
        )
        .map(
          (
            provider,
          ) =>
            cloneRegisteredProvider(
              provider,
            ),
        ),
    );
  }

  public setEnabled(
    providerId: EmbeddingProviderId,
    enabled: boolean,
  ): RegisteredEmbeddingProvider {
    const normalizedId =
      normalizeRequiredIdentifier(
        providerId,
      );

    const current =
      this.providers.get(
        normalizedId,
      );

    if (
      current === undefined
    ) {
      throw new EmbeddingProviderRegistryError(
        "PROVIDER_NOT_FOUND",
        `El proveedor "${normalizedId}" no se encuentra registrado.`,
        normalizedId,
      );
    }

    const updated:
      RegisteredEmbeddingProvider =
        Object.freeze({
          ...current,
          enabled,
        });

    this.providers.set(
      normalizedId,
      updated,
    );

    if (
      !enabled &&
      this.defaultProviderId ===
        normalizedId
    ) {
      this.defaultProviderId =
        this.findFirstEnabledProviderId(
          normalizedId,
        );
    }

    if (
      enabled &&
      this.defaultProviderId === null
    ) {
      this.defaultProviderId =
        normalizedId;
    }

    return cloneRegisteredProvider(
      updated,
    );
  }

  public setDefault(
    providerId: EmbeddingProviderId,
  ): void {
    const normalizedId =
      normalizeRequiredIdentifier(
        providerId,
      );

    const provider =
      this.providers.get(
        normalizedId,
      );

    if (
      provider === undefined
    ) {
      throw new EmbeddingProviderRegistryError(
        "INVALID_DEFAULT_PROVIDER",
        `No se puede definir "${normalizedId}" como predeterminado porque no está registrado.`,
        normalizedId,
      );
    }

    if (!provider.enabled) {
      throw new EmbeddingProviderRegistryError(
        "DEFAULT_PROVIDER_DISABLED",
        `No se puede definir "${normalizedId}" como predeterminado porque está deshabilitado.`,
        normalizedId,
      );
    }

    this.defaultProviderId =
      normalizedId;
  }

  public getDefaultId():
    EmbeddingProviderId | null {
    return this.defaultProviderId;
  }

  public getDefault():
    AIEmbeddingProvider {
    if (
      this.defaultProviderId === null
    ) {
      throw new EmbeddingProviderRegistryError(
        "DEFAULT_PROVIDER_NOT_CONFIGURED",
        "No existe un proveedor de embeddings predeterminado.",
      );
    }

    const provider =
      this.providers.get(
        this.defaultProviderId,
      );

    if (
      provider === undefined
    ) {
      throw new EmbeddingProviderRegistryError(
        "DEFAULT_PROVIDER_NOT_CONFIGURED",
        `El proveedor predeterminado "${this.defaultProviderId}" ya no está registrado.`,
        this.defaultProviderId,
      );
    }

    if (!provider.enabled) {
      throw new EmbeddingProviderRegistryError(
        "DEFAULT_PROVIDER_DISABLED",
        `El proveedor predeterminado "${this.defaultProviderId}" está deshabilitado.`,
        this.defaultProviderId,
      );
    }

    return provider.provider;
  }

  public clear(): void {
    this.providers.clear();

    this.defaultProviderId =
      null;
  }

  private findFirstEnabledProviderId(
    excludedProviderId?:
      EmbeddingProviderId,
  ): EmbeddingProviderId | null {
    for (
      const provider of
      this.providers.values()
    ) {
      if (
        provider.enabled &&
        provider.id !==
          excludedProviderId
      ) {
        return provider.id;
      }
    }

    return null;
  }
}

/* ============================================================================
 * FACTORÍAS
 * ========================================================================== */

/**
 * Crea un registro vacío o inicializado con proveedores personalizados.
 */
export function createEmbeddingProviderRegistry(
  config: EmbeddingProviderRegistryConfig = {},
): EmbeddingProviderRegistry {
  return new DefaultEmbeddingProviderRegistry(
    config,
  );
}

/**
 * Crea un registro utilizando los proveedores nativos disponibles.
 */
export function createBuiltInEmbeddingProviderRegistry(
  config: BuiltInEmbeddingProviderRegistryConfig,
): EmbeddingProviderRegistry {
  const registry =
    new DefaultEmbeddingProviderRegistry();

  if (
    config.openAI !== undefined
  ) {
    registry.register({
      id:
        "openai",
      displayName:
        "OpenAI",
      provider:
        createOpenAIEmbeddingProvider(
          config.openAI,
        ),
      defaultModel:
        config.openAI.defaultModel,
    });
  }

  if (
    config.gemini !== undefined
  ) {
    registry.register({
      id:
        "gemini",
      displayName:
        "Google Gemini",
      provider:
        createGeminiEmbeddingProvider(
          config.gemini,
        ),
      defaultModel:
        config.gemini.defaultModel,
    });
  }

  const requestedDefault =
    config.defaultProvider;

  if (
    requestedDefault !== undefined
  ) {
    registry.setDefault(
      requestedDefault,
    );

    return registry;
  }

  if (
    registry.has(
      "openai",
    )
  ) {
    registry.setDefault(
      "openai",
    );

    return registry;
  }

  if (
    registry.has(
      "gemini",
    )
  ) {
    registry.setDefault(
      "gemini",
    );
  }

  return registry;
}