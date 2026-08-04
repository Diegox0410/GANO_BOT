import type { AdminRecord, AdminResource } from "./contracts.js";

const key = (tenantId: string, id: string): string => JSON.stringify([tenantId, id]);
/** Almacén volátil, determinista y exclusivo para desarrollo y pruebas. */
export class InMemoryEnterpriseRepository {
  private readonly resources = new Map<AdminResource, Map<string, AdminRecord>>();
  public constructor(fixtures: Readonly<Partial<Record<AdminResource, readonly AdminRecord[]>>> = {}) {
    for (const [name, records] of Object.entries(fixtures)) {
      const resource = name as AdminResource;
      for (const record of records ?? []) this.save(resource, record);
    }
  }
  public list(resource: AdminResource): readonly AdminRecord[] { return Object.freeze([...(this.resources.get(resource)?.values() ?? [])]); }
  public get(resource: AdminResource, tenantId: string, id: string): AdminRecord | undefined { return this.resources.get(resource)?.get(key(tenantId, id)); }
  public save(resource: AdminResource, record: AdminRecord): AdminRecord {
    const tenantId = typeof record.tenantId === "string" ? record.tenantId : "platform";
    const id = String(record.id);
    const values = this.resources.get(resource) ?? new Map<string, AdminRecord>();
    const frozen = Object.freeze({ ...record });
    values.set(key(tenantId, id), frozen); this.resources.set(resource, values); return frozen;
  }
  public archive(resource: AdminResource, tenantId: string, id: string): boolean {
    const old = this.get(resource, tenantId, id); if (old === undefined) return false;
    this.save(resource, Object.freeze({ ...old, status: "archived" })); return true;
  }
}
