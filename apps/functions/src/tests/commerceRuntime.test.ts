import { strict as assert } from 'node:assert'
import { COMMERCE_ASSISTANT_ID,createCommerceRuntimeFromEnv,IDENTITY_TOOL_ID,SUPERVISOR_TOOL_ID,validateCommerceRuntimeEnv } from '../commerce/index.js'
const env={CHOPIFY_COMMERCE_BASE_URL:'https://chopify.example.test',CHOPIFY_COMMERCE_API_TOKEN:'server-secret',GANOBOT_COMMERCE_ALLOWED_TENANTS:'tenant-floes,tenant-mg'} as NodeJS.ProcessEnv
const config=validateCommerceRuntimeEnv(env);assert.equal(config.baseUrl,'https://chopify.example.test');assert.deepEqual(config.allowedTenants,['tenant-floes','tenant-mg'])
const runtime=createCommerceRuntimeFromEnv('tenant-floes',env);assert.equal(runtime.assistantId,COMMERCE_ASSISTANT_ID)
assert.equal(runtime.tools.length,10);assert.equal(new Set(runtime.tools.map(t=>t.descriptor.id)).size,10)
assert.ok(runtime.tools.some(t=>t.descriptor.id===SUPERVISOR_TOOL_ID));assert.ok(runtime.tools.some(t=>t.descriptor.id===IDENTITY_TOOL_ID))
assert.ok(runtime.tools.every(t=>t.descriptor.tenantId==='tenant-floes'&&t.descriptor.assistantId===COMMERCE_ASSISTANT_ID))
assert.throws(()=>createCommerceRuntimeFromEnv('tenant-other',env),/not allowed/)
assert.throws(()=>createCommerceRuntimeFromEnv('tenant-floes',{...env,CHOPIFY_COMMERCE_BASE_URL:'http://unsafe.test'}),/HTTPS/)
assert.throws(()=>createCommerceRuntimeFromEnv('tenant-floes',env,'gano-assistant'),/requires assistantId/)
console.log('Commerce Runtime H6: 8 Commerce + Supervisor + Omnichannel Identity tool OK')
