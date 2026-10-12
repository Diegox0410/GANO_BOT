# FLOES catalog and WhatsApp pilot

GanoBot consumes the existing Chopify CommercePort over HTTPS. It owns no catalog or payment approval state. The deployed `/api/live` accepts the existing service bearer boundary and chooses a runtime cached by the validated tenant. Conversations remain in Firestore under that tenant, with a hash of tenant and WhatsApp phone as conversation ID.

## Activation

FLOES uses the catalog consultation and guarded order draft tools by default; set `FLOES_CATALOG_V2=false` only as an explicit rollback. Catalog images are included in live WhatsApp replies by default; set `FLOES_WHATSAPP_MEDIA=false` only to disable them. Other tenants retain their existing tools and response format. Deploying code is distinct from publishing catalog data: adding models through Chopify requires no GanoBot redeploy.

The existing server environment requires `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY`, `CHOPIFY_COMMERCE_BASE_URL`, `CHOPIFY_COMMERCE_API_TOKEN`, and `GANOBOT_LIVE_BEARER_TOKEN`. Optional existing settings are `CHOPIFY_COMMERCE_TIMEOUT_MS` and `GANOBOT_COMMERCE_ALLOWED_TENANTS`. Secrets must remain server-side. No Meta credentials belong in the commercial conversation module.

## Contract

The existing `searchProducts` and `getProductDetails` provide parent models and color variants. Additive fields are characteristics, commercial notes, promotional price, delivery/exchange information, and a structured size guide. Variants expose active/available state, real images, `size` or `sizes`, stock and price. Draft lines carry the selected size. A guide has `measurement: FLAT_GARMENT_CM`, instructions and optional blouse/trousers rows with size and named measurements in centimeters.

Only available active variants are offered. A color lookup normalizes accents, casing, spaces, underscores and hyphens and matches the returned variants exactly. Missing colors, sizes, photos and prices remain missing. Images must be public HTTPS URLs; the bot never uses a Windows path or a photograph from a different color.

The assistant stores a small selection as JSON in message metadata in the existing conversation repository. It re-fetches details and availability before order creation. `commerce.prepareCustomerOrder` validates model, variant, size, quantity and price, then uses the existing customer, opportunity and draft operations with independent idempotency keys. Sending a proof only calls `attachPaymentProof`; payment remains pending_review.

Owner/Admin alone changes payment and fulfillment. The assistant reflects authoritative status snapshots, tracking and delivery information and can request human escalation. Status responses cover draft, awaiting-payment, payment-under-review, paid, preparing, ready-for-dispatch, dispatched, delivered and cancelled. `updateOrderDelivery` merges existing recipient/address details and asks only for missing fields. `recordOrderFollowUp` records reception, satisfaction or an issue only for a delivered order. Both tools verify the order belongs to the resolved customer and preserve payment/fulfillment boundaries.

## Live multimedia

The text-compatible response remains `{ "reply": "..." }`. When enabled and a selected variant has a valid image, it also includes an ordered `messages` array:

```json
{
  "reply": "Authoritative commercial response",
  "messages": [
    { "type": "image", "url": "https://storage.example/floes/model/color.jpeg", "caption": "Model · Color", "alt": "Model Color" },
    { "type": "text", "text": "Authoritative commercial response" }
  ]
}
```

The Chopify WhatsApp outbox sends these entries in order and uses reply for older responses. The independent `WhatsAppChannelAdapter` provides sendText/sendImage/sendImageWithCaption over an injected transport, which owns Meta API/version/credentials. The live request also supports optional `paymentProofUrl` when the upstream integration has a public HTTPS proof asset.

## Verification and external dependencies

`tests/floes-catalog-pilot.test.mjs` exercises grouped catalog, available colors, contextual color/size, correct image and price, missing variants/images, flat size guide, recommendations, guarded drafts, tenant isolation, channel transport and proof/order status conversations using minimal fixtures. Existing commerce, identity, Supervisor, Studio, Auditor and live tests remain applicable.

A production E2E additionally requires a real imported catalog with approved prices, sizes, availability and HTTPS images; the existing Firebase/Commerce service credentials; published Studio tools allowlisting the pilot tool IDs where Studio is used; and an authorized Meta sender/WhatsApp account on the upstream channel. Unit fixtures are never production catalog data.
