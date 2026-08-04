import type { ApiPermission, ApiPrincipal } from "../contracts.js";

export type TenantStatus = "trial" | "active" | "suspended" | "archived" | "disabled";
export type TenantPlan = "free" | "starter" | "business" | "enterprise" | "custom";
export type AdminResource = "tenants" | "users" | "invitations" | "roles" | "permissions" | "assistants" | "knowledge" | "documents" | "ingestion" | "conversations" | "tools" | "providers" | "usage" | "costs" | "metrics" | "audit" | "security" | "settings" | "status";
export type AdminRecord = Readonly<Record<string, string | number | boolean | readonly string[] | null>>;
export interface TenantRecord extends AdminRecord { readonly id: string; readonly name: string; readonly slug: string; readonly status: TenantStatus; readonly plan: TenantPlan; readonly createdAt: string; }
export interface AdminAuditEvent { readonly auditId: string; readonly timestamp: string; readonly tenantId: string; readonly actorId: string; readonly resourceType: string; readonly resourceId: string; readonly action: string; readonly status: "success" | "denied" | "failed"; readonly requestId: string; readonly correlationId: string; readonly metadata: Readonly<Record<string, string | number | boolean | null>>; }
export interface AdminPage<T> { readonly items: readonly T[]; readonly page: number; readonly pageSize: number; readonly total: number; readonly hasNext: boolean; readonly hasPrevious: boolean; readonly cursor?: string; }
export interface AdminQuery { readonly tenantId?: string; readonly search?: string; readonly page: number; readonly pageSize: number; readonly sort?: string; readonly direction?: "asc" | "desc"; }
export interface AdminMutationContext { readonly principal: ApiPrincipal; readonly requestId: string; readonly correlationId: string; }
export interface EnterpriseAdminService {
  list(resource: AdminResource, query: AdminQuery, principal: ApiPrincipal): Promise<AdminPage<AdminRecord>>;
  get(resource: AdminResource, id: string, principal: ApiPrincipal): Promise<AdminRecord | undefined>;
  create(resource: AdminResource, input: unknown, context: AdminMutationContext): Promise<AdminRecord>;
  update(resource: AdminResource, id: string, input: unknown, context: AdminMutationContext): Promise<AdminRecord>;
  remove(resource: AdminResource, id: string, context: AdminMutationContext): Promise<boolean>;
  permissionFor(resource: AdminResource, mutation: boolean): ApiPermission;
}
