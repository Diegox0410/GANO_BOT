import type { ToolDefinition, ToolExecutionContext } from '@gano-bot/ai-core/tools-engine'
import type { CommerceRequestContext } from './contracts.js'
import type { CommerceSupervisorPort, CommerceEscalationPriority, CommerceEscalationReason } from './supervisor.js'

export const SUPERVISOR_TOOL_ID = 'commerce.requestHumanEscalation'

const allowedReasons = new Set<CommerceEscalationReason>([
  'CUSTOMER_REQUEST','COMPLAINT','PAYMENT_ISSUE','PRICING_EXCEPTION','STOCK_CONFLICT',
  'RETURN_REQUEST','DELIVERY_ISSUE','UNKNOWN_PRODUCT','SYSTEM_ERROR','OTHER',
])
const allowedPriorities = new Set<CommerceEscalationPriority>(['LOW','NORMAL','HIGH','URGENT'])
const stringValue=(value:unknown)=>typeof value==='string'&&value.trim()?value.trim():undefined

function requestContext(context:ToolExecutionContext):CommerceRequestContext {
  return Object.freeze({
    tenantId:context.tenantId,assistantId:context.assistantId,actorId:context.actorId,
    conversationId:context.conversationId,requestId:context.requestId,correlationId:context.correlationId,
    idempotencyKey:stringValue(context.metadata?.idempotencyKey)??`${context.tenantId}:${context.requestId}:${SUPERVISOR_TOOL_ID}`,
    signal:context.signal,
  })
}

export function createSupervisorTools(port:CommerceSupervisorPort,tenantId:string,assistantId:string):readonly ToolDefinition[] {
  return Object.freeze([{
    descriptor:Object.freeze({
      id:SUPERVISOR_TOOL_ID,name:SUPERVISOR_TOOL_ID,
      description:'Escala una conversación a revisión humana en Chopify. No aprueba pagos ni modifica inventario.',
      version:'1.0.0',category:'business' as const,riskLevel:'low' as const,
      inputSchema:Object.freeze({type:'object',additionalProperties:false,required:Object.freeze(['reason']),properties:Object.freeze({
        reason:Object.freeze({type:'string'}),priority:Object.freeze({type:'string'}),contextSummary:Object.freeze({type:'string'}),orderId:Object.freeze({type:'string'}),
      })}),
      outputSchema:Object.freeze({type:'object'}),requiredPermissions:Object.freeze(['tools:execute']),
      confirmationPolicy:'never' as const,timeoutMs:5_000,enabled:true,tenantId,assistantId,
      tags:Object.freeze(['commerce','supervisor','human-escalation','tenant-scoped']),
    }),
    handler:{async execute(args,context){
      const reason=stringValue(args.reason) as CommerceEscalationReason|undefined
      if(!reason||!allowedReasons.has(reason))throw new Error('Invalid escalation reason')
      const rawPriority=stringValue(args.priority) as CommerceEscalationPriority|undefined
      if(rawPriority&&!allowedPriorities.has(rawPriority))throw new Error('Invalid escalation priority')
      return port.requestHumanEscalation(requestContext(context),{
        reason,priority:rawPriority,contextSummary:stringValue(args.contextSummary),orderId:stringValue(args.orderId),
      })
    }},
  }])
}
