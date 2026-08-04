/**
 * @package @gano-bot/ai-core
 * @file memory.ts
 * @version 0.2.0
 *
 * Motor de memoria de GANO_BOT.
 *
 * Responsabilidades:
 * - Crear y normalizar recuerdos.
 * - Guardar recuerdos en memoria.
 * - Buscar por texto, tipo, alcance, importancia y confianza.
 * - Detectar recuerdos expirados.
 * - Actualizar, eliminar e importar recuerdos.
 * - Exportar snapshots serializables.
 * - Mantener una memoria limitada y ordenada.
 *
 * Este módulo no depende de Firebase ni de un proveedor vectorial.
 * Posteriormente podrá utilizarse como implementación local o como
 * contrato de referencia para una persistencia en Firestore.
 */

import type {
  AIConfidence,
  AIIdentifier,
  AIISODateString,
  AIMemoryEntry,
  AIMemoryQuery,
  AIMemoryScope,
  AIMemorySearchResult,
  AIMemorySnapshot,
  AIMemoryStore,
  AIMemoryType,
  AIMetadata,
} from "./types.js";

import {
  EMPTY_AI_METADATA,
} from "./types.js";

/* ============================================================================
 * TIPOS PÚBLICOS
 * ========================================================================== */

export interface CreateMemoryEntryInput {
  readonly id?: AIIdentifier;
  readonly type: AIMemoryType;
  readonly scope: AIMemoryScope;
  readonly content: string;
  readonly importance?: number;
  readonly confidence?: AIConfidence;
  readonly createdAt?: AIISODateString;
  readonly updatedAt?: AIISODateString;
  readonly expiresAt?: AIISODateString;
  readonly sourceMessageIds?: readonly AIIdentifier[];
  readonly metadata?: AIMetadata;
}

export interface UpdateMemoryEntryInput {
  readonly type?: AIMemoryType;
  readonly scope?: AIMemoryScope;
  readonly content?: string;
  readonly importance?: number;
  readonly confidence?: AIConfidence;
  readonly expiresAt?: AIISODateString | null;
  readonly sourceMessageIds?: readonly AIIdentifier[];
  readonly metadata?: AIMetadata;
}

export interface MemoryStoreConfig {
  /**
   * Máximo de recuerdos que podrá conservar el almacén.
   *
   * Cuando se supera este límite se eliminan primero:
   * 1. Recuerdos expirados.
   * 2. Recuerdos con menor importancia.
   * 3. Recuerdos con menor confianza.
   * 4. Recuerdos más antiguos.
   */
  readonly maximumEntries?: number;

  /**
   * Permite reemplazar un recuerdo existente al llamar save().
   */
  readonly overwriteExisting?: boolean;

  /**
   * Permite eliminar automáticamente recuerdos expirados.
   */
  readonly removeExpiredAutomatically?: boolean;

  /**
   * Función personalizada para crear identificadores.
   */
  readonly generateId?: () => AIIdentifier;

  /**
   * Función personalizada para obtener la fecha actual.
   */
  readonly now?: () => AIISODateString;

  /**
   * Recuerdos iniciales.
   */
  readonly initialEntries?: readonly AIMemoryEntry[];
}

export interface MemoryManagerConfig {
  readonly store?: AIMemoryStore;
  readonly defaultScope?: AIMemoryScope;
  readonly defaultImportance?: number;
  readonly defaultConfidence?: AIConfidence;
  readonly maximumSearchResults?: number;
  readonly generateId?: () => AIIdentifier;
  readonly now?: () => AIISODateString;
}

export interface RememberInput {
  readonly id?: AIIdentifier;
  readonly type: AIMemoryType;
  readonly scope?: AIMemoryScope;
  readonly content: string;
  readonly importance?: number;
  readonly confidence?: AIConfidence;
  readonly expiresAt?: AIISODateString;
  readonly sourceMessageIds?: readonly AIIdentifier[];
  readonly metadata?: AIMetadata;
}

export interface RememberManyResult {
  readonly saved: readonly AIMemoryEntry[];
  readonly rejected: readonly MemoryRejectedEntry[];
}

export interface MemoryRejectedEntry {
  readonly index: number;
  readonly input: RememberInput;
  readonly reason: string;
}

export interface MemoryStatistics {
  readonly total: number;
  readonly active: number;
  readonly expired: number;
  readonly byType: Readonly<Record<AIMemoryType, number>>;
  readonly byScope: Readonly<Record<AIMemoryScope, number>>;
  readonly averageImportance: number;
  readonly averageConfidence: number;
}

export interface MemoryPruneOptions {
  readonly removeExpired?: boolean;
  readonly maximumEntries?: number;
  readonly minimumImportance?: number;
  readonly minimumConfidence?: AIConfidence;
}

export interface MemoryPruneResult {
  readonly removedIds: readonly AIIdentifier[];
  readonly retainedCount: number;
}

/* ============================================================================
 * CONSTANTES
 * ========================================================================== */

export const MEMORY_SNAPSHOT_VERSION =
  1 as const;

export const DEFAULT_MEMORY_MAXIMUM_ENTRIES =
  1_000;

export const DEFAULT_MEMORY_SEARCH_LIMIT =
  20;

export const DEFAULT_MEMORY_IMPORTANCE =
  0.5;

export const DEFAULT_MEMORY_CONFIDENCE =
  1;

export const DEFAULT_MEMORY_SCOPE:
  AIMemoryScope = "conversation";

export const MEMORY_IMPORTANCE_MINIMUM =
  0;

export const MEMORY_IMPORTANCE_MAXIMUM =
  1;

export const MEMORY_CONFIDENCE_MINIMUM =
  0;

export const MEMORY_CONFIDENCE_MAXIMUM =
  1;

const MEMORY_TYPES:
  readonly AIMemoryType[] = Object.freeze([
    "fact",
    "preference",
    "goal",
    "decision",
    "constraint",
    "summary",
    "observation",
    "custom",
  ]);

const MEMORY_SCOPES:
  readonly AIMemoryScope[] = Object.freeze([
    "message",
    "conversation",
    "session",
    "user",
    "organization",
    "global",
  ]);

/* ============================================================================
 * UTILIDADES INTERNAS
 * ========================================================================== */

function defaultNow(): AIISODateString {
  return new Date().toISOString();
}

function defaultGenerateId(): AIIdentifier {
  const timestamp =
    Date.now().toString(36);

  const randomPart =
    Math.random()
      .toString(36)
      .slice(2, 12);

  return `memory_${timestamp}_${randomPart}`;
}

function normalizeContent(
  content: string,
): string {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function normalizeSearchText(
  value: string,
): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(
  value: string,
): readonly string[] {
  const normalized =
    normalizeSearchText(value);

  if (normalized.length === 0) {
    return Object.freeze([]);
  }

  return Object.freeze(
    normalized
      .split(" ")
      .filter(
        (token) =>
          token.length > 1,
      ),
  );
}

function clamp(
  value: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }

  return Math.min(
    maximum,
    Math.max(minimum, value),
  );
}

function clampImportance(
  value: number,
): number {
  return clamp(
    value,
    MEMORY_IMPORTANCE_MINIMUM,
    MEMORY_IMPORTANCE_MAXIMUM,
  );
}

function clampConfidence(
  value: AIConfidence,
): AIConfidence {
  return clamp(
    value,
    MEMORY_CONFIDENCE_MINIMUM,
    MEMORY_CONFIDENCE_MAXIMUM,
  );
}

function normalizeLimit(
  value: number | undefined,
  fallback: number,
): number {
  if (
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return fallback;
  }

  return Math.max(
    0,
    Math.floor(value),
  );
}

function parseDate(
  value: AIISODateString,
): number {
  const timestamp =
    Date.parse(value);

  return Number.isFinite(timestamp)
    ? timestamp
    : 0;
}

function isMemoryExpiredAt(
  entry: AIMemoryEntry,
  nowTimestamp: number,
): boolean {
  if (entry.expiresAt === undefined) {
    return false;
  }

  const expiresAt =
    parseDate(entry.expiresAt);

  return (
    expiresAt > 0 &&
    expiresAt <= nowTimestamp
  );
}

function freezeMetadata(
  metadata?: AIMetadata,
): AIMetadata {
  if (metadata === undefined) {
    return EMPTY_AI_METADATA;
  }

  return Object.freeze({
    ...metadata,
  });
}

function freezeIdentifiers(
  values?: readonly AIIdentifier[],
): readonly AIIdentifier[] | undefined {
  if (values === undefined) {
    return undefined;
  }

  return Object.freeze([
    ...new Set(
      values.filter(
        (value) =>
          value.trim().length > 0,
      ),
    ),
  ]);
}

function freezeMemoryEntry(
  entry: AIMemoryEntry,
): AIMemoryEntry {
  const sourceMessageIds =
    freezeIdentifiers(
      entry.sourceMessageIds,
    );

  const frozenEntry: AIMemoryEntry = {
    id: entry.id,
    type: entry.type,
    scope: entry.scope,
    content:
      normalizeContent(entry.content),
    importance:
      clampImportance(
        entry.importance,
      ),
    confidence:
      clampConfidence(
        entry.confidence,
      ),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    ...(entry.expiresAt !== undefined
      ? {
          expiresAt:
            entry.expiresAt,
        }
      : {}),
    ...(sourceMessageIds !== undefined
      ? {
          sourceMessageIds,
        }
      : {}),
    ...(entry.metadata !== undefined
      ? {
          metadata:
            freezeMetadata(
              entry.metadata,
            ),
        }
      : {}),
  };

  return Object.freeze(frozenEntry);
}

function freezeMemoryEntries(
  entries: readonly AIMemoryEntry[],
): readonly AIMemoryEntry[] {
  return Object.freeze(
    entries.map(
      freezeMemoryEntry,
    ),
  );
}

function validateMemoryEntry(
  entry: AIMemoryEntry,
): void {
  if (entry.id.trim().length === 0) {
    throw new Error(
      "El identificador del recuerdo no puede estar vacío.",
    );
  }

  if (
    normalizeContent(
      entry.content,
    ).length === 0
  ) {
    throw new Error(
      "El contenido del recuerdo no puede estar vacío.",
    );
  }

  if (
    !MEMORY_TYPES.includes(
      entry.type,
    )
  ) {
    throw new Error(
      `Tipo de recuerdo inválido: "${entry.type}".`,
    );
  }

  if (
    !MEMORY_SCOPES.includes(
      entry.scope,
    )
  ) {
    throw new Error(
      `Alcance de memoria inválido: "${entry.scope}".`,
    );
  }

  if (
    !Number.isFinite(
      entry.importance,
    )
  ) {
    throw new Error(
      "La importancia del recuerdo debe ser un número finito.",
    );
  }

  if (
    !Number.isFinite(
      entry.confidence,
    )
  ) {
    throw new Error(
      "La confianza del recuerdo debe ser un número finito.",
    );
  }
}

function createEmptyTypeStatistics():
  Record<AIMemoryType, number> {
  return {
    fact: 0,
    preference: 0,
    goal: 0,
    decision: 0,
    constraint: 0,
    summary: 0,
    observation: 0,
    custom: 0,
  };
}

function createEmptyScopeStatistics():
  Record<AIMemoryScope, number> {
  return {
    message: 0,
    conversation: 0,
    session: 0,
    user: 0,
    organization: 0,
    global: 0,
  };
}

function calculateTextScore(
  content: string,
  queryText: string,
): {
  readonly score: number;
  readonly reasons: readonly string[];
} {
  const normalizedContent =
    normalizeSearchText(content);

  const normalizedQuery =
    normalizeSearchText(queryText);

  if (
    normalizedQuery.length === 0 ||
    normalizedContent.length === 0
  ) {
    return {
      score: 0,
      reasons: Object.freeze([]),
    };
  }

  if (
    normalizedContent ===
    normalizedQuery
  ) {
    return {
      score: 1,
      reasons: Object.freeze([
        "Coincidencia textual exacta.",
      ]),
    };
  }

  const queryTokens =
    tokenize(normalizedQuery);

  if (queryTokens.length === 0) {
    return {
      score: 0,
      reasons: Object.freeze([]),
    };
  }

  let matchedTokens = 0;

  for (const token of queryTokens) {
    if (
      normalizedContent.includes(
        token,
      )
    ) {
      matchedTokens += 1;
    }
  }

  const tokenCoverage =
    matchedTokens /
    queryTokens.length;

  const containsFullQuery =
    normalizedContent.includes(
      normalizedQuery,
    );

  const score = clamp(
    tokenCoverage * 0.8 +
      (containsFullQuery ? 0.2 : 0),
    0,
    1,
  );

  const reasons: string[] = [];

  if (containsFullQuery) {
    reasons.push(
      "El contenido contiene la consulta completa.",
    );
  }

  if (matchedTokens > 0) {
    reasons.push(
      `${matchedTokens} de ${queryTokens.length} términos coincidentes.`,
    );
  }

  return {
    score,
    reasons:
      Object.freeze(reasons),
  };
}

function calculateMemoryScore(
  entry: AIMemoryEntry,
  query: AIMemoryQuery,
  nowTimestamp: number,
): {
  readonly score: number;
  readonly reasons: readonly string[];
} {
  const reasons: string[] = [];

  let textScore = 1;

  if (
    query.text !== undefined &&
    query.text.trim().length > 0
  ) {
    const textResult =
      calculateTextScore(
        entry.content,
        query.text,
      );

    textScore =
      textResult.score;

    reasons.push(
      ...textResult.reasons,
    );
  }

  const importanceScore =
    clampImportance(
      entry.importance,
    );

  const confidenceScore =
    clampConfidence(
      entry.confidence,
    );

  const createdTimestamp =
    parseDate(entry.createdAt);

  const ageMilliseconds =
    Math.max(
      0,
      nowTimestamp -
        createdTimestamp,
    );

  const ageDays =
    ageMilliseconds /
    86_400_000;

  const recencyScore =
    1 / (1 + ageDays / 30);

  const finalScore =
    query.text !== undefined &&
    query.text.trim().length > 0
      ? (
          textScore * 0.65 +
          importanceScore * 0.15 +
          confidenceScore * 0.15 +
          recencyScore * 0.05
        )
      : (
          importanceScore * 0.4 +
          confidenceScore * 0.35 +
          recencyScore * 0.25
        );

  if (importanceScore >= 0.8) {
    reasons.push(
      "Recuerdo de alta importancia.",
    );
  }

  if (confidenceScore >= 0.8) {
    reasons.push(
      "Recuerdo de alta confianza.",
    );
  }

  return {
    score:
      clamp(
        finalScore,
        0,
        1,
      ),
    reasons:
      Object.freeze(reasons),
  };
}

/* ============================================================================
 * FACTORÍAS DE RECUERDOS
 * ========================================================================== */

export function createMemoryEntry(
  input: CreateMemoryEntryInput,
  options: {
    readonly generateId?: () => AIIdentifier;
    readonly now?: () => AIISODateString;
  } = {},
): AIMemoryEntry {
  const generateId =
    options.generateId ??
    defaultGenerateId;

  const now =
    options.now ??
    defaultNow;

  const content =
    normalizeContent(
      input.content,
    );

  if (content.length === 0) {
    throw new Error(
      "No se puede crear un recuerdo sin contenido.",
    );
  }

  const timestamp =
    input.createdAt ??
    now();

  const sourceMessageIds =
    freezeIdentifiers(
      input.sourceMessageIds,
    );

  const entry: AIMemoryEntry = {
    id:
      input.id ??
      generateId(),
    type: input.type,
    scope: input.scope,
    content,
    importance:
      clampImportance(
        input.importance ??
          DEFAULT_MEMORY_IMPORTANCE,
      ),
    confidence:
      clampConfidence(
        input.confidence ??
          DEFAULT_MEMORY_CONFIDENCE,
      ),
    createdAt: timestamp,
    updatedAt:
      input.updatedAt ??
      timestamp,
    ...(input.expiresAt !== undefined
      ? {
          expiresAt:
            input.expiresAt,
        }
      : {}),
    ...(sourceMessageIds !== undefined
      ? {
          sourceMessageIds,
        }
      : {}),
    ...(input.metadata !== undefined
      ? {
          metadata:
            freezeMetadata(
              input.metadata,
            ),
        }
      : {}),
  };

  validateMemoryEntry(entry);

  return freezeMemoryEntry(entry);
}

export function updateMemoryEntry(
  entry: AIMemoryEntry,
  updates: UpdateMemoryEntryInput,
  now: () => AIISODateString =
    defaultNow,
): AIMemoryEntry {
  const content =
    updates.content !== undefined
      ? normalizeContent(
          updates.content,
        )
      : entry.content;

  if (content.length === 0) {
    throw new Error(
      "El contenido actualizado del recuerdo no puede estar vacío.",
    );
  }

  const sourceMessageIds =
    updates.sourceMessageIds !== undefined
      ? freezeIdentifiers(
          updates.sourceMessageIds,
        )
      : entry.sourceMessageIds;

  const updatedEntry: AIMemoryEntry = {
    id: entry.id,
    type:
      updates.type ??
      entry.type,
    scope:
      updates.scope ??
      entry.scope,
    content,
    importance:
      clampImportance(
        updates.importance ??
          entry.importance,
      ),
    confidence:
      clampConfidence(
        updates.confidence ??
          entry.confidence,
      ),
    createdAt: entry.createdAt,
    updatedAt: now(),
    ...(updates.expiresAt === null
      ? {}
      : updates.expiresAt !== undefined
        ? {
            expiresAt:
              updates.expiresAt,
          }
        : entry.expiresAt !== undefined
          ? {
              expiresAt:
                entry.expiresAt,
            }
          : {}),
    ...(sourceMessageIds !== undefined
      ? {
          sourceMessageIds,
        }
      : {}),
    ...(updates.metadata !== undefined
      ? {
          metadata:
            freezeMetadata(
              updates.metadata,
            ),
        }
      : entry.metadata !== undefined
        ? {
            metadata:
              freezeMetadata(
                entry.metadata,
              ),
          }
        : {}),
  };

  validateMemoryEntry(
    updatedEntry,
  );

  return freezeMemoryEntry(
    updatedEntry,
  );
}

export function isMemoryExpired(
  entry: AIMemoryEntry,
  now: AIISODateString =
    defaultNow(),
): boolean {
  return isMemoryExpiredAt(
    entry,
    parseDate(now),
  );
}

/* ============================================================================
 * ALMACÉN DE MEMORIA
 * ========================================================================== */

export class InMemoryMemoryStore
  implements AIMemoryStore
{
  private readonly entries =
    new Map<
      AIIdentifier,
      AIMemoryEntry
    >();

  private readonly maximumEntries:
    number;

  private readonly overwriteExisting:
    boolean;

  private readonly removeExpiredAutomatically:
    boolean;

  private readonly now:
    () => AIISODateString;

  public constructor(
    config: MemoryStoreConfig = {},
  ) {
    this.maximumEntries =
      normalizeLimit(
        config.maximumEntries,
        DEFAULT_MEMORY_MAXIMUM_ENTRIES,
      );

    this.overwriteExisting =
      config.overwriteExisting ??
      true;

    this.removeExpiredAutomatically =
      config.removeExpiredAutomatically ??
      true;

    this.now =
      config.now ??
      defaultNow;

    for (
      const entry of
      config.initialEntries ?? []
    ) {
      validateMemoryEntry(entry);

      this.entries.set(
        entry.id,
        freezeMemoryEntry(entry),
      );
    }

    this.enforceMaximumEntries();
  }

  public async get(
    id: AIIdentifier,
  ): Promise<AIMemoryEntry | null> {
    this.removeExpiredIfEnabled();

    return (
      this.entries.get(id) ??
      null
    );
  }

  public async list():
    Promise<readonly AIMemoryEntry[]> {
    this.removeExpiredIfEnabled();

    return freezeMemoryEntries(
      this.getSortedEntries(),
    );
  }

  public async search(
    query: AIMemoryQuery,
  ): Promise<
    readonly AIMemorySearchResult[]
  > {
    this.removeExpiredIfEnabled();

    const nowTimestamp =
      parseDate(this.now());

    const includeExpired =
      query.includeExpired ??
      false;

    const minimumImportance =
      clampImportance(
        query.minimumImportance ??
          MEMORY_IMPORTANCE_MINIMUM,
      );

    const minimumConfidence =
      clampConfidence(
        query.minimumConfidence ??
          MEMORY_CONFIDENCE_MINIMUM,
      );

    const limit =
      normalizeLimit(
        query.limit,
        DEFAULT_MEMORY_SEARCH_LIMIT,
      );

    if (limit === 0) {
      return Object.freeze([]);
    }

    const results:
      AIMemorySearchResult[] = [];

    for (
      const entry of
      this.entries.values()
    ) {
      const expired =
        isMemoryExpiredAt(
          entry,
          nowTimestamp,
        );

      if (
        expired &&
        !includeExpired
      ) {
        continue;
      }

      if (
        query.types !== undefined &&
        !query.types.includes(
          entry.type,
        )
      ) {
        continue;
      }

      if (
        query.scopes !== undefined &&
        !query.scopes.includes(
          entry.scope,
        )
      ) {
        continue;
      }

      if (
        entry.importance <
        minimumImportance
      ) {
        continue;
      }

      if (
        entry.confidence <
        minimumConfidence
      ) {
        continue;
      }

      const scoreResult =
        calculateMemoryScore(
          entry,
          query,
          nowTimestamp,
        );

      if (
        query.text !== undefined &&
        query.text.trim().length > 0 &&
        scoreResult.score <= 0
      ) {
        continue;
      }

      results.push(
        Object.freeze({
          entry,
          score:
            scoreResult.score,
          ...(scoreResult.reasons.length >
          0
            ? {
                reasons:
                  scoreResult.reasons,
              }
            : {}),
        }),
      );
    }

    results.sort(
      (
        left,
        right,
      ) => {
        if (
          right.score !==
          left.score
        ) {
          return (
            right.score -
            left.score
          );
        }

        if (
          right.entry.importance !==
          left.entry.importance
        ) {
          return (
            right.entry.importance -
            left.entry.importance
          );
        }

        return (
          parseDate(
            right.entry.updatedAt,
          ) -
          parseDate(
            left.entry.updatedAt,
          )
        );
      },
    );

    return Object.freeze(
      results.slice(0, limit),
    );
  }

  public async save(
    entry: AIMemoryEntry,
  ): Promise<void> {
    validateMemoryEntry(entry);

    if (
      !this.overwriteExisting &&
      this.entries.has(entry.id)
    ) {
      throw new Error(
        `Ya existe un recuerdo con el identificador "${entry.id}".`,
      );
    }

    this.entries.set(
      entry.id,
      freezeMemoryEntry(entry),
    );

    this.removeExpiredIfEnabled();
    this.enforceMaximumEntries();
  }

  public async saveMany(
    entries: readonly AIMemoryEntry[],
  ): Promise<void> {
    const validatedEntries =
      entries.map(
        (entry) => {
          validateMemoryEntry(entry);
          return freezeMemoryEntry(entry);
        },
      );

    if (!this.overwriteExisting) {
      const duplicate =
        validatedEntries.find(
          (entry) =>
            this.entries.has(
              entry.id,
            ),
        );

      if (duplicate !== undefined) {
        throw new Error(
          `Ya existe un recuerdo con el identificador "${duplicate.id}".`,
        );
      }
    }

    for (
      const entry of
      validatedEntries
    ) {
      this.entries.set(
        entry.id,
        entry,
      );
    }

    this.removeExpiredIfEnabled();
    this.enforceMaximumEntries();
  }

  public async remove(
    id: AIIdentifier,
  ): Promise<boolean> {
    return this.entries.delete(id);
  }

  public async clear(
    scope?: AIMemoryScope,
  ): Promise<void> {
    if (scope === undefined) {
      this.entries.clear();
      return;
    }

    for (
      const [
        id,
        entry,
      ] of this.entries
    ) {
      if (
        entry.scope === scope
      ) {
        this.entries.delete(id);
      }
    }
  }

  public async exportSnapshot():
    Promise<AIMemorySnapshot> {
    this.removeExpiredIfEnabled();

    const timestamp =
      this.now();

    return Object.freeze({
      version:
        MEMORY_SNAPSHOT_VERSION,
      entries:
        freezeMemoryEntries(
          this.getSortedEntries(),
        ),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  public async importSnapshot(
    snapshot: AIMemorySnapshot,
  ): Promise<void> {
    if (
      snapshot.version !==
      MEMORY_SNAPSHOT_VERSION
    ) {
      throw new Error(
        `Versión de snapshot de memoria incompatible: ${snapshot.version}.`,
      );
    }

    const importedEntries =
      snapshot.entries.map(
        (entry) => {
          validateMemoryEntry(entry);
          return freezeMemoryEntry(entry);
        },
      );

    this.entries.clear();

    for (
      const entry of
      importedEntries
    ) {
      this.entries.set(
        entry.id,
        entry,
      );
    }

    this.removeExpiredIfEnabled();
    this.enforceMaximumEntries();
  }

  public async update(
    id: AIIdentifier,
    updates: UpdateMemoryEntryInput,
  ): Promise<AIMemoryEntry | null> {
    const current =
      this.entries.get(id);

    if (current === undefined) {
      return null;
    }

    const updated =
      updateMemoryEntry(
        current,
        updates,
        this.now,
      );

    this.entries.set(
      updated.id,
      updated,
    );

    return updated;
  }

  public async removeExpired():
    Promise<
      readonly AIIdentifier[]
    > {
    const nowTimestamp =
      parseDate(this.now());

    const removedIds:
      AIIdentifier[] = [];

    for (
      const [
        id,
        entry,
      ] of this.entries
    ) {
      if (
        isMemoryExpiredAt(
          entry,
          nowTimestamp,
        )
      ) {
        this.entries.delete(id);
        removedIds.push(id);
      }
    }

    return Object.freeze(
      removedIds,
    );
  }

  public async prune(
    options: MemoryPruneOptions = {},
  ): Promise<MemoryPruneResult> {
    const removedIds:
      AIIdentifier[] = [];

    const removeExpired =
      options.removeExpired ??
      true;

    const nowTimestamp =
      parseDate(this.now());

    const minimumImportance =
      options.minimumImportance !==
      undefined
        ? clampImportance(
            options.minimumImportance,
          )
        : undefined;

    const minimumConfidence =
      options.minimumConfidence !==
      undefined
        ? clampConfidence(
            options.minimumConfidence,
          )
        : undefined;

    for (
      const [
        id,
        entry,
      ] of this.entries
    ) {
      const shouldRemoveExpired =
        removeExpired &&
        isMemoryExpiredAt(
          entry,
          nowTimestamp,
        );

      const shouldRemoveImportance =
        minimumImportance !==
          undefined &&
        entry.importance <
          minimumImportance;

      const shouldRemoveConfidence =
        minimumConfidence !==
          undefined &&
        entry.confidence <
          minimumConfidence;

      if (
        shouldRemoveExpired ||
        shouldRemoveImportance ||
        shouldRemoveConfidence
      ) {
        this.entries.delete(id);
        removedIds.push(id);
      }
    }

    const maximumEntries =
      normalizeLimit(
        options.maximumEntries,
        this.maximumEntries,
      );

    if (
      this.entries.size >
      maximumEntries
    ) {
      const orderedForRemoval =
        this.getEntriesForRemoval();

      const amountToRemove =
        this.entries.size -
        maximumEntries;

      for (
        const entry of
        orderedForRemoval.slice(
          0,
          amountToRemove,
        )
      ) {
        if (
          this.entries.delete(
            entry.id,
          )
        ) {
          removedIds.push(
            entry.id,
          );
        }
      }
    }

    return Object.freeze({
      removedIds:
        Object.freeze(
          removedIds,
        ),
      retainedCount:
        this.entries.size,
    });
  }

  public async getStatistics():
    Promise<MemoryStatistics> {
    const nowTimestamp =
      parseDate(this.now());

    const byType =
      createEmptyTypeStatistics();

    const byScope =
      createEmptyScopeStatistics();

    let expired = 0;
    let importanceTotal = 0;
    let confidenceTotal = 0;

    for (
      const entry of
      this.entries.values()
    ) {
      byType[entry.type] += 1;
      byScope[entry.scope] += 1;

      importanceTotal +=
        entry.importance;

      confidenceTotal +=
        entry.confidence;

      if (
        isMemoryExpiredAt(
          entry,
          nowTimestamp,
        )
      ) {
        expired += 1;
      }
    }

    const total =
      this.entries.size;

    const statistics:
      MemoryStatistics = {
      total,
      active:
        total - expired,
      expired,
      byType:
        Object.freeze({
          ...byType,
        }),
      byScope:
        Object.freeze({
          ...byScope,
        }),
      averageImportance:
        total > 0
          ? importanceTotal /
            total
          : 0,
      averageConfidence:
        total > 0
          ? confidenceTotal /
            total
          : 0,
    };

    return Object.freeze(
      statistics,
    );
  }

  private removeExpiredIfEnabled():
    void {
    if (
      !this.removeExpiredAutomatically
    ) {
      return;
    }

    const nowTimestamp =
      parseDate(this.now());

    for (
      const [
        id,
        entry,
      ] of this.entries
    ) {
      if (
        isMemoryExpiredAt(
          entry,
          nowTimestamp,
        )
      ) {
        this.entries.delete(id);
      }
    }
  }

  private enforceMaximumEntries():
    void {
    if (
      this.entries.size <=
      this.maximumEntries
    ) {
      return;
    }

    const amountToRemove =
      this.entries.size -
      this.maximumEntries;

    const entriesForRemoval =
      this.getEntriesForRemoval();

    for (
      const entry of
      entriesForRemoval.slice(
        0,
        amountToRemove,
      )
    ) {
      this.entries.delete(
        entry.id,
      );
    }
  }

  private getSortedEntries():
    readonly AIMemoryEntry[] {
    return [
      ...this.entries.values(),
    ].sort(
      (
        left,
        right,
      ) => {
        const updatedDifference =
          parseDate(
            right.updatedAt,
          ) -
          parseDate(
            left.updatedAt,
          );

        if (
          updatedDifference !== 0
        ) {
          return updatedDifference;
        }

        return left.id.localeCompare(
          right.id,
        );
      },
    );
  }

  private getEntriesForRemoval():
    readonly AIMemoryEntry[] {
    const nowTimestamp =
      parseDate(this.now());

    return [
      ...this.entries.values(),
    ].sort(
      (
        left,
        right,
      ) => {
        const leftExpired =
          isMemoryExpiredAt(
            left,
            nowTimestamp,
          );

        const rightExpired =
          isMemoryExpiredAt(
            right,
            nowTimestamp,
          );

        if (
          leftExpired !==
          rightExpired
        ) {
          return leftExpired
            ? -1
            : 1;
        }

        if (
          left.importance !==
          right.importance
        ) {
          return (
            left.importance -
            right.importance
          );
        }

        if (
          left.confidence !==
          right.confidence
        ) {
          return (
            left.confidence -
            right.confidence
          );
        }

        return (
          parseDate(
            left.updatedAt,
          ) -
          parseDate(
            right.updatedAt,
          )
        );
      },
    );
  }
}

/* ============================================================================
 * ADMINISTRADOR DE MEMORIA
 * ========================================================================== */

export class MemoryManager {
  private readonly store:
    AIMemoryStore;

  private readonly defaultScope:
    AIMemoryScope;

  private readonly defaultImportance:
    number;

  private readonly defaultConfidence:
    AIConfidence;

  private readonly maximumSearchResults:
    number;

  private readonly generateId:
    () => AIIdentifier;

  private readonly now:
    () => AIISODateString;

  public constructor(
    config: MemoryManagerConfig = {},
  ) {
    this.generateId =
      config.generateId ??
      defaultGenerateId;

    this.now =
      config.now ??
      defaultNow;

    this.store =
      config.store ??
      new InMemoryMemoryStore({
        generateId:
          this.generateId,
        now:
          this.now,
      });

    this.defaultScope =
      config.defaultScope ??
      DEFAULT_MEMORY_SCOPE;

    this.defaultImportance =
      clampImportance(
        config.defaultImportance ??
          DEFAULT_MEMORY_IMPORTANCE,
      );

    this.defaultConfidence =
      clampConfidence(
        config.defaultConfidence ??
          DEFAULT_MEMORY_CONFIDENCE,
      );

    this.maximumSearchResults =
      normalizeLimit(
        config.maximumSearchResults,
        DEFAULT_MEMORY_SEARCH_LIMIT,
      );
  }

  public getStore(): AIMemoryStore {
    return this.store;
  }

  public async remember(
    input: RememberInput,
  ): Promise<AIMemoryEntry> {
    const entry =
      createMemoryEntry(
        {
          ...(input.id !== undefined
            ? {
                id: input.id,
              }
            : {}),
          type: input.type,
          scope:
            input.scope ??
            this.defaultScope,
          content: input.content,
          importance:
            input.importance ??
            this.defaultImportance,
          confidence:
            input.confidence ??
            this.defaultConfidence,
          ...(input.expiresAt !==
          undefined
            ? {
                expiresAt:
                  input.expiresAt,
              }
            : {}),
          ...(input.sourceMessageIds !==
          undefined
            ? {
                sourceMessageIds:
                  input.sourceMessageIds,
              }
            : {}),
          ...(input.metadata !== undefined
            ? {
                metadata:
                  input.metadata,
              }
            : {}),
        },
        {
          generateId:
            this.generateId,
          now:
            this.now,
        },
      );

    await this.store.save(entry);

    return entry;
  }

  public async rememberMany(
    inputs: readonly RememberInput[],
  ): Promise<RememberManyResult> {
    const saved:
      AIMemoryEntry[] = [];

    const rejected:
      MemoryRejectedEntry[] = [];

    for (
      let index = 0;
      index < inputs.length;
      index += 1
    ) {
      const input =
        inputs[index];

      if (input === undefined) {
        continue;
      }

      try {
        const entry =
          createMemoryEntry(
            {
              ...(input.id !== undefined
                ? {
                    id:
                      input.id,
                  }
                : {}),
              type:
                input.type,
              scope:
                input.scope ??
                this.defaultScope,
              content:
                input.content,
              importance:
                input.importance ??
                this.defaultImportance,
              confidence:
                input.confidence ??
                this.defaultConfidence,
              ...(input.expiresAt !==
              undefined
                ? {
                    expiresAt:
                      input.expiresAt,
                  }
                : {}),
              ...(input.sourceMessageIds !==
              undefined
                ? {
                    sourceMessageIds:
                      input.sourceMessageIds,
                  }
                : {}),
              ...(input.metadata !==
              undefined
                ? {
                    metadata:
                      input.metadata,
                  }
                : {}),
            },
            {
              generateId:
                this.generateId,
              now:
                this.now,
            },
          );

        saved.push(entry);
      } catch (error) {
        rejected.push(
          Object.freeze({
            index,
            input,
            reason:
              error instanceof Error
                ? error.message
                : "No se pudo crear el recuerdo.",
          }),
        );
      }
    }

    if (saved.length > 0) {
      await this.store.saveMany(
        saved,
      );
    }

    return Object.freeze({
      saved:
        freezeMemoryEntries(
          saved,
        ),
      rejected:
        Object.freeze([
          ...rejected,
        ]),
    });
  }

  public async recall(
    query: AIMemoryQuery,
  ): Promise<
    readonly AIMemorySearchResult[]
  > {
    return this.store.search({
      ...query,
      limit:
        query.limit ??
        this.maximumSearchResults,
    });
  }

  public async recallText(
    text: string,
    options: Omit<
      AIMemoryQuery,
      "text"
    > = {},
  ): Promise<
    readonly AIMemorySearchResult[]
  > {
    return this.recall({
      ...options,
      text,
    });
  }

  public async get(
    id: AIIdentifier,
  ): Promise<AIMemoryEntry | null> {
    return this.store.get(id);
  }

  public async list():
    Promise<readonly AIMemoryEntry[]> {
    return this.store.list();
  }

  public async forget(
    id: AIIdentifier,
  ): Promise<boolean> {
    return this.store.remove(id);
  }

  public async clear(
    scope?: AIMemoryScope,
  ): Promise<void> {
    await this.store.clear(scope);
  }

  public async exportSnapshot():
    Promise<AIMemorySnapshot> {
    return this.store.exportSnapshot();
  }

  public async importSnapshot(
    snapshot: AIMemorySnapshot,
  ): Promise<void> {
    await this.store.importSnapshot(
      snapshot,
    );
  }

  public async has(
    id: AIIdentifier,
  ): Promise<boolean> {
    return (
      await this.store.get(id)
    ) !== null;
  }

  public async count(): Promise<number> {
    return (
      await this.store.list()
    ).length;
  }
}

/* ============================================================================
 * FACTORÍAS PÚBLICAS
 * ========================================================================== */

export function createInMemoryMemoryStore(
  config: MemoryStoreConfig = {},
): InMemoryMemoryStore {
  return new InMemoryMemoryStore(
    config,
  );
}

export function createMemoryManager(
  config: MemoryManagerConfig = {},
): MemoryManager {
  return new MemoryManager(config);
}