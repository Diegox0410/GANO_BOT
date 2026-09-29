import assert from 'node:assert/strict'
import type { CommerceRequestContext } from '../commerce/contracts.js'
import type { CommerceIdentityPort,CommerceResolveIdentityInput } from '../commerce/identity.js'
import { createIdentityTools,IDENTITY_TOOL_ID } from '../commerce/identityTools.js'
const calls:Array<{context:CommerceRequestContext;input:CommerceResolveIdentityInput}>=[]
const port:CommerceIdentityPort={async resolveCustomerIdentity(context,input){calls.push({context,input});return{customerId:'customer-1',identityId:'identity-1',channel:input.channel,externalIdentifier:input.externalIdentifier,createdCustomer:false,createdIdentity:true}}}
const tools=createIdentityTools(port,'tenant-floes','commerce-assistant');const tool=tools[0];assert.ok(tool)
const result=await tool.handler.execute({channel:'WHATSAPP',externalIdentifier:'+593 99 000 0000'},{
 tenantId:'tenant-floes',assistantId:'commerce-assistant',actorId:'customer',conversationId:'conv-1',requestId:'req-h6',correlationId:'corr-h6',
 roles:['user'],permissions:['tools:execute'],allowedToolIds:[IDENTITY_TOOL_ID],allowedCategories:['business'],maximumRiskLevel:'medium',
})
assert.equal((result as {customerId:string}).customerId,'customer-1');assert.equal(calls[0]?.context.tenantId,'tenant-floes')
assert.equal(calls[0]?.context.idempotencyKey,'tenant-floes:req-h6:commerce.resolveCustomerIdentity')
await assert.rejects(()=>tool.handler.execute({channel:'INVALID',externalIdentifier:'x'},{
 tenantId:'tenant-floes',assistantId:'commerce-assistant',actorId:'customer',conversationId:'conv-1',requestId:'bad',correlationId:'bad',
 roles:['user'],permissions:['tools:execute'],allowedToolIds:[IDENTITY_TOOL_ID],allowedCategories:['business'],maximumRiskLevel:'medium',
}),/Invalid identity channel/)
console.log('H6 Omnichannel Identity: tool tipado, tenant-scoped e idempotente OK')
