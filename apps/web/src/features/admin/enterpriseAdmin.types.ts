export type EnterpriseRole="guest"|"user"|"operator"|"assistant-admin"|"tenant-admin"|"platform-admin";
export type AdminResource="tenants"|"users"|"invitations"|"roles"|"permissions"|"assistants"|"knowledge"|"documents"|"ingestion"|"conversations"|"tools"|"providers"|"usage"|"costs"|"metrics"|"audit"|"security"|"settings"|"status";
export type AdminValue=string|number|boolean|readonly string[]|null;
export type AdminRecord=Readonly<Record<string,AdminValue>>;
export interface EnterprisePrincipal { readonly actorId:string; readonly tenantId:string; readonly roles:readonly EnterpriseRole[]; readonly permissions:readonly string[]; readonly assistantIds?:readonly string[]; }
export interface AdminQuery { readonly search?:string; readonly tenantId?:string; readonly page:number; readonly pageSize:number; readonly sort?:string; readonly direction?:"asc"|"desc"; }
export interface AdminPage { readonly items:readonly AdminRecord[]; readonly page:number; readonly pageSize:number; readonly total:number; readonly hasNext:boolean; readonly hasPrevious:boolean; }
export interface EnterpriseSummary { readonly tenants:number;readonly users:number;readonly assistants:number;readonly documents:number;readonly conversations:number;readonly toolCalls:number;readonly errors:number;readonly tokens:number;readonly estimatedCost:number;readonly developmentData:true; }
export interface EnterpriseAdminService {
 readonly principal:EnterprisePrincipal;
 list(resource:AdminResource,query:AdminQuery,signal?:AbortSignal):Promise<AdminPage>;
 create(resource:AdminResource,input:AdminRecord):Promise<AdminRecord>;
 update(resource:AdminResource,id:string,input:AdminRecord):Promise<AdminRecord>;
 archive(resource:AdminResource,id:string):Promise<boolean>;
 summary():Promise<EnterpriseSummary>;
 export(resource:AdminResource,format:"json"|"csv"):Promise<string>;
 has(permission:string):boolean;
}
export const RESOURCE_LABELS:Readonly<Record<AdminResource,string>>=Object.freeze({tenants:"Empresas",users:"Usuarios",invitations:"Invitaciones",roles:"Roles",permissions:"Permisos",assistants:"Asistentes",knowledge:"Conocimiento",documents:"Documentos",ingestion:"Ingestas",conversations:"Conversaciones",tools:"Herramientas",providers:"Proveedores",usage:"Uso",costs:"Costos estimados",metrics:"Métricas",audit:"Auditoría",security:"Seguridad",settings:"Configuración",status:"Estado del sistema"});
