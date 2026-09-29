import type { StudioAssistantConfiguration } from "../studio/index.js";
import type { BusinessAuditInput } from "./contracts.js";

export interface StudioAuditContext {
  readonly businessName: string;
  readonly catalogSource?: boolean;
  readonly authoritativePrices?: boolean;
  readonly authoritativeStock?: boolean;
  readonly productionAuth?: boolean;
  readonly fulfillmentProcess?: boolean;
  readonly salesPolicies?: boolean;
  readonly chopifyGateway?: boolean;
}

export function auditInputFromStudio(
  configuration: StudioAssistantConfiguration,
  context: StudioAuditContext,
): BusinessAuditInput {
  const tools = new Set(configuration.tools.allowlist);
  return Object.freeze({
    tenantId:configuration.tenantId,
    businessName:context.businessName,
    assistantId:configuration.id,
    capabilities:Object.freeze({
      brandIdentity:Boolean(configuration.identity.name && configuration.identity.purpose),
      catalogSource:context.catalogSource,
      authoritativePrices:context.authoritativePrices,
      authoritativeStock:context.authoritativeStock,
      inboundChannel:configuration.channels.length > 0,
      humanEscalation:tools.has("commerce.requestHumanEscalation"),
      knowledgeReady:!configuration.rag.enabled || configuration.rag.knowledgeBaseIds.length > 0,
      salesPolicies:context.salesPolicies,
      identityResolution:tools.has("commerce.resolveCustomerIdentity"),
      opportunityPipeline:tools.has("commerce.createOpportunity"),
      orderDrafts:tools.has("commerce.createOrderDraft"),
      paymentProofReview:tools.has("commerce.attachPaymentProof"),
      fulfillmentProcess:context.fulfillmentProcess,
      supervisor:tools.has("commerce.requestHumanEscalation"),
      chopifyGateway:context.chopifyGateway,
      tenantIsolation:true,
      productionAuth:context.productionAuth,
      studioPublished:configuration.status === "published",
    }),
  });
}
