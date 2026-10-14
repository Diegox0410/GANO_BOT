/** Vercel Preview keeps every hosted write outside the production collections. */
export function resolveHostedFirestoreCollections(environment = process.env) {
  const preview = environment.VERCEL_ENV === "preview";
  return Object.freeze({
    knowledgeRoot: preview ? "ganoKnowledgePreview" : "ganoKnowledge",
    knowledgeChunks: preview ? "ganoKnowledgePreview_chunks" : "ganoKnowledge_chunks",
    studio: preview ? "ganobot_studio_preview" : "ganobot_studio",
    conversations: preview ? "ganobot_runtime_preview" : "ganobot_runtime",
    audit: preview ? "ganobot_request_audit_preview" : "ganobot_request_audit",
    rateLimits: preview ? "ganobot_rate_limits_preview" : "ganobot_rate_limits",
    channelDeliveries: preview ? "ganobot_channel_deliveries_preview" : "ganobot_channel_deliveries",
  });
}
