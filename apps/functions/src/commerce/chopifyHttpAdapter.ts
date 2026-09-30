import type {
  CommercePort, CommerceRequestContext, CommerceProductSummary, CommerceProductDetails,
  CommerceAvailability, CommerceCustomerInput, CommerceCustomer, CommerceOpportunityInput,
  CommerceOpportunity, CommerceOrderDraftInput, CommerceOrderDraft, CommercePaymentProofInput,
  CommercePaymentProof, CommerceOrderSnapshot,
} from './contracts.js'
import type { CommerceEscalationInput, CommerceEscalationResult, CommerceSupervisorPort } from './supervisor.js'
import type { CommerceIdentityPort, CommerceResolveIdentityInput, CommerceResolvedIdentity } from './identity.js'

export interface ChopifyHttpAdapterConfig { readonly baseUrl:string; readonly bearerToken:string; readonly timeoutMs?:number; readonly fetchImpl?:typeof fetch; readonly logger?:Pick<Console,'error'> }
interface Envelope<T>{ok:boolean;data?:T;error?:string}
export class ChopifyHttpError extends Error { constructor(readonly status:number,message:string){super(message);this.name='ChopifyHttpError'} }

export class ChopifyHttpAdapter implements CommercePort,CommerceSupervisorPort,CommerceIdentityPort {
 private readonly fetchImpl:typeof fetch; private readonly timeoutMs:number; private readonly logger:Pick<Console,'error'>
 constructor(private readonly config:ChopifyHttpAdapterConfig){
  if(!/^https:\/\//i.test(config.baseUrl))throw new Error('Chopify baseUrl must use HTTPS')
  if(!config.bearerToken.trim())throw new Error('Chopify bearer token is required')
  this.fetchImpl=config.fetchImpl??fetch;this.timeoutMs=config.timeoutMs??8000;this.logger=config.logger??console
 }
 private async call<T>(context:CommerceRequestContext,operation:string,input:unknown):Promise<T>{
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),this.timeoutMs);const abort=()=>controller.abort()
  context.signal?.addEventListener('abort',abort,{once:true})
  try{
   const response=await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/,'')}/api/commerce`,{
    method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${this.config.bearerToken}`,'x-chopify-tenant-id':context.tenantId,'x-request-id':context.requestId,'x-correlation-id':context.correlationId},
    body:JSON.stringify({operation,input,idempotencyKey:context.idempotencyKey}),signal:controller.signal,
   })
   const body=await response.json().catch(()=>({ok:false,error:'Invalid JSON from Chopify'})) as Envelope<T>
   if(!response.ok||!body.ok){
    const error=new ChopifyHttpError(response.status,body.error??`Chopify request failed (${response.status})`)
    this.logger.error('[Chopify Commerce] request-failed',Object.freeze({operation,status:response.status,name:error.name,message:response.status===401?'Chopify rejected commerce credentials.':'Chopify commerce request failed.'}))
    throw error
   }
   return body.data as T
  }finally{clearTimeout(timer);context.signal?.removeEventListener('abort',abort)}
 }
 searchProducts(c:CommerceRequestContext,i:{readonly query:string;readonly limit?:number}){return this.call<readonly CommerceProductSummary[]>(c,'searchProducts',i)}
 getProductDetails(c:CommerceRequestContext,i:{readonly productId:string}){return this.call<CommerceProductDetails|undefined>(c,'getProductDetails',i)}
 checkAvailability(c:CommerceRequestContext,i:{readonly productId:string;readonly variantId?:string;readonly quantity?:number}){return this.call<CommerceAvailability>(c,'checkAvailability',i)}
 createOrUpdateCustomer(c:CommerceRequestContext,i:CommerceCustomerInput){return this.call<CommerceCustomer>(c,'createOrUpdateCustomer',i)}
 createOpportunity(c:CommerceRequestContext,i:CommerceOpportunityInput){return this.call<CommerceOpportunity>(c,'createOpportunity',i)}
 createOrderDraft(c:CommerceRequestContext,i:CommerceOrderDraftInput){return this.call<CommerceOrderDraft>(c,'createOrderDraft',i)}
 attachPaymentProof(c:CommerceRequestContext,i:CommercePaymentProofInput){return this.call<CommercePaymentProof>(c,'attachPaymentProof',i)}
 getOrderStatus(c:CommerceRequestContext,i:{readonly orderId:string}){return this.call<CommerceOrderSnapshot|undefined>(c,'getOrderStatus',i)}
 requestHumanEscalation(c:CommerceRequestContext,i:CommerceEscalationInput){return this.call<CommerceEscalationResult>(c,'requestHumanEscalation',{...i,conversationId:c.conversationId})}
 resolveCustomerIdentity(c:CommerceRequestContext,i:CommerceResolveIdentityInput){return this.call<CommerceResolvedIdentity>(c,'resolveCustomerIdentity',i)}
}
export function createChopifyHttpAdapterFromEnv(env:NodeJS.ProcessEnv=process.env):ChopifyHttpAdapter{
 const baseUrl=env.CHOPIFY_COMMERCE_BASE_URL?.trim();const bearerToken=env.CHOPIFY_COMMERCE_API_TOKEN?.trim()
 if(!baseUrl)throw new Error('CHOPIFY_COMMERCE_BASE_URL is required');if(!bearerToken)throw new Error('CHOPIFY_COMMERCE_API_TOKEN is required')
 return new ChopifyHttpAdapter({baseUrl,bearerToken,timeoutMs:env.CHOPIFY_COMMERCE_TIMEOUT_MS?Number(env.CHOPIFY_COMMERCE_TIMEOUT_MS):undefined})
}
