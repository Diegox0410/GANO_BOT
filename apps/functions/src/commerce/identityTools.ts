import type { ToolDefinition,ToolExecutionContext } from '@gano-bot/ai-core/tools-engine'
import type { CommerceRequestContext } from './contracts.js'
import type { CommerceIdentityChannel,CommerceIdentityPort } from './identity.js'

export const IDENTITY_TOOL_ID='commerce.resolveCustomerIdentity'
const channels=new Set<CommerceIdentityChannel>(['WHATSAPP','INSTAGRAM','FACEBOOK','WEB','OTHER'])
const str=(v:unknown)=>typeof v==='string'&&v.trim()?v.trim():undefined
const context=(c:ToolExecutionContext):CommerceRequestContext=>Object.freeze({
 tenantId:c.tenantId,assistantId:c.assistantId,actorId:c.actorId,conversationId:c.conversationId,
 requestId:c.requestId,correlationId:c.correlationId,
 idempotencyKey:str(c.metadata?.idempotencyKey)??`${c.tenantId}:${c.requestId}:${IDENTITY_TOOL_ID}`,signal:c.signal,
})
export function createIdentityTools(port:CommerceIdentityPort,tenantId:string,assistantId:string):readonly ToolDefinition[]{
 return Object.freeze([{
  descriptor:Object.freeze({
   id:IDENTITY_TOOL_ID,name:IDENTITY_TOOL_ID,
   description:'Resuelve o crea de forma segura la identidad omnicanal de un cliente dentro del tenant actual.',
   version:'1.0.0',category:'business' as const,riskLevel:'low' as const,
   inputSchema:Object.freeze({type:'object',additionalProperties:false,required:Object.freeze(['channel','externalIdentifier']),properties:Object.freeze({
    channel:Object.freeze({type:'string'}),externalIdentifier:Object.freeze({type:'string',minLength:1}),
    name:Object.freeze({type:'string'}),phone:Object.freeze({type:'string'}),email:Object.freeze({type:'string'}),acquisitionSource:Object.freeze({type:'string'}),
   })}),
   outputSchema:Object.freeze({type:'object'}),requiredPermissions:Object.freeze(['tools:execute']),confirmationPolicy:'never' as const,
   timeoutMs:5_000,enabled:true,tenantId,assistantId,tags:Object.freeze(['commerce','omnichannel','identity','tenant-scoped']),
  }),
  handler:{async execute(args,c){
   const channel=str(args.channel) as CommerceIdentityChannel|undefined
   const externalIdentifier=str(args.externalIdentifier)
   if(!channel||!channels.has(channel))throw new Error('Invalid identity channel')
   if(!externalIdentifier)throw new Error('externalIdentifier is required')
   return port.resolveCustomerIdentity(context(c),{channel,externalIdentifier,name:str(args.name),phone:str(args.phone),email:str(args.email),acquisitionSource:str(args.acquisitionSource)})
  }},
 }])
}
