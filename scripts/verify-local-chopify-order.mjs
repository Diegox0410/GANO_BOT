import assert from "node:assert/strict";
import { ChopifyHttpAdapter } from "../apps/functions/dist/commerce/chopifyHttpAdapter.js";
import { COMMERCE_TOOL_IDS, createCommerceTools } from "../apps/functions/dist/commerce/tools.js";

const baseUrl = process.env.CHOPIFY_COMMERCE_BASE_URL;
const bearerToken = process.env.CHOPIFY_COMMERCE_API_TOKEN;
const orderId = process.env.LOCAL_E2E_ORDER_ID;
const customerId = process.env.LOCAL_E2E_CUSTOMER_ID;
const localApiUrl = process.env.LOCAL_CHOPIFY_API_URL ?? "http://127.0.0.1:4180/api/commerce";
if (!baseUrl || !bearerToken || !orderId || !customerId || !localApiUrl.startsWith("http://127.0.0.1:")) {
  throw new Error("Set the local Chopify URL, sandbox token, synthetic order ID/customer ID and loopback API URL.");
}

const adapter = new ChopifyHttpAdapter({
  baseUrl,
  bearerToken,
  timeoutMs: 5_000,
  fetchImpl: (_input, init) => fetch(localApiUrl, init),
});
const tool = createCommerceTools(adapter, "tenant-floes", "commerce-assistant")
  .find((candidate) => candidate.descriptor.id === COMMERCE_TOOL_IDS.getOrderStatus);
assert.ok(tool, "GanoBot order status tool is registered");
const snapshot = await tool.handler.execute(
  { orderId },
  {
    tenantId: "tenant-floes",
    assistantId: "commerce-assistant",
    actorId: customerId,
    conversationId: `local-e2e:${orderId}`,
    requestId: `local-e2e:${orderId}`,
    correlationId: `local-e2e:${orderId}`,
    metadata: { customerId, idempotencyKey: `local-e2e:status:${orderId}` },
  },
);
assert.equal(snapshot?.orderId, orderId, "GanoBot returns the requested order");
assert.equal(snapshot?.customerId, customerId, "GanoBot scopes the order to the authenticated customer");
assert.equal(snapshot?.status, "delivered", "GanoBot reports the persisted delivery state");
assert.equal(snapshot?.followUp?.outcome, "SATISFIED", "GanoBot reports the persisted post-sale outcome");
console.log(JSON.stringify({
  result: "GANOBOT_LOCAL_ORDER_STATUS_PASS",
  orderId: snapshot.orderId,
  status: snapshot.status,
  followUp: snapshot.followUp,
}));
