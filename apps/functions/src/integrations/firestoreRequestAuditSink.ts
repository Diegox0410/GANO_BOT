import type { Firestore } from "firebase-admin/firestore";
import type { RequestAuditEvent, RequestAuditSink } from "../contracts.js";

function safe(value: string): string {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    throw new Error("Identificador de auditoría inválido.");
  }
  return value;
}

export class FirestoreRequestAuditSink implements RequestAuditSink {
  public constructor(
    private readonly firestore: Firestore,
    private readonly collectionName = "ganobot_request_audit",
  ) {}

  public async write(event: RequestAuditEvent): Promise<void> {
    await this.firestore
      .collection(this.collectionName)
      .doc(`${safe(event.tenantId)}__${safe(event.requestId)}`)
      .set(structuredClone(event), { merge: false });
  }
}
