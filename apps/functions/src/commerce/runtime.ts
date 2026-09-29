import type { ToolDefinition } from '@gano-bot/ai-core/tools-engine'
import { createChopifyHttpAdapterFromEnv,type ChopifyHttpAdapter } from './chopifyHttpAdapter.js'
import { COMMERCE_ASSISTANT_ID } from './profile.js'
import { createCommerceTools } from './tools.js'
import { createSupervisorTools } from './supervisorTools.js'
import { createIdentityTools } from './identityTools.js'

export interface CommerceRuntimeComposition {readonly tenantId:string;readonly assistantId:string;readonly port:ChopifyHttpAdapter;readonly tools:readonly ToolDefinition[]}
function allowedTenants(env:NodeJS.ProcessEnv){return new Set((env.GANOBOT_COMMERCE_ALLOWED_TENANTS??'tenant-floes,tenant-mg,tenant-dgng').split(',').map(v=>v.trim()).filter(Boolean))}
export function validateCommerceRuntimeEnv(env:NodeJS.ProcessEnv=process.env){
 const baseUrl=env.CHOPIFY_COMMERCE_BASE_URL?.trim();if(!baseUrl)throw new Error('CHOPIFY_COMMERCE_BASE_URL is required')
 if(!/^https:\/\//i.test(baseUrl))throw new Error('CHOPIFY_COMMERCE_BASE_URL must use HTTPS')
 if(!env.CHOPIFY_COMMERCE_API_TOKEN?.trim())throw new Error('CHOPIFY_COMMERCE_API_TOKEN is required')
 return Object.freeze({baseUrl,allowedTenants:Object.freeze([...allowedTenants(env)])})
}
export function createCommerceRuntimeFromEnv(tenantId:string,env:NodeJS.ProcessEnv=process.env,assistantId=COMMERCE_ASSISTANT_ID):CommerceRuntimeComposition{
 validateCommerceRuntimeEnv(env);if(!allowedTenants(env).has(tenantId))throw new Error(`Commerce tenant is not allowed: ${tenantId}`)
 if(assistantId!==COMMERCE_ASSISTANT_ID)throw new Error(`Commerce runtime requires assistantId ${COMMERCE_ASSISTANT_ID}`)
 const port=createChopifyHttpAdapterFromEnv(env)
 return Object.freeze({tenantId,assistantId,port,tools:Object.freeze([...createCommerceTools(port,tenantId,assistantId),...createSupervisorTools(port,tenantId,assistantId),...createIdentityTools(port,tenantId,assistantId)])})
}
