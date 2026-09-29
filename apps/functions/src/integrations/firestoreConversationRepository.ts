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
  ): Promise<readonly ConversationApiResource[]> {
    const query = others
      ? this.conversations(tenantId)
      : this.conversations(tenantId).where("ownerId", "==", actorId);
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
