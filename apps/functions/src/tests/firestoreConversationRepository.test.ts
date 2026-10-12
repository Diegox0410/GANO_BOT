import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import type { ConversationApiResource } from "../contracts.js";
import { FirestoreConversationRepository } from "../integrations/firestoreConversationRepository.js";

const values = new Map<string, unknown>();
let transactionQueue = Promise.resolve();
let transactionReads = 0;

function document(path: string) {
  return {
    collection: (name: string) => collection(`${path}/${name}`),
    set: async (value: unknown) => { values.set(path, structuredClone(value)); },
    get: async () => ({
      exists: values.has(path),
      data: () => structuredClone(values.get(path)),
    }),
    delete: async () => { values.delete(path); },
  };
}

function documents(path: string) {
  return [...values.entries()]
    .filter(([key]) => key.startsWith(`${path}/`))
    .map(([, value]) => ({ data: () => structuredClone(value) }));
}

function collection(path: string) {
  const makeQuery = (field?: string, expected?: unknown, maximum = Infinity) => {
    const query = {
      get: async () => ({
        docs: documents(path)
          .filter((entry) => {
            if (!field) return true;
            const value = entry.data();
            return typeof value === "object" && value !== null &&
              (value as Readonly<Record<string, unknown>>)[field] === expected;
          })
          .slice(0, maximum),
      }),
      where: (nextField: string, _operator: string, nextExpected: unknown) => makeQuery(nextField, nextExpected, maximum),
      orderBy: () => query,
      startAfter: () => query,
      limit: (value: number) => makeQuery(field, expected, value),
    };
    return query;
  };
  return {
    doc: (id: string) => document(`${path}/${id}`),
    get: async () => ({ docs: documents(path) }),
    where: (field: string, operator: string, expected: unknown) => makeQuery().where(field, operator, expected),
    orderBy: () => makeQuery(),
  };
}

const firestore = {
  collection,
  async runTransaction<T>(operation: (transaction: {
    get: (reference: ReturnType<typeof document>) => Promise<{ exists: boolean; data: () => unknown }>;
    set: (reference: ReturnType<typeof document>, value: unknown) => unknown;
    delete: (reference: ReturnType<typeof document>) => unknown;
  }) => Promise<T>): Promise<T> {
    let release: () => void = () => {};
    const previous = transactionQueue;
    transactionQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation({
        get: async (reference) => { transactionReads += 1; return reference.get(); },
        set: (reference, value) => reference.set(value),
        delete: (reference) => reference.delete(),
      });
    } finally {
      release();
    }
  },
} as unknown as Firestore;
const firstInstance = new FirestoreConversationRepository(firestore);
const conversation: ConversationApiResource = Object.freeze({
  id: "conversation-1",
  tenantId: "tenant-floes",
  assistantId: "commerce-assistant",
  ownerId: "customer-1",
  messages: Object.freeze([]),
  createdAt: "2026-09-28T00:00:00.000Z",
  updatedAt: "2026-09-28T00:00:00.000Z",
});
await firstInstance.save(conversation);

const restartedInstance = new FirestoreConversationRepository(firestore);
assert.deepEqual(
  await restartedInstance.get(
    "tenant-floes",
    "commerce-assistant",
    "conversation-1",
    "customer-1",
  ),
  conversation,
);
assert.equal(
  await restartedInstance.get(
    "tenant-other",
    "commerce-assistant",
    "conversation-1",
    "customer-1",
  ),
  undefined,
);
assert.equal(
  await restartedInstance.get(
    "tenant-floes",
    "commerce-assistant",
    "conversation-1",
    "customer-other",
  ),
  undefined,
);
assert.equal((await restartedInstance.list("tenant-floes", "customer-1")).length, 1);
assert.equal(await restartedInstance.delete("tenant-floes", "commerce-assistant", "conversation-1", "customer-other"), false);
assert.equal(await restartedInstance.delete("tenant-floes", "commerce-assistant", "conversation-1", "customer-1"), true);

let activeTurns = 0;
let maximumConcurrentTurns = 0;
const enterConversation = async () => firstInstance.withConversationLock(
  "tenant-floes",
  "commerce-assistant",
  "whatsapp-customer-1",
  async () => {
    activeTurns += 1;
    maximumConcurrentTurns = Math.max(maximumConcurrentTurns, activeTurns);
    await new Promise((resolve) => setTimeout(resolve, 30));
    activeTurns -= 1;
  },
);
await Promise.all([enterConversation(), restartedInstance.withConversationLock(
  "tenant-floes",
  "commerce-assistant",
  "whatsapp-customer-1",
  async () => {
    activeTurns += 1;
    maximumConcurrentTurns = Math.max(maximumConcurrentTurns, activeTurns);
    await new Promise((resolve) => setTimeout(resolve, 30));
    activeTurns -= 1;
  },
)]);
assert.equal(maximumConcurrentTurns, 1);

values.set("ganobot_runtime/tenant-floes/conversationLocks/commerce-assistant__busy", {
  ownerId: "another-request",
  expiresAt: Date.now() + 60_000,
});
transactionReads = 0;
const boundedLockRepository = new FirestoreConversationRepository(firestore, "ganobot_runtime", 3);
await assert.rejects(
  boundedLockRepository.withConversationLock("tenant-floes", "commerce-assistant", "busy", async () => undefined),
  /conversación está ocupada/,
);
assert.equal(transactionReads, 3, "lock contention must have a bounded number of Firestore transaction reads");

console.log("Firestore conversations: persistence, tenant isolation y distributed conversation lock OK");
