import assert from "node:assert/strict";
import test from "node:test";
import { createChannelOutboxWorker } from "../scripts/channel-outbox-worker.mjs";

const tenantId = "tenant-floes";
const outboxId = "channel_outbox_0123456789abcdef";
const now = () => new Date("2026-10-13T12:00:00.000Z");

function createRepository({ initiallyOwned = true } = {}) {
  const row = {
    tenantId, outboxId, status: "NOT_SENT", provider: "WEB", channel: "WEB",
    conversationId: `conversation_${"a".repeat(64)}`, customerId: "customer-1", text: "Respuesta fake",
  };
  let sequence = 0;
  let aiOwnsConversation = initiallyOwned;
  const repository = {
    row,
    setAiOwnership(value) { aiOwnsConversation = value; },
    async claimChannelOutbox(tenant, id, workerId, options) {
      if (tenant !== row.tenantId || id !== row.outboxId) return null;
      if (row.status !== "NOT_SENT" && !(row.status === "CLAIMED" && Date.parse(row.leaseUntil) <= options.now.valueOf())) return null;
      Object.assign(row, { status: "CLAIMED", claimId: `claim-${++sequence}`, leaseOwner: workerId,
        leaseUntil: new Date(options.now.valueOf() + 30_000).toISOString(), attempts: (row.attempts || 0) + 1 });
      return { ...row };
    },
    async markChannelOutboxSending(tenant, id, claimId) {
      if (tenant !== row.tenantId || id !== row.outboxId || row.claimId !== claimId || row.status !== "CLAIMED") throw new Error("OUTBOX_CLAIM_LOST");
      if (!aiOwnsConversation) throw new Error("AUTOMATION_BLOCKED_BY_HANDOFF");
      row.status = "SENDING";
      return { ...row };
    },
    async finishChannelOutbox(tenant, id, claimId, result) {
      if (tenant !== row.tenantId || id !== row.outboxId || row.claimId !== claimId || row.status !== "SENDING") throw new Error("OUTBOX_CLAIM_LOST");
      Object.assign(row, result);
      return { ...row };
    },
  };
  return repository;
}

function worker(repository, send, workerId = "worker-a") {
  return createChannelOutboxWorker({ repository, transport: { send }, workerId, allowedTenantIds: [tenantId], now });
}

test("concurrent workers atomically claim once and send with Chopify outbox ID as idempotency key", async () => {
  const repository = createRepository();
  const sent = [];
  const transport = async envelope => { sent.push(envelope); return { status: "SENT", providerMessageId: "fake-provider-1" }; };
  const first = worker(repository, transport, "worker-a");
  const second = worker(repository, transport, "worker-b");
  const outcomes = await Promise.all([first.dispatchOnce(tenantId, outboxId), second.dispatchOnce(tenantId, outboxId)]);
  assert.equal(outcomes.filter(item => item.status === "SENT").length, 1);
  assert.equal(outcomes.filter(item => item.status === "NOT_CLAIMABLE").length, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.idempotencyKey, outboxId);
  assert.equal(sent[0]?.tenantId, tenantId);
  assert.equal(repository.row.attempts, 1);
});

test("a stale CLAIMED lease can be recovered once by a new worker", async () => {
  const repository = createRepository();
  Object.assign(repository.row, { status: "CLAIMED", claimId: "claim-expired", leaseOwner: "worker-old", leaseUntil: "2026-10-13T11:59:00.000Z", attempts: 1 });
  let sends = 0;
  const restartedWorker = worker(repository, async request => {
    sends += 1;
    assert.equal(request.idempotencyKey, outboxId);
    return { status: "SENT" };
  }, "worker-restart");
  assert.equal((await restartedWorker.dispatchOnce(tenantId, outboxId)).status, "SENT");
  assert.equal(repository.row.attempts, 2);
  assert.equal(repository.row.leaseOwner, "worker-restart");
  assert.equal(sends, 1);
});

test("takeover between claim and send blocks transport before any provider call", async () => {
  const repository = createRepository();
  let sends = 0;
  const originalMark = repository.markChannelOutboxSending;
  repository.markChannelOutboxSending = async (...args) => {
    repository.setAiOwnership(false);
    if (repository.row.status === "CLAIMED") {
      repository.row.status = "BLOCKED";
      repository.row.code = "AUTOMATION_BLOCKED_BY_HANDOFF";
      repository.row.leaseOwner = "";
      repository.row.leaseUntil = "";
      return { ...repository.row };
    }
    return originalMark(...args);
  };
  const guardedWorker = createChannelOutboxWorker({
    repository,
    workerId: "worker-a",
    allowedTenantIds: [tenantId],
    now,
    transport: { async send() { sends += 1; return { status: "SENT" }; } },
  });
  assert.deepEqual(await guardedWorker.dispatchOnce(tenantId, outboxId), { outboxId, status: "BLOCKED", code: "AUTOMATION_BLOCKED_BY_HANDOFF" });
  assert.equal(sends, 0);
  assert.equal(repository.row.status, "BLOCKED");
  repository.setAiOwnership(true);
  assert.equal((await worker(repository, async () => { sends += 1; return { status: "SENT" }; }, "worker-after-handback").dispatchOnce(tenantId, outboxId)).status, "NOT_CLAIMABLE");
  assert.equal(sends, 0);
});

test("an ambiguous transport exception records UNKNOWN and restart never resends", async () => {
  const repository = createRepository();
  let sends = 0;
  const firstRun = worker(repository, async () => {
    sends += 1;
    throw new Error("connection dropped after provider acceptance");
  });
  const outcome = await firstRun.dispatchOnce(tenantId, outboxId);
  assert.deepEqual(outcome, { outboxId, status: "UNKNOWN", code: "TRANSPORT_RESULT_UNCERTAIN" });
  const restartedWorker = worker(repository, async () => { sends += 1; return { status: "SENT" }; }, "worker-restart");
  assert.equal((await restartedWorker.dispatchOnce(tenantId, outboxId)).status, "NOT_CLAIMABLE");
  assert.equal(repository.row.status, "UNKNOWN");
  assert.equal(sends, 1);
});

test("transport timeout aborts within the lease window and records UNKNOWN without retry", async () => {
  const repository = createRepository();
  let sends = 0;
  const timedWorker = createChannelOutboxWorker({
    repository,
    workerId: "worker-a",
    allowedTenantIds: [tenantId],
    now,
    transportTimeoutMs: 10,
    transport: {
      async send({ signal }) {
        sends += 1;
        return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      },
    },
  });
  const result = await timedWorker.dispatchOnce(tenantId, outboxId);
  assert.deepEqual(result, { outboxId, status: "UNKNOWN", code: "TRANSPORT_TIMEOUT" });
  assert.equal(repository.row.status, "UNKNOWN");
  assert.equal(sends, 1);
});

test("finish failure after transport success leaves SENDING non-retryable for reconciliation", async () => {
  const repository = createRepository();
  const originalFinish = repository.finishChannelOutbox;
  repository.finishChannelOutbox = async () => { throw new Error("synthetic-finish-write-failure"); };
  let sends = 0;
  const firstRun = worker(repository, async request => {
    sends += 1;
    assert.equal(request.idempotencyKey, outboxId);
    return { status: "SENT" };
  });
  await assert.rejects(() => firstRun.dispatchOnce(tenantId, outboxId), /synthetic-finish-write-failure/);
  repository.finishChannelOutbox = originalFinish;
  repository.row.leaseUntil = "2026-10-13T11:59:00.000Z";
  const restartedWorker = worker(repository, async () => { sends += 1; return { status: "SENT" }; }, "worker-restart");
  assert.equal((await restartedWorker.dispatchOnce(tenantId, outboxId)).status, "NOT_CLAIMABLE");
  assert.equal(repository.row.status, "SENDING");
  assert.equal(sends, 1);
});

test("tenant, claim and transport result validation fail closed", async () => {
  const repository = createRepository();
  let sends = 0;
  const instance = worker(repository, async () => { sends += 1; return { status: "MAYBE" }; });
  await assert.rejects(() => instance.dispatchOnce("tenant-other", outboxId), /tenant-not-allowed/);
  repository.claimChannelOutbox = async () => ({ ...repository.row, tenantId: "tenant-other", status: "CLAIMED", claimId: "claim-1", leaseOwner: "worker-a" });
  const invalidClaimWorker = worker(repository, async () => { sends += 1; return { status: "SENT" }; });
  await assert.rejects(() => invalidClaimWorker.dispatchOnce(tenantId, outboxId), /invalid-outbox-claim/);
  assert.equal(sends, 0);
});
