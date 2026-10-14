const ID = /^[A-Za-z0-9:_-]{1,256}$/;
const OUTCOME = new Set(["SENT", "FAILED", "UNKNOWN"]);

function requiredId(value, name) {
  if (typeof value !== "string" || !ID.test(value.trim())) throw new Error(`invalid-${name}`);
  return value.trim();
}

function requiredFunction(value, name) {
  if (typeof value !== "function") throw new Error(`invalid-${name}`);
  return value;
}

function recordId(record) {
  return record?.outboxId ?? record?.id;
}

/**
 * Transport-agnostic, one-shot consumer for a tenant-scoped Chopify outbox.
 * The repository must implement atomic claim/lease and finish operations. The
 * worker deliberately never discovers or claims work on its own: callers pass
 * an exact outbox ID, and transport is reached only after CLAIMED -> SENDING.
 */
export function createChannelOutboxWorker({ repository, transport, workerId, allowedTenantIds, now = () => new Date(), transportTimeoutMs = 30_000 }) {
  if (!repository || typeof repository !== "object") throw new Error("invalid-outbox-repository");
  const claim = requiredFunction(repository.claimChannelOutbox, "outbox-claim");
  const markSending = requiredFunction(repository.markChannelOutboxSending, "outbox-mark-sending");
  const finish = requiredFunction(repository.finishChannelOutbox, "outbox-finish");
  const send = requiredFunction(transport?.send, "outbox-transport");
  const safeWorkerId = requiredId(workerId, "worker-id");
  if (!Array.isArray(allowedTenantIds) || !allowedTenantIds.length) throw new Error("invalid-outbox-tenant-allowlist");
  const tenants = new Set(allowedTenantIds.map(value => requiredId(value, "allowed-tenant")));
  if (!Number.isInteger(transportTimeoutMs) || transportTimeoutMs < 1 || transportTimeoutMs > 50_000) throw new Error("invalid-outbox-transport-timeout");

  return Object.freeze({
    async dispatchOnce(tenantIdValue, outboxIdValue) {
      const tenantId = requiredId(tenantIdValue, "tenant");
      if (!tenants.has(tenantId)) throw new Error("tenant-not-allowed");
      const outboxId = requiredId(outboxIdValue, "outbox-id");
      const claimed = await claim.call(repository, tenantId, outboxId, safeWorkerId, { now: now() });
      if (!claimed) return Object.freeze({ status: "NOT_CLAIMABLE", outboxId });
      if (claimed.tenantId !== tenantId || recordId(claimed) !== outboxId || claimed.status !== "CLAIMED"
        || claimed.leaseOwner !== safeWorkerId || typeof claimed.claimId !== "string" || !ID.test(claimed.claimId)) {
        throw new Error("invalid-outbox-claim");
      }

      const sending = await markSending.call(repository, tenantId, outboxId, claimed.claimId);
      if (!sending || sending.tenantId !== tenantId || recordId(sending) !== outboxId
        || !["SENDING", "BLOCKED"].includes(sending.status) || sending.claimId !== claimed.claimId) {
        throw new Error("outbox-send-claim-lost");
      }
      if (sending.status === "BLOCKED") {
        const code = sending.code ?? sending.failureCode;
        return Object.freeze({ outboxId, status: "BLOCKED", ...(typeof code === "string" ? { code } : {}) });
      }

      let result;
      const controller = new AbortController();
      let timedOut = false;
      let timeout;
      try {
        const request = send.call(transport, Object.freeze({
          tenantId,
          outboxId,
          provider: sending.provider,
          channel: sending.channel,
          conversationId: sending.conversationId,
          customerId: sending.customerId,
          text: sending.text,
          idempotencyKey: outboxId,
          signal: controller.signal,
        }));
        const deadline = new Promise((_, reject) => {
          timeout = setTimeout(() => {
            timedOut = true;
            controller.abort(new Error("outbox-transport-timeout"));
            reject(new Error("outbox-transport-timeout"));
          }, transportTimeoutMs);
        });
        result = await Promise.race([request, deadline]);
      } catch {
        // A transport exception can happen after the provider accepted the
        // request. Mark UNKNOWN and require reconciliation; never blind-retry.
        result = { status: "UNKNOWN", code: timedOut ? "TRANSPORT_TIMEOUT" : "TRANSPORT_RESULT_UNCERTAIN" };
      } finally {
        clearTimeout(timeout);
      }

      if (!OUTCOME.has(result?.status)) throw new Error("invalid-outbox-transport-result");
      const completed = await finish.call(repository, tenantId, outboxId, claimed.claimId, {
        status: result.status,
        ...(typeof result.providerMessageId === "string" ? { providerMessageId: result.providerMessageId } : {}),
        ...(typeof result.code === "string" ? { code: result.code.slice(0, 80) } : {}),
      });
      if (!completed || completed.tenantId !== tenantId || recordId(completed) !== outboxId
        || completed.claimId !== claimed.claimId || completed.status !== result.status) {
        throw new Error("outbox-finish-conflict");
      }
      return Object.freeze({ outboxId, status: completed.status, ...(completed.providerMessageId ? { providerMessageId: completed.providerMessageId } : {}), ...(completed.code ? { code: completed.code } : {}) });
    },
  });
}
