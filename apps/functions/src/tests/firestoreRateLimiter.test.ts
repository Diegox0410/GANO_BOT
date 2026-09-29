import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import { FirestoreRateLimiter } from "../integrations/firestoreRateLimiter.js";

const values = new Map<string, unknown>();
const firestore = {
  collection: (name: string) => ({ doc: (id: string) => ({ path: `${name}/${id}` }) }),
  runTransaction: async <T>(callback: (transaction: {
    get: (reference: { readonly path: string }) => Promise<{ readonly exists: boolean; data: () => unknown }>;
    set: (reference: { readonly path: string }, value: unknown) => void;
  }) => Promise<T>) => callback({
    get: async (reference) => ({
      exists: values.has(reference.path),
      data: () => values.get(reference.path),
    }),
    set: (reference, value) => { values.set(reference.path, structuredClone(value)); },
  }),
} as unknown as Firestore;

const firstInstance = new FirestoreRateLimiter(firestore);
const policy = Object.freeze({ limit: 2, windowMilliseconds: 60_000 });
assert.equal((await firstInstance.consume("tenant-a:user-a", policy, 1_000)).allowed, true);

const secondInstance = new FirestoreRateLimiter(firestore);
assert.equal((await secondInstance.consume("tenant-a:user-a", policy, 1_001)).allowed, true);
const blocked = await secondInstance.consume("tenant-a:user-a", policy, 1_002);
assert.equal(blocked.allowed, false);
assert.equal(blocked.remaining, 0);
assert.equal((await secondInstance.consume("tenant-b:user-a", policy, 1_002)).allowed, true);
assert.equal((await secondInstance.consume("tenant-a:user-a", policy, 61_001)).allowed, true);

console.log("Firestore rate limit: distributed bucket, reset y tenant key isolation OK");
