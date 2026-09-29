import assert from "node:assert/strict";
import { InMemoryStudioRepository, routeStudio, StudioControlPlane, StudioRuntimeConfigurationResolver, validateStudioConfiguration } from "../studio/index.js";
import type { ApiPrincipal } from "../contracts.js";
import type { StudioAssistantConfiguration } from "../studio/index.js";

const principal: ApiPrincipal = Object.freeze({
  actorId: "owner-1", tenantId: "tenant-floes",
  roles: Object.freeze(["tenant-admin"] as const),
  permissions: Object.freeze(["assistants:read","assistants:create","assistants:update","assistants:publish","assistants:archive"] as const),
  authenticated: true,
});
const now = "2026-09-28T12:00:00.000Z";
const base: StudioAssistantConfiguration = Object.freeze({
  id:"commerce-assistant", tenantId:"tenant-floes", version:1, status:"draft",
  identity:Object.freeze({name:"FLOES Sales",description:"Ventas",purpose:"Convertir conversaciones en ventas",locale:"es",allowedLocales:Object.freeze(["es"]),tone:"profesional",instructions:"Ayuda a comprar sin inventar datos.",welcomeMessage:"Hola"}),
  behavior:Object.freeze({systemPrompt:"Eres el asistente comercial de FLOES.",restrictions:"Usa tools para precio, stock, pedidos y pagos.",responseLength:"balanced",creativity:0.2,insufficientPolicy:"ask-clarification"}),
  rag:Object.freeze({enabled:false,groundingMode:"private-preferred",knowledgeBaseIds:Object.freeze([]),topK:5,minimumScore:0.25,citationsEnabled:true}),
  memory:Object.freeze({enabled:false,shortTerm:true,longTerm:false,summary:true,retentionDays:30,consentRequired:true}),
  tools:Object.freeze({enabled:true,allowlist:Object.freeze(["commerce.searchProducts","commerce.checkAvailability","commerce.createOrderDraft","commerce.requestHumanEscalation","commerce.resolveCustomerIdentity"]),maximumRisk:"medium",maximumCalls:8,maximumRounds:4}),
  channels:Object.freeze(["WEB","WHATSAPP"] as const),
  createdAt:now,updatedAt:now,createdBy:"owner-1",updatedBy:"owner-1",
});
const repo = new InMemoryStudioRepository();
const backendAllowedTools = Object.freeze([
  "commerce.searchProducts",
  "commerce.checkAvailability",
  "commerce.createOrderDraft",
  "commerce.requestHumanEscalation",
  "commerce.resolveCustomerIdentity",
]);
const studio = new StudioControlPlane(repo, () => backendAllowedTools);
assert.equal(validateStudioConfiguration(base).length,0);
const saved = await studio.saveDraft(base,{principal,now});
assert.equal(saved.tenantId,"tenant-floes");
assert.equal(saved.version,1);
const published = await studio.publish("tenant-floes","commerce-assistant",{principal,now});
assert.equal(published.configuration.status,"published");
const resolver = new StudioRuntimeConfigurationResolver(studio);
const runtime = await resolver.resolve(
  "tenant-floes",
  "commerce-assistant",
  Object.freeze(["commerce.searchProducts", "commerce.resolveCustomerIdentity"]),
);
assert.equal(runtime.assistantId,"commerce-assistant");
assert.ok(runtime.toolAllowlist.includes("commerce.resolveCustomerIdentity"));
assert.deepEqual(runtime.toolAllowlist, ["commerce.searchProducts", "commerce.resolveCustomerIdentity"]);
assert.ok(runtime.systemPrompt.includes("Usa tools"));
const foreign: StudioAssistantConfiguration = Object.freeze({...base,tenantId:"tenant-dgng"});
await assert.rejects(()=>studio.saveDraft(foreign,{principal,now}),/otro tenant/);
await assert.rejects(()=>studio.resolvePublished("tenant-dgng","commerce-assistant"));
await assert.rejects(
  () => studio.saveDraft(Object.freeze({
    ...base,
    tools: Object.freeze({ ...base.tools, allowlist: Object.freeze(["system.privilegedTool"]) }),
  }), { principal, now }),
  /no puede habilitar herramientas/,
);

const routeContext = (request: Request, actor: ApiPrincipal = principal) => ({
  principal: actor,
  now,
  readJson: () => request.json() as Promise<unknown>,
  success: (data: unknown, status = 200) =>
    new Response(JSON.stringify({ success: true, data }), { status }),
});
const listRequest = new Request("https://api.example.test/v1/studio/assistants");
const listResponse = await routeStudio(listRequest, studio, routeContext(listRequest));
assert.equal(listResponse?.status, 200);

const foreignRequest = new Request("https://api.example.test/v1/studio/assistants", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ...base, tenantId: "tenant-dgng" }),
});
await assert.rejects(
  () => routeStudio(foreignRequest, studio, routeContext(foreignRequest)),
  /tenant del cuerpo/,
);

const readOnlyPrincipal: ApiPrincipal = Object.freeze({
  ...principal,
  permissions: Object.freeze(["assistants:read"] as const),
});
const archiveRequest = new Request(
  "https://api.example.test/v1/studio/assistants/commerce-assistant/archive",
  { method: "POST" },
);
await assert.rejects(
  () => routeStudio(archiveRequest, studio, routeContext(archiveRequest, readOnlyPrincipal)),
  /no está autorizada/,
);
console.log("H7 Studio Control Plane: drafts, publish versionado, tenant isolation y runtime resolver OK");
