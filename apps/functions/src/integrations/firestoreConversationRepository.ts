import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type {
  ConversationApiResource,
  ConversationRepository,
} from "../contracts.js";

function safe(value: string): string {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    throw new Error("Identificador de conversación inválido.");
  }
  return value;
}

function clone(value: ConversationApiResource): ConversationApiResource {
  return structuredClone(value);
}

export class FirestoreConversationRepository implements ConversationRepository {
  public constructor(
    private readonly firestore: Firestore,
    private readonly rootCollection = "ganobot_runtime",
    private readonly lockMaxAttempts = 6,
  ) {}

  private conversations(tenantId: string) {
    return this.firestore
      .collection(this.rootCollection)
      .doc(safe(tenantId))
      .collection("conversations");
  }

  private document(tenantId: string, assistantId: string, id: string) {
    return this.conversations(tenantId).doc(`${safe(assistantId)}__${safe(id)}`);
  }

  private lockDocument(tenantId: string, assistantId: string, id: string) {
    return this.firestore
      .collection(this.rootCollection)
      .doc(safe(tenantId))
      .collection("conversationLocks")
      .doc(`${safe(assistantId)}__${safe(id)}`);
  }

  public async withConversationLock<T>(
    tenantId: string,
    assistantId: string,
    id: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const reference = this.lockDocument(tenantId, assistantId, id);
    const ownerId = randomUUID();
    let acquired = false;
    for (let attempt = 0; !acquired && attempt < this.lockMaxAttempts; attempt += 1) {
      await this.firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const current = snapshot.exists
          ? snapshot.data() as { ownerId?: unknown; expiresAt?: unknown }
          : undefined;
        const expiresAt = typeof current?.expiresAt === "number"
          ? current.expiresAt
          : 0;
        if (expiresAt > Date.now()) return;
        transaction.set(reference, {
          ownerId,
          expiresAt: Date.now() + 240_000,
        });
        acquired = true;
      });
      if (!acquired && attempt + 1 < this.lockMaxAttempts) {
        const delay = Math.min(500, 75 * 2 ** attempt) * (0.8 + Math.random() * 0.4);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    if (!acquired) throw new Error("La conversación está ocupada; reintenta el turno.");

    try {
      return await operation();
    } finally {
      await this.firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const current = snapshot.exists
          ? snapshot.data() as { ownerId?: unknown }
          : undefined;
        if (current?.ownerId === ownerId) transaction.delete(reference);
      }).catch(() => undefined);
    }
  }

  public async save(value: ConversationApiResource): Promise<void> {
    await this.document(value.tenantId, value.assistantId, value.id).set(clone(value), {
      merge: false,
    });
  }

  public async get(
    tenantId: string,
    assistantId: string,
    id: string,
    actorId: string,
    others = false,
  ): Promise<ConversationApiResource | undefined> {
    const snapshot = await this.document(tenantId, assistantId, id).get();
    const value = snapshot.exists
      ? snapshot.data() as ConversationApiResource
      : undefined;
    if (
      value === undefined ||
      value.tenantId !== tenantId ||
      value.assistantId !== assistantId ||
      value.id !== id ||
      (!others && value.ownerId !== actorId)
    ) {
      return undefined;
    }
    return clone(value);
  }

  public async list(
    tenantId: string,
    actorId: string,
    others = false,
    limit = 25,
    cursor?: { readonly updatedAt: string; readonly assistantId: string; readonly id: string },
  ): Promise<readonly ConversationApiResource[]> {
    let query = (others
      ? this.conversations(tenantId)
      : this.conversations(tenantId).where("ownerId", "==", actorId))
      .orderBy("updatedAt", "desc")
      .orderBy("__name__", "desc");
    if (cursor) query = query.startAfter(cursor.updatedAt, `${safe(cursor.assistantId)}__${safe(cursor.id)}`);
    query = query.limit(Math.min(Math.max(1, limit), 26));
    const snapshot = await query.get();
    return Object.freeze(
      snapshot.docs
        .map((document) => document.data() as ConversationApiResource)
        .filter(
          (value) =>
            value.tenantId === tenantId && (others || value.ownerId === actorId),
        )
        .map(clone),
    );
  }

  public async delete(
    tenantId: string,
    assistantId: string,
    id: string,
    actorId: string,
    others = false,
  ): Promise<boolean> {
    const value = await this.get(tenantId, assistantId, id, actorId, others);
    if (value === undefined) return false;
    await this.document(tenantId, assistantId, id).delete();
    return true;
  }
}
