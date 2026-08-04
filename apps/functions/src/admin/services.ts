import { BackendApiError } from "../errors.js";
import type { ApiPermission, ApiPrincipal } from "../contracts.js";
import type { AdminAuditEvent, AdminMutationContext, AdminPage, AdminQuery, AdminRecord, AdminResource, EnterpriseAdminService } from "./contracts.js";
import { InMemoryEnterpriseRepository } from "./repositories.js";

const READ_PERMISSIONS: Readonly<Record<AdminResource, ApiPermission>> = Object.freeze({ tenants:"tenants:read", users:"users:read", invitations:"users:read", roles:"users:read", permissions:"users:read", assistants:"assistants:read", knowledge:"knowledge:read", documents:"knowledge:read", ingestion:"knowledge:read", conversations:"conversations:read", tools:"tools:read", providers:"platform:read", usage:"usage:read", costs:"costs:read", metrics:"metrics:read", audit:"audit:read", security:"security:read", settings:"tenants:read", status:"platform:read" });
const WRITE_PERMISSIONS: Readonly<Record<AdminResource, ApiPermission>> = Object.freeze({ tenants:"tenants:update", users:"users:update", invitations:"users:invite", roles:"users:update", permissions:"platform:admin", assistants:"assistants:update", knowledge:"knowledge:update", documents:"knowledge:update", ingestion:"ingestion:execute", conversations:"conversations:delete", tools:"tools:configure", providers:"platform:write", usage:"platform:write", costs:"platform:write", metrics:"platform:write", audit:"audit:export", security:"security:update", settings:"tenants:update", status:"platform:admin" });
const safeId = (value: unknown): string | undefined => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) ? value : undefined;
const inputRecord = (value: unknown): Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new BackendApiError("BAD_REQUEST", "El recurso administrativo debe ser un objeto.", 400);
  return value as Readonly<Record<string, unknown>>;
};
const sanitize = (value: Readonly<Record<string, unknown>>): AdminRecord => {
  const denied = /password|secret|token|content|embedding|localpath/i;
  const output: Record<string, string | number | boolean | readonly string[] | null> = {};
  for (const [name, item] of Object.entries(value)) {
    if (denied.test(name)) continue;
    if (typeof item === "string") output[name] = item.slice(0, 2048);
    else if (typeof item === "number" && Number.isFinite(item)) output[name] = item;
    else if (typeof item === "boolean" || item === null) output[name] = item;
    else if (Array.isArray(item) && item.every((entry) => typeof entry === "string")) output[name] = Object.freeze(item.map(String));
  }
  return Object.freeze(output);
};
export class InMemoryEnterpriseAdminService implements EnterpriseAdminService {
  private sequence = 0;
  private readonly events: AdminAuditEvent[] = [];
  public constructor(private readonly repository: InMemoryEnterpriseRepository, private readonly now: () => string = () => new Date().toISOString()) {}
  public permissionFor(resource: AdminResource, mutation: boolean): ApiPermission { return mutation ? WRITE_PERMISSIONS[resource] : READ_PERMISSIONS[resource]; }
  private visible(record: AdminRecord, principal: ApiPrincipal): boolean { return principal.roles.includes("platform-admin") || record.tenantId === principal.tenantId || record.tenantId === "platform"; }
  public async list(resource: AdminResource, query: AdminQuery, principal: ApiPrincipal): Promise<AdminPage<AdminRecord>> {
    if (resource === "audit") return this.page(this.events.filter((event) => principal.roles.includes("platform-admin") || event.tenantId === principal.tenantId).map((event) => event as unknown as AdminRecord), query);
    let values = this.repository.list(resource).filter((item) => this.visible(item, principal));
    if (query.tenantId !== undefined) values = values.filter((item) => item.tenantId === query.tenantId);
    if (query.search !== undefined) { const needle = query.search.toLocaleLowerCase(); values = values.filter((item) => JSON.stringify(item).toLocaleLowerCase().includes(needle)); }
    const field = query.sort ?? "id"; values.sort((a,b) => String(a[field] ?? "").localeCompare(String(b[field] ?? "")) * (query.direction === "desc" ? -1 : 1));
    return this.page(values, query);
  }
  private page(values: readonly AdminRecord[], query: AdminQuery): AdminPage<AdminRecord> { const start=(query.page-1)*query.pageSize; return Object.freeze({ items:Object.freeze(values.slice(start,start+query.pageSize)), page:query.page, pageSize:query.pageSize, total:values.length, hasNext:start+query.pageSize<values.length, hasPrevious:query.page>1, ...(start+query.pageSize<values.length?{cursor:String(start+query.pageSize)}:{}) }); }
  public async get(resource: AdminResource, id: string, principal: ApiPrincipal): Promise<AdminRecord | undefined> { return this.repository.list(resource).find((item) => item.id === id && this.visible(item, principal)); }
  public async create(resource: AdminResource, input: unknown, context: AdminMutationContext): Promise<AdminRecord> {
    const data=inputRecord(input); const requestedTenant=safeId(data.tenantId); const platform=context.principal.roles.includes("platform-admin"); const tenantId=resource === "tenants" ? safeId(data.id) ?? `tenant-${++this.sequence}` : requestedTenant ?? context.principal.tenantId;
    if (!platform && tenantId !== context.principal.tenantId) return this.denied(resource,"create",tenantId,context);
    const id=safeId(data.id) ?? `${resource.slice(0,-1)}-${++this.sequence}`; const record=this.repository.save(resource,Object.freeze({ ...sanitize(data), id, tenantId, createdAt:this.now(), updatedAt:this.now() })); this.audit(resource,id,"created","success",tenantId,context); return record;
  }
  public async update(resource: AdminResource, id: string, input: unknown, context: AdminMutationContext): Promise<AdminRecord> {
    const old=await this.get(resource,id,context.principal); if(old===undefined) throw new BackendApiError("NOT_FOUND","No existe el recurso administrativo.",404);
    const data=sanitize(inputRecord(input)); const requested=typeof data.tenantId === "string" ? data.tenantId : String(old.tenantId);
    if (!context.principal.roles.includes("platform-admin") && requested !== old.tenantId) return this.denied(resource,"transfer",String(old.tenantId),context);
    const record=this.repository.save(resource,Object.freeze({ ...old,...data,id,tenantId:requested,updatedAt:this.now() })); this.audit(resource,id,"updated","success",requested,context); return record;
  }
  public async remove(resource: AdminResource,id:string,context:AdminMutationContext):Promise<boolean>{ const old=await this.get(resource,id,context.principal); if(old===undefined)return false; const result=this.repository.archive(resource,String(old.tenantId),id); if(result)this.audit(resource,id,"archived","success",String(old.tenantId),context); return result; }
  private denied(resource:AdminResource,action:string,tenantId:string,context:AdminMutationContext):never{ this.audit(resource,"denied",action,"denied",tenantId,context); throw new BackendApiError("FORBIDDEN","No se permite acceso cruzado entre tenants.",403); }
  private audit(resource:string,id:string,action:string,status:AdminAuditEvent["status"],tenantId:string,context:AdminMutationContext):void{ this.events.push(Object.freeze({auditId:`audit-${++this.sequence}`,timestamp:this.now(),tenantId,actorId:context.principal.actorId,resourceType:resource,resourceId:id,action,status,requestId:context.requestId,correlationId:context.correlationId,metadata:Object.freeze({source:"development"})})); }
}
