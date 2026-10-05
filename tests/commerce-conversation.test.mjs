import test from 'node:test'
import assert from 'node:assert/strict'
import { commerceResultText,commerceToolCall } from '../scripts/gano-hosted-runtime.mjs'

for(const phrase of ['qué tienen','qué venden','qué modelos tienen','muéstrame el catálogo','qué opciones hay','quiero ver los productos','qué scrubs tienen']){
 test(`reconoce intención de catálogo: ${phrase}`,()=>{assert.deepEqual(commerceToolCall(phrase).arguments,{query:'',limit:5})})
}
test('mantiene el producto en un seguimiento contextual',()=>{const result=commerceToolCall('¿Y cuánto cuesta?',[{role:'user',content:'Me interesa María Belén'},{role:'assistant',content:'Claro'}]);assert.equal(result.arguments.query,'Scrub María Belén')})
test('renderiza saltos reales y no secuencias literales',()=>{const reply=commerceResultText([{name:'Scrub real',price:null,pricingStatus:'PENDING',variants:[]}]);assert.match(reply,/\n\n/);assert.equal(reply.includes('\\n'),false);assert.match(reply,/pendiente de confirmación/)})
test('no inventa precio ni variantes ausentes',()=>{const reply=commerceResultText([{name:'Scrub real',price:null,pricingStatus:'PENDING',variants:[]}]);assert.doesNotMatch(reply,/\b\d+[.,]?\d*\s*(?:COP|USD)\b/);assert.doesNotMatch(reply,/colores?/i)})

test('mantiene Scrub Esencial cuando preguntan por un color contextual',()=>{
 const history=[{role:'user',content:'Me interesa el Scrub Esencial'},{role:'assistant',content:'Lo tenemos en varios colores'}]
 assert.equal(commerceToolCall('¿Y en azul marino?',history).arguments.query,'Scrub Esencial')
 assert.equal(commerceToolCall('¿Y negro?',history).arguments.query,'Scrub Esencial')
})

test('mantiene Maria Jose ante seguimiento de precio',()=>{
 const history=[{role:'user',content:'Me interesa Maria Jose'},{role:'assistant',content:'Claro'}]
 assert.equal(commerceToolCall('¿Cuanto cuesta?',history).arguments.query,'Scrub María José')
})
