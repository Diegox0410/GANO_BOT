import assert from "node:assert/strict";
import test from "node:test";
import { FirestoreConversationRepository } from "../apps/functions/dist/integrations/firestoreConversationRepository.js";
import { FirestoreKnowledgeManagerRepository } from "../apps/functions/dist/integrations/firestoreKnowledgeManagerRepository.js";
import { resolveHostedFirestoreCollections } from "../scripts/hosted-firestore-collections.mjs";

test("Preview uses distinct collection names for every hosted persistence adapter", () => {
  const production = resolveHostedFirestoreCollections({ VERCEL_ENV: "production" });
  const preview = resolveHostedFirestoreCollections({ VERCEL_ENV: "preview" });
  assert.deepEqual(resolveHostedFirestoreCollections({}), production);
  assert.equal(preview.conversations, "ganobot_runtime_preview");
  assert.equal(preview.channelDeliveries, "ganobot_channel_deliveries_preview");
  for (const key of Object.keys(production)) assert.notEqual(preview[key], production[key]);
});

test("same tenant and conversation ID cannot read or overwrite production from Preview", async () => {
  const stored = new Map();
  function collection(path) {
    return { doc(id) { const full = `${path}/${id}`; return { collection(name) { return collection(`${full}/${name}`); }, async set(value) { stored.set(full, structuredClone(value)); }, async get() { return { exists: stored.has(full), data() { return stored.get(full); } }; } }; } };
  }
  const firestore = { collection };
  const production = new FirestoreConversationRepository(firestore, resolveHostedFirestoreCollections({ VERCEL_ENV: "production" }).conversations);
  const preview = new FirestoreConversationRepository(firestore, resolveHostedFirestoreCollections({ VERCEL_ENV: "preview" }).conversations);
  const value = { id: "whatsapp-same", tenantId: "tenant-floes", assistantId: "commerce-assistant", ownerId: "customer-1", messages: [], createdAt: "2026-10-09T00:00:00Z", updatedAt: "2026-10-09T00:00:00Z" };
  await production.save(value);
  assert.equal(await preview.get(value.tenantId, value.assistantId, value.id, value.ownerId), undefined);
  await preview.save({ ...value, messages: [{ role: "user", content: "Preview only" }] });
  assert.deepEqual((await production.get(value.tenantId, value.assistantId, value.id, value.ownerId)).messages, []);
  assert.equal(stored.size, 2);
});

test("Preview knowledge initialization uses an isolated root collection", async () => {
  const written = [];
  const repository = new FirestoreKnowledgeManagerRepository({ collection(path) { return { doc(id) { return { async set(value) { written.push({ path, id, value }); } }; } }; } }, resolveHostedFirestoreCollections({ VERCEL_ENV: "preview" }).knowledgeRoot);
  await repository.saveBase({ tenantId: "gano-sim", knowledgeBaseId: "base-preview", name: "gano-public" });
  assert.equal(written[0].path, "ganoKnowledgePreview_bases");
});
