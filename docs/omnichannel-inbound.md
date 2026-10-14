# FLOES omnichannel inbound contract

## Normalized event

The local ingress adapters normalize web widget, Instagram, Facebook, and TikTok events to this envelope before calling Chopify:

```json
{
  "tenantId": "tenant-floes",
  "channel": "INSTAGRAM",
  "provider": "META",
  "providerMessageId": "provider-message-id",
  "externalConversationId": "provider-thread-or-sender-id",
  "externalCustomerId": "provider-scoped-customer-id",
  "customer": { "name": "Optional", "phone": "Optional", "email": "Optional" },
  "text": "Incoming message",
  "receivedAt": "2026-10-13T12:00:00.000Z",
  "acquisitionSource": "INSTAGRAM",
  "conversationId": "conversation_<sha256>"
}
```

The canonical conversation ID is `conversation_` plus SHA-256 of the exact JSON serialization `JSON.stringify([tenantId, provider, channel, externalConversationId])`; Chopify derives the same value. Provider values are uppercase `WEB`, `META`, or `TIKTOK` (Instagram and Facebook use `META`). The inbound deduplication key is SHA-256 hex of `${tenantId}:${provider}:${channel}:${providerMessageId}`. Provider account IDs and tenant allowlists come from server configuration; event payloads cannot select an arbitrary tenant.

The relay records delivery progress by inbound deduplication key: `inbound-persisted`, `outbound-pending` (including the generated reply and stable outbound identifiers), and `completed`. If processing fails, a replay retries processing; if outbound persistence fails, a replay reuses the saved reply and retries only the outbound persistence. Once completed, a replay returns `duplicate` without calling Chopify, the commerce processor, or outbound persistence again. This stage ledger is in relay-instance memory; it resumes retries handled by that live instance and is lost on process restart. A duplicate from Chopify alone confirms inbound persistence, not completion of the reply. If a new relay instance sees a Chopify duplicate with no local stage record, it fails closed and does not process or enqueue a second reply; reconcile that event through a durable delivery ledger or manual workflow. Durable recovery across process restarts requires a durable delivery ledger and is not claimed by this adapter.

## Chopify persistence call

The GanoBot adapter sends `POST /api/channel-inbound` to the tenant-specific Chopify base URL. It uses `CHOPIFY_API_BASE_URL_FLOES` / `_MG` / `_DGNG` and the matching `CHOPIFY_GANOBOT_INBOUND_TOKEN_FLOES` / `_MG` / `_DGNG` Bearer token, a stable `Idempotency-Key` (SHA-256 hex of `tenantId:provider:channel:providerMessageId`), a bounded timeout, and the normalized envelope as JSON. There is no default tenant or shared-token fallback. Provider values are `WEB`, `META`, or `TIKTOK` (Instagram and Facebook use `META`). A successful response must contain the same `conversationId` and a resolved `customerId`; optional `duplicate: true` is accepted.

## Deployable GanoBot route and tenant authentication

`api/omnichannel-inbound.mjs` exports a default Vercel handler and an injectable `createOmnichannelInboundHandler` test factory. The default composition builds tenant-pinned adapters, both Chopify HTTP persistence adapters, the omnichannel relay, and calls `getGanoHostedRuntime(tenantId).processLiveOmnichannel(envelope)`. `GANOBOT_OMNICHANNEL_INGRESS_TOKEN_FLOES`, `_MG`, and `_DGNG` are separate service credentials. The token identifies the tenant; the body tenant must match it. Reused token values fail closed. A tenant requires its matching Chopify base URL and service token or composition returns 503. Provider adapters are enabled only when their account is configured: `GANOBOT_OMNICHANNEL_INSTAGRAM_ACCOUNT_<TENANT>`, `...FACEBOOK_ACCOUNT_<TENANT>`, and `...TIKTOK_ACCOUNT_<TENANT>`; WEB uses the internal bearer-protected widget ingress.

This route is an internal service ingress. It does not validate official Meta/TikTok webhook signatures, subscribe webhooks, refresh provider credentials, or dispatch provider messages. Do not expose it directly as a provider webhook: deploy it behind a trusted signature-verifying gateway that forwards only verified events with the tenant-specific service token. TikTok publishes an official Business Messaging API for direct messages and conversation management; its onboarding requires a TikTok for Business account, developer registration/app, API access, authorization, and Business Messaging webhook subscription ([official get-started guide](https://business-api.tiktok.com/portal/docs/business-messaging-api-get-started/v1.3), [Business Messaging API overview](https://business-api.tiktok.com/portal/bm-api/education-hub)). No authorized TikTok app/account or provider adapter is configured in this candidate. Without the gateway and provider account credentials, social channels are unavailable/fail closed; no synthetic signature verification is claimed.

Only after Chopify confirms inbound persistence does the relay send the event to the hosted commerce conversation processor. That processor resolves channel identity in the configured tenant and uses the canonical conversation ID for commerce operations; its own memory conversation key remains separate. Before returning the generated reply, the relay persists it with `POST /api/channel-outbound`, the same tenant-specific Bearer token, and `Idempotency-Key` equal to SHA-256 hex of `${tenantId}:${conversationId}:${customerId}:${channel}:${correlationId}`. The outbound body is `{tenantId,channel,provider,conversationId,customerId,messageId,correlationId,text,createdAt}`. The deterministic messageId is derived from the inbound dedupe key and correlationId. This records the reply in CRM without sending it to an external provider. Follow-up messages and orders therefore keep the same Chopify conversation identity.

## Adapter and provider limits

The included adapters cover deterministic normalized fixtures for WEB, INSTAGRAM, FACEBOOK, and TIKTOK, plus Chopify inbound and outbound HTTP persistence adapters. WhatsApp continues through its existing authenticated media-capable endpoint. The social fixtures do not claim that official Meta/TikTok signature verification, subscriptions, token refresh, retry policy, or provider-specific outbound messaging is installed. TikTok's official Business Messaging API is available, but this candidate has not obtained app/API access, authorized a business account, registered webhooks, or implemented its provider-specific adapter. Those steps remain external integration work. The adapters do not send messages to real providers.

All current adapter tests use synthetic accounts, tokens, transport, and commerce persistence. They never contact Chopify, Meta, TikTok, WhatsApp, or Production.
