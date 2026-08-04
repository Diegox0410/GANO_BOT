import { BackendApiError } from "../errors.js";
import { authorize } from "../security.js";
import type { ApiPrincipal } from "../contracts.js";
import type { AdminQuery, AdminResource, EnterpriseAdminService } from "./contracts.js";

const RESOURCES: readonly AdminResource[] = Object.freeze(["tenants","users","invitations","roles","permissions","assistants","knowledge","documents","ingestion","conversations","tools","providers","usage","costs","metrics","audit","security","settings","status"]);
const validId = (value: string | undefined): string | undefined => value !== undefined && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) ? value : undefined;
const queryFrom = (url: URL): AdminQuery => { const page=Number(url.searchParams.get("page") ?? "1"); const pageSize=Number(url.searchParams.get("pageSize") ?? "20"); if(!Number.isInteger(page)||page<1||!Number.isInteger(pageSize)||pageSize<1||pageSize>100) throw new BackendApiError("BAD_REQUEST","Paginación inválida; page >= 1 y pageSize entre 1 y 100.",400); const direction=url.searchParams.get("direction"); return Object.freeze({page,pageSize,...(validId(url.searchParams.get("tenantId") ?? undefined)!==undefined?{tenantId:String(url.searchParams.get("tenantId"))}:{}),...(url.searchParams.get("search")?.trim()?{search:url.searchParams.get("search")?.trim()}:{}),...(url.searchParams.get("sort")?.trim()?{sort:url.searchParams.get("sort")?.trim()}:{}),...(direction==="asc"||direction==="desc"?{direction}:{})}); };
export interface AdminRouteContext { readonly principal: ApiPrincipal; readonly requestId: string; readonly correlationId: string; readonly readJson: () => Promise<unknown>; readonly success: (data: unknown, status?: number) => Response; }
export async function routeEnterpriseAdmin(request:Request,service:EnterpriseAdminService,context:AdminRouteContext):Promise<Response|undefined>{
  const url=new URL(request.url); const segments=url.pathname.split("/").filter(Boolean); if(segments[0]!=="v1"||segments[1]!=="admin")return undefined;
  const resource=segments[2] as AdminResource|undefined; if(resource===undefined||!RESOURCES.includes(resource))throw new BackendApiError("NOT_FOUND","Recurso administrativo desconocido.",404);
  const id=validId(segments[3]); const mutation=request.method!=="GET"; const permission=service.permissionFor(resource,mutation); const tenantId=context.principal.roles.includes("platform-admin") ? context.principal.tenantId : context.principal.tenantId; authorize(context.principal,permission,tenantId);
  if(request.method==="GET"&&id===undefined)return context.success(await service.list(resource,queryFrom(url),context.principal));
  if(request.method==="GET"&&id!==undefined){const result=await service.get(resource,id,context.principal);if(result===undefined)throw new BackendApiError("NOT_FOUND","No existe el recurso administrativo.",404);return context.success(result);}
  const mutationContext=Object.freeze({principal:context.principal,requestId:context.requestId,correlationId:context.correlationId});
  if(request.method==="POST"&&id===undefined)return context.success(await service.create(resource,await context.readJson(),mutationContext),201);
  if(request.method==="PATCH"&&id!==undefined)return context.success(await service.update(resource,id,await context.readJson(),mutationContext));
  if(request.method==="DELETE"&&id!==undefined)return context.success(Object.freeze({archived:await service.remove(resource,id,mutationContext)}));
  throw new BackendApiError("NOT_FOUND","Operación administrativa no disponible.",404);
}
