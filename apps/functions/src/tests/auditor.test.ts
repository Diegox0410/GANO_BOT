import assert from "node:assert/strict";
import { GanoBotAuditor, auditInputFromStudio } from "../auditor/index.js";
import type { StudioAssistantConfiguration } from "../studio/index.js";

const now="2026-09-28T20:00:00.000Z";
const studio: StudioAssistantConfiguration = Object.freeze({
  id:"commerce-assistant",tenantId:"tenant-floes",version:3,status:"published",
  identity:Object.freeze({name:"FLOES Sales",description:"Ventas",purpose:"Convertir consultas en ventas",locale:"es",allowedLocales:Object.freeze(["es"]),tone:"profesional",instructions:"No inventes datos.",welcomeMessage:"Hola"}),
  behavior:Object.freeze({systemPrompt:"Asistente comercial.",restrictions:"Usa herramientas.",responseLength:"balanced",creativity:0.2,insufficientPolicy:"ask-clarification"}),
  rag:Object.freeze({enabled:true,groundingMode:"private-preferred",knowledgeBaseIds:Object.freeze(["kb-floes"]),topK:5,minimumScore:0.25,citationsEnabled:true}),
  memory:Object.freeze({enabled:false,shortTerm:true,longTerm:false,summary:true,retentionDays:30,consentRequired:true}),
  tools:Object.freeze({enabled:true,allowlist:Object.freeze(["commerce.searchProducts","commerce.checkAvailability","commerce.createOpportunity","commerce.createOrderDraft","commerce.attachPaymentProof","commerce.requestHumanEscalation","commerce.resolveCustomerIdentity"]),maximumRisk:"medium",maximumCalls:8,maximumRounds:4}),
  channels:Object.freeze(["WEB","WHATSAPP"] as const),createdAt:now,updatedAt:now,createdBy:"owner",updatedBy:"owner",
});
const input=auditInputFromStudio(studio,{
  businessName:"FLOES",
  catalogSource:true,authoritativePrices:true,authoritativeStock:true,
  productionAuth:false,fulfillmentProcess:true,salesPolicies:true,chopifyGateway:true,
});
const auditor=new GanoBotAuditor();
const report=auditor.audit(input,now);
assert.equal(report.tenantId,"tenant-floes");
assert.equal(report.readyForControlledPilot,false);
assert.ok(report.blockers.includes("security.auth"));
assert.ok(report.findings.some(f=>f.id==="crm.identity"&&f.status==="PASS"));
assert.ok(report.actions[0]?.priority==="P0");
const ready=auditor.audit(Object.freeze({...input,capabilities:Object.freeze({...input.capabilities,productionAuth:true})}),now);
assert.equal(ready.readyForControlledPilot,true);
const unknown=auditor.audit(Object.freeze({tenantId:"tenant-dgng",businessName:"DGNG",capabilities:Object.freeze({})}),now);
assert.ok(unknown.unknowns.length>0);
assert.equal(unknown.readyForControlledPilot,false);
assert.notEqual(report.tenantId,unknown.tenantId);
console.log("H8 GanoBot Auditor: readiness, gaps, blockers, unknowns, remediation y tenant isolation OK");
