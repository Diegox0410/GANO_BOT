import type { Firestore } from "firebase-admin/firestore";
import type { StudioAssistantConfiguration, StudioPublishedVersion, StudioRepository } from "./contracts.js";

function safe(value: string): string {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new Error("Identificador Studio inválido.");
  return value;
}

export class FirestoreStudioRepository implements StudioRepository {
  public constructor(private readonly db: Firestore, private readonly prefix = "ganobot_studio") {}

  private tenant(tenantId: string) { return this.db.collection(this.prefix).doc(safe(tenantId)); }
  private assistants(tenantId: string) { return this.tenant(tenantId).collection("assistants"); }
  private published(tenantId: string) { return this.tenant(tenantId).collection("published"); }

  async list(tenantId: string): Promise<readonly StudioAssistantConfiguration[]> {
    const snap = await this.assistants(tenantId).get();
    return Object.freeze(
      snap.docs
        .map(doc => doc.data() as StudioAssistantConfiguration)
        .filter(value => value.tenantId === tenantId),
    );
  }
  async get(tenantId: string, assistantId: string): Promise<StudioAssistantConfiguration | undefined> {
    const snap = await this.assistants(tenantId).doc(safe(assistantId)).get();
    const value = snap.exists ? snap.data() as StudioAssistantConfiguration : undefined;
    return value?.tenantId === tenantId && value.id === assistantId ? value : undefined;
  }
  async save(value: StudioAssistantConfiguration): Promise<void> {
    await this.assistants(value.tenantId).doc(safe(value.id)).set(value, { merge: false });
  }
  async remove(tenantId: string, assistantId: string): Promise<void> {
    await this.assistants(tenantId).doc(safe(assistantId)).delete();
  }
  async getPublished(tenantId: string, assistantId: string): Promise<StudioPublishedVersion | undefined> {
    const snap = await this.published(tenantId).doc(safe(assistantId)).get();
    const value = snap.exists ? snap.data() as StudioPublishedVersion : undefined;
    return value?.tenantId === tenantId && value.assistantId === assistantId ? value : undefined;
  }
  async savePublished(value: StudioPublishedVersion): Promise<void> {
    await this.published(value.tenantId).doc(safe(value.assistantId)).set(value, { merge: false });
  }
}
