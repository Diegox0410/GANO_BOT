import { randomBytes } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import {
  getGanoAdminFirestore,
  getGanoFirebaseAdminApp,
} from "../apps/functions/dist/integrations/firebaseAdmin.js";

const COLLECTION = "prospectPresentations";
const SCHEMA_VERSION = 1;
const ALLOWED_ORIGINS = new Set([
  "https://gano-sim.vercel.app",
  "http://localhost:5173", "http://localhost:5174", "http://localhost:5175",
  "http://127.0.0.1:5173", "http://127.0.0.1:5174", "http://127.0.0.1:5175",
]);
const SCENES = new Set(["intro", "company", "products", "ganoderma", "opportunity", "how-it-works", "story", "start", "interaction"]);
const SELECTIONS = Object.freeze({
  productCategory: new Set(["coffee", "drinks", "nutrition", "wellness", "ganoderma"]),
  participationMode: new Set(["consume", "share", "build"]),
  initialInterest: new Set(["products", "opportunity", "discovering"]),
  finalResult: new Set(["interested", "want_more_information", "questions", "products", "thinking"]),
});
const EVENT_TYPES = new Set(["presentation_opened", "presentation_started", "scene_viewed", "selection_changed", "audio_played", "presentation_completed", "contact_clicked"]);

const text = (value, max = 160) => typeof value === "string" ? value.trim().slice(0, max) : "";
const nowIso = () => new Date().toISOString();
const publicToken = () => randomBytes(24).toString("base64url");

function cors(request, response) {
  const origin = request.headers?.origin;
  if (typeof origin === "string" && ALLOWED_ORIGINS.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
}

function send(response, status, data = null, error = null) {
  response.status(status).json(error ? { success: false, error } : { success: true, data });
}

async function authenticate(request) {
  const authorization = request.headers?.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return null;
  return getAuth(getGanoFirebaseAdminApp()).verifyIdToken(authorization.slice(7));
}

async function findByToken(firestore, token) {
  if (!/^[A-Za-z0-9_-]{24,80}$/.test(token)) return null;
  const snapshot = await firestore.collection(COLLECTION).where("publicToken", "==", token).limit(1).get();
  return snapshot.empty ? null : snapshot.docs[0];
}

function publicDto(data) {
  return {
    id: data.id,
    token: data.publicToken,
    templateId: data.templateId,
    templateVersion: data.templateVersion,
    prospect: { firstName: data.prospectSnapshot.firstName },
    presenter: { displayName: data.presenterSnapshot.displayName },
    story: { presenterName: data.presenterSnapshot.displayName },
    status: data.status,
    progress: data.progressPercent,
    currentScene: data.lastSceneId,
    viewedScenes: data.sectionsViewed,
    selections: data.selections,
  };
}

function adminDto(data) {
  return {
    id: data.id, token: data.publicToken, personId: data.personId,
    presenter: { id: data.ownerUid, name: data.presenterSnapshot.displayName },
    prospect: { firstName: data.prospectSnapshot.firstName },
    templateId: data.templateId, status: data.status,
    createdAt: data.createdAt, startedAt: data.startedAt, completedAt: data.completedAt,
    progress: data.progressPercent, currentScene: data.lastSceneId,
    viewedScenes: data.sectionsViewed, selections: data.selections,
    durationSeconds: data.durationSeconds, version: data.schemaVersion,
  };
}

function validateEvent(body) {
  const type = text(body?.type, 40);
  if (!EVENT_TYPES.has(type)) throw new Error("INVALID_EVENT_TYPE");
  const detail = body?.detail && typeof body.detail === "object" ? body.detail : {};
  if (type === "scene_viewed" && !SCENES.has(text(detail.sceneId, 40))) throw new Error("INVALID_SCENE");
  if (type === "scene_viewed" && (!Number.isFinite(detail.progress) || detail.progress < 0 || detail.progress > 100)) throw new Error("INVALID_PROGRESS");
  if (type === "selection_changed") {
    const key = text(detail.key, 40);
    const value = text(detail.value, 80);
    if (!SELECTIONS[key]?.has(value)) throw new Error("INVALID_SELECTION");
  }
  return { type, detail };
}

async function recordEvent(firestore, reference, input, complete = false) {
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) return null;
    const session = snapshot.data();
    if (complete && session.status === "COMPLETED") return session;
    const occurredAt = nowIso();
    const patch = { updatedAt: occurredAt };
    if (input.type === "presentation_opened" && session.status === "CREATED") Object.assign(patch, { status: "OPENED", openedAt: session.openedAt ?? occurredAt });
    if (input.type === "presentation_started") Object.assign(patch, { status: session.status === "COMPLETED" ? "COMPLETED" : "IN_PROGRESS", startedAt: session.startedAt ?? occurredAt });
    if (input.type === "scene_viewed") Object.assign(patch, { status: session.status === "COMPLETED" ? "COMPLETED" : "IN_PROGRESS", lastSceneId: input.detail.sceneId, progressPercent: Math.round(input.detail.progress), sectionsViewed: [...new Set([...(session.sectionsViewed ?? []), input.detail.sceneId])] });
    if (input.type === "selection_changed") Object.assign(patch, { selections: { ...session.selections, [input.detail.key]: input.detail.value } });
    if (complete || input.type === "presentation_completed") {
      const started = Date.parse(session.startedAt ?? session.openedAt ?? session.createdAt);
      Object.assign(patch, { status: "COMPLETED", completedAt: occurredAt, progressPercent: 100, durationSeconds: Math.max(0, Math.round((Date.parse(occurredAt) - started) / 1000)) });
    }
    transaction.update(reference, patch);
    const eventReference = reference.collection("events").doc();
    transaction.set(eventReference, { type: input.type, sceneId: input.type === "scene_viewed" ? input.detail.sceneId : null, selectionKey: input.type === "selection_changed" ? input.detail.key : null, selectionValue: input.type === "selection_changed" ? input.detail.value : null, progressPercent: input.type === "scene_viewed" ? Math.round(input.detail.progress) : null, occurredAt, schemaVersion: SCHEMA_VERSION });
    return { ...session, ...patch };
  });
}

export default async function handler(request, response) {
  cors(request, response);
  if (request.method === "OPTIONS") {
    if (request.headers?.origin && !ALLOWED_ORIGINS.has(request.headers.origin)) return send(response, 403, null, { code: "CORS_ORIGIN_DENIED", message: "Origen no autorizado." });
    return response.status(204).end();
  }
  const token = text(request.query?.token, 100);
  try {
    if (request.method === "GET" && token) {
      const firestore = getGanoAdminFirestore();
      const document = await findByToken(firestore, token);
      if (!document) return send(response, 404, null, { code: "PRESENTATION_NOT_FOUND", message: "Presentación no encontrada." });
      await recordEvent(firestore, document.ref, { type: "presentation_opened", detail: {} });
      const refreshed = await document.ref.get();
      return send(response, 200, publicDto(refreshed.data()));
    }
    if (request.method === "POST" && token) {
      const firestore = getGanoAdminFirestore();
      const document = await findByToken(firestore, token);
      if (!document) return send(response, 404, null, { code: "PRESENTATION_NOT_FOUND", message: "Presentación no encontrada." });
      const action = text(request.query?.action, 20);
      const input = action === "complete" ? { type: "presentation_completed", detail: {} } : validateEvent(request.body);
      const updated = await recordEvent(firestore, document.ref, input, action === "complete");
      return send(response, 200, publicDto(updated));
    }
    const actor = await authenticate(request);
    if (!actor) return send(response, 401, null, { code: "UNAUTHENTICATED", message: "Se requiere autenticación Firebase." });
    const firestore = getGanoAdminFirestore();
    if (request.method === "POST") {
      const personId = text(request.body?.personId, 120);
      const firstName = text(request.body?.prospect?.firstName, 80);
      const displayName = text(actor.name, 100) || text(request.body?.presenter?.displayName, 100) || "Presentador";
      if (!personId || !firstName) return send(response, 400, null, { code: "INVALID_PRESENTATION", message: "personId y prospect.firstName son obligatorios." });
      const reference = firestore.collection(COLLECTION).doc();
      const createdAt = nowIso();
      const session = { id: reference.id, publicToken: publicToken(), tenantId: text(actor.tenant_id ?? actor.tenantId, 80) || "gano-sim", ownerUid: actor.uid, personId, templateId: "official", templateVersion: 1, status: "CREATED", prospectSnapshot: { firstName }, presenterSnapshot: { displayName }, createdAt, openedAt: null, startedAt: null, completedAt: null, updatedAt: createdAt, progressPercent: 0, lastSceneId: "intro", sectionsViewed: [], selections: { productCategory: null, participationMode: null, initialInterest: "exploring", finalResult: "thinking" }, durationSeconds: 0, question: null, nextIntent: null, schemaVersion: SCHEMA_VERSION };
      await reference.set(session);
      await reference.collection("events").add({ type: "presentation_created", occurredAt: createdAt, schemaVersion: SCHEMA_VERSION, actorUid: actor.uid });
      return send(response, 201, adminDto(session));
    }
    if (request.method === "GET") {
      const personId = text(request.query?.prospectId, 120);
      if (!personId) return send(response, 400, null, { code: "PROSPECT_ID_REQUIRED", message: "prospectId es obligatorio." });
      const snapshot = await firestore.collection(COLLECTION).where("ownerUid", "==", actor.uid).where("personId", "==", personId).get();
      const sessions = snapshot.docs.map((document) => adminDto(document.data())).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return send(response, 200, sessions);
    }
    return send(response, 405, null, { code: "METHOD_NOT_ALLOWED", message: "Método no permitido." });
  } catch (error) {
    if (["INVALID_EVENT_TYPE", "INVALID_SCENE", "INVALID_PROGRESS", "INVALID_SELECTION"].includes(error?.message)) return send(response, 400, null, { code: error.message, message: "Evento de presentación inválido." });
    if (error?.code?.startsWith?.("auth/")) return send(response, 401, null, { code: "INVALID_ID_TOKEN", message: "Token Firebase inválido." });
    console.error("[presentations]", error instanceof Error ? error.message : "unknown");
    return send(response, 500, null, { code: "PRESENTATION_BACKEND_ERROR", message: "No fue posible procesar la presentación." });
  }
}

export { adminDto, publicDto, validateEvent };
