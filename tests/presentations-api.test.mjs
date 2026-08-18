import assert from "node:assert/strict";
import test from "node:test";
import handler, { adminDto, publicDto, validateEvent } from "../api/presentations.mjs";

const session = {
  id: "session-1", publicToken: "secure-public-token-123456789", tenantId: "gano-sim", ownerUid: "owner-private", personId: "person-private",
  templateId: "official", templateVersion: 1, status: "IN_PROGRESS",
  prospectSnapshot: { firstName: "Carlos", email: "never-public@example.com" }, presenterSnapshot: { displayName: "Diego" },
  createdAt: "2026-08-18T00:00:00.000Z", startedAt: "2026-08-18T00:01:00.000Z", completedAt: null,
  progressPercent: 35, lastSceneId: "products", sectionsViewed: ["intro", "products"],
  selections: { productCategory: "coffee", participationMode: "consume", initialInterest: "products", finalResult: "thinking" },
  durationSeconds: 0, schemaVersion: 1,
};

test("PublicPresentation omite campos administrativos", () => {
  const dto = publicDto(session);
  const serialized = JSON.stringify(dto);
  assert.equal(dto.prospect.firstName, "Carlos");
  assert.equal("personId" in dto, false);
  assert.equal(serialized.includes("owner-private"), false);
  assert.equal(serialized.includes("person-private"), false);
  assert.equal(serialized.includes("never-public@example.com"), false);
});

test("DTO administrativo conserva relación y resultados", () => {
  const dto = adminDto(session);
  assert.equal(dto.personId, "person-private");
  assert.equal(dto.selections.productCategory, "coffee");
});

test("valida eventos y rechaza valores no permitidos", () => {
  assert.deepEqual(validateEvent({ type: "scene_viewed", detail: { sceneId: "products", progress: 25 } }).detail, { sceneId: "products", progress: 25 });
  assert.throws(() => validateEvent({ type: "scene_viewed", detail: { sceneId: "private", progress: 25 } }), /INVALID_SCENE/);
  assert.throws(() => validateEvent({ type: "selection_changed", detail: { key: "ownerUid", value: "attacker" } }), /INVALID_SELECTION/);
  assert.throws(() => validateEvent({ type: "arbitrary_write", detail: {} }), /INVALID_EVENT_TYPE/);
});

test("crear presentación sin autenticación responde 401", async () => {
  const result = { status: 0, payload: null };
  const response = {
    setHeader() {},
    status(code) { result.status = code; return this; },
    json(payload) { result.payload = payload; return this; },
    end() { return this; },
  };
  await handler({ method: "POST", headers: {}, query: {}, body: {} }, response);
  assert.equal(result.status, 401);
  assert.equal(result.payload.error.code, "UNAUTHENTICATED");
});
