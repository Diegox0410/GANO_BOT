import { MemoryError, validateMemoryScope } from "./errors.js";
import type {
  MemoryQuery,
  MemoryRecord,
  MemoryScope,
  MemoryStore,
} from "./types.js";
function sameScope(record: MemoryRecord, scope: MemoryScope): boolean {
  return (
    record.scope.tenantId === scope.tenantId &&
    record.scope.assistantId === scope.assistantId &&
    record.scope.userId === scope.userId &&
    record.scope.conversationId === scope.conversationId
  );
}
function freezeRecord(record: MemoryRecord): MemoryRecord {
  return Object.freeze({
    ...record,
    scope: Object.freeze({ ...record.scope }),
    tags: Object.freeze([...record.tags]),
    ...(record.metadata !== undefined
      ? { metadata: Object.freeze({ ...record.metadata }) }
      : {}),
  });
}
/** Store volátil, exclusivamente para desarrollo y pruebas. */
export class InMemoryMemoryEngineStore implements MemoryStore {
  private readonly records = new Map<string, MemoryRecord>();
  public constructor(
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly maximumRecords = 10_000,
  ) {}
  public async save(record: MemoryRecord): Promise<MemoryRecord> {
    validateMemoryScope(record.scope);
    if (record.content.trim().length === 0)
      throw new MemoryError(
        "STORE_FAILED",
        "No se puede guardar memoria vacía.",
      );
    const existing = this.records.get(record.id);
    if (existing !== undefined && !sameScope(existing, record.scope))
      throw new MemoryError(
        "ISOLATION_VIOLATION",
        "El ID de memoria pertenece a otro scope.",
      );
    const duplicate = [...this.records.values()].find(
      (value) =>
        sameScope(value, record.scope) &&
        value.category === record.category &&
        value.content.toLowerCase() === record.content.toLowerCase() &&
        value.status === "active",
    );
    if (duplicate !== undefined) return duplicate;
    const frozen = freezeRecord(record);
    this.records.set(record.id, frozen);
    if (this.records.size > this.maximumRecords) {
      await this.cleanup(this.now());
      const oldest = [...this.records.values()].sort((left, right) =>
        left.updatedAt.localeCompare(right.updatedAt),
      )[0];
      if (oldest !== undefined) this.records.delete(oldest.id);
    }
    return frozen;
  }
  public async find(query: MemoryQuery): Promise<readonly MemoryRecord[]> {
    validateMemoryScope(query.scope);
    if (query.signal?.aborted === true)
      throw new MemoryError(
        "REQUEST_CANCELLED",
        "La lectura de memoria fue cancelada.",
      );
    const now = Date.parse(this.now());
    const terms =
      query.text
        ?.toLowerCase()
        .split(/\s+/)
        .filter((value) => value.length > 1) ?? [];
    return Object.freeze(
      [...this.records.values()]
        .filter(
          (record) =>
            sameScope(record, query.scope) &&
            (query.categories === undefined ||
              query.categories.includes(record.category)) &&
            (query.includeExpired === true ||
              (record.status === "active" &&
                (record.expiresAt === undefined ||
                  Date.parse(record.expiresAt) > now))) &&
            (terms.length === 0 ||
              terms.some((term) =>
                record.content.toLowerCase().includes(term),
              )),
        )
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .slice(-(query.limit ?? 100)),
    );
  }
  public async get(
    id: string,
    scope: MemoryScope,
  ): Promise<MemoryRecord | undefined> {
    validateMemoryScope(scope);
    const record = this.records.get(id);
    if (record !== undefined && !sameScope(record, scope))
      throw new MemoryError(
        "ISOLATION_VIOLATION",
        "La memoria solicitada pertenece a otro scope.",
      );
    return record;
  }
  public async findByScope(
    scope: Partial<
      Pick<
        MemoryScope,
        "tenantId" | "assistantId" | "userId" | "conversationId"
      >
    >,
  ): Promise<readonly MemoryRecord[]> {
    if (Object.values(scope).every((value) => value === undefined))
      throw new MemoryError(
        "INVALID_SCOPE",
        "La búsqueda requiere al menos un filtro de scope.",
      );
    return Object.freeze(
      [...this.records.values()]
        .filter(
          (record) =>
            (scope.tenantId === undefined ||
              record.scope.tenantId === scope.tenantId) &&
            (scope.assistantId === undefined ||
              record.scope.assistantId === scope.assistantId) &&
            (scope.userId === undefined ||
              record.scope.userId === scope.userId) &&
            (scope.conversationId === undefined ||
              record.scope.conversationId === scope.conversationId),
        )
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }
  public async remove(id: string, scope: MemoryScope): Promise<boolean> {
    await this.get(id, scope);
    return this.records.delete(id);
  }
  public async removeByScope(
    scope: Partial<
      Pick<
        MemoryScope,
        "tenantId" | "assistantId" | "userId" | "conversationId"
      >
    >,
  ): Promise<number> {
    if (Object.values(scope).every((value) => value === undefined))
      throw new MemoryError(
        "INVALID_SCOPE",
        "El borrado requiere al menos un filtro de scope.",
      );
    let count = 0;
    for (const [id, record] of this.records)
      if (
        (scope.tenantId === undefined ||
          record.scope.tenantId === scope.tenantId) &&
        (scope.assistantId === undefined ||
          record.scope.assistantId === scope.assistantId) &&
        (scope.userId === undefined || record.scope.userId === scope.userId) &&
        (scope.conversationId === undefined ||
          record.scope.conversationId === scope.conversationId)
      ) {
        this.records.delete(id);
        count += 1;
      }
    return count;
  }
  public async cleanup(now: string): Promise<number> {
    const timestamp = Date.parse(now);
    let count = 0;
    for (const [id, record] of this.records)
      if (
        record.expiresAt !== undefined &&
        Date.parse(record.expiresAt) <= timestamp
      ) {
        this.records.delete(id);
        count += 1;
      }
    return count;
  }
}
export function createInMemoryMemoryEngineStore(
  now?: () => string,
  maximumRecords?: number,
): MemoryStore {
  return new InMemoryMemoryEngineStore(now, maximumRecords);
}
