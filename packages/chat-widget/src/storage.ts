import type { StorageAdapter, StoredWidgetState } from "./universal.types.js";
function valid(value: unknown): value is StoredWidgetState {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const item = value as Readonly<Record<string, unknown>>;
  return (
    typeof item.savedAt === "string" &&
    typeof item.theme === "string" &&
    typeof item.state === "string" &&
    (item.conversationId === undefined ||
      typeof item.conversationId === "string")
  );
}
/** Adaptador volátil exclusivo para desarrollo y pruebas. */
export class InMemoryStorageAdapter implements StorageAdapter {
  private readonly values = new Map<string, StoredWidgetState>();
  public async load(key: string): Promise<StoredWidgetState | undefined> {
    return this.values.get(key);
  }
  public async save(key: string, value: StoredWidgetState): Promise<void> {
    this.values.set(key, Object.freeze({ ...value }));
  }
  public async remove(key: string): Promise<void> {
    this.values.delete(key);
  }
}
export class LocalStorageAdapter implements StorageAdapter {
  public constructor(
    private readonly storage: Storage = globalThis.localStorage,
    private readonly prefix = "enterprise-assistant",
  ) {}
  private key(value: string): string {
    return `${this.prefix}:${value}`;
  }
  public async load(key: string): Promise<StoredWidgetState | undefined> {
    const raw = this.storage.getItem(this.key(key));
    if (raw === null) return undefined;
    try {
      const value: unknown = JSON.parse(raw);
      return valid(value) ? Object.freeze(value) : undefined;
    } catch {
      return undefined;
    }
  }
  public async save(key: string, value: StoredWidgetState): Promise<void> {
    this.storage.setItem(this.key(key), JSON.stringify(value));
  }
  public async remove(key: string): Promise<void> {
    this.storage.removeItem(this.key(key));
  }
}
