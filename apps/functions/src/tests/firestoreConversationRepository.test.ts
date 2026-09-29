import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import type { ConversationApiResource } from "../contracts.js";
import { FirestoreConversationRepository } from "../integrations/firestoreConversationRepository.js";

const values = new Map<string, unknown>();

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
  return {
    doc: (id: string) => document(`${path}/${id}`),
    get: async () => ({ docs: documents(path) }),
    where: (field: string, _operator: string, expected: unknown) => ({
      get: async () => ({
        docs: documents(path).filter((entry) => {
          const value = entry.data();
          return typeof value === "object" && value !== null &&
            (value as Readonly<Record<string, unknown>>)[field] === expected;
        }),
      }),
    }),
  };
}

const firestore = { collection } as unknown as Firestore;
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

console.log("Firestore conversations: restart, round-trip, owner y tenant isolation OK");
