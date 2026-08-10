import type {
  Firestore,
} from "firebase-admin/firestore";

import type {
  KnowledgeActivity,
  KnowledgeCollection,
  KnowledgeFolder,
  KnowledgeManagerRepository,
  KnowledgeVersion,
  ManagedDocument,
  ManagedKnowledgeBase,
} from "@gano-bot/ai-core/knowledge-manager";
const ROOT_COLLECTION =
  "ganoKnowledge";

const COLLECTIONS =
  Object.freeze({
    bases:
      "bases",

    documents:
      "documents",

    folders:
      "folders",

    collections:
      "collections",

    versions:
      "versions",

    activity:
      "activity",
  });

function firestoreId(
  tenantId: string,
  resourceId: string,
): string {
  return `${tenantId}__${resourceId}`;
}

function cloneForFirestore<T>(
  value: T,
): T {
  return JSON.parse(
    JSON.stringify(
      value,
    ),
  ) as T;
}

export class FirestoreKnowledgeManagerRepository
  implements KnowledgeManagerRepository
{
  public constructor(
    private readonly firestore:
      Firestore,
  ) {}
  
  private collection(
    name: string,
  ) {
    return this.firestore.collection(
      `${ROOT_COLLECTION}_${name}`,
    );
  }

  public async saveBase(
    value: ManagedKnowledgeBase,
  ): Promise<void> {
    await this.collection(
      COLLECTIONS.bases,
    )
      .doc(
        firestoreId(
          value.tenantId,
          value.knowledgeBaseId,
        ),
      )
      .set(
        cloneForFirestore(
          value,
        ),
      );
  }

  public async getBase(
    tenantId: string,
    id: string,
  ): Promise<
    ManagedKnowledgeBase |
    undefined
  > {
    const snapshot =
      await this.collection(
        COLLECTIONS.bases,
      )
        .doc(
          firestoreId(
            tenantId,
            id,
          ),
        )
        .get();

    if (!snapshot.exists) {
      return undefined;
    }

    return Object.freeze(
      snapshot.data() as
        ManagedKnowledgeBase,
    );
  }

  public async listBases(
    tenantId: string,
  ): Promise<
    readonly ManagedKnowledgeBase[]
  > {
    const snapshot =
      await this.collection(
        COLLECTIONS.bases,
      )
        .where(
          "tenantId",
          "==",
          tenantId,
        )
        .get();

    return Object.freeze(
      snapshot.docs.map(
        (document) =>
          Object.freeze(
            document.data() as
              ManagedKnowledgeBase,
          ),
      ),
    );
  }

  public async deleteBase(
    tenantId: string,
    id: string,
  ): Promise<boolean> {
    const reference =
      this.collection(
        COLLECTIONS.bases,
      ).doc(
        firestoreId(
          tenantId,
          id,
        ),
      );

    const snapshot =
      await reference.get();

    if (!snapshot.exists) {
      return false;
    }

    await reference.delete();

    return true;
  }

  public async saveDocument(
    value: ManagedDocument,
  ): Promise<void> {
    await this.collection(
      COLLECTIONS.documents,
    )
      .doc(
        firestoreId(
          value.tenantId,
          value.documentId,
        ),
      )
      .set(
        cloneForFirestore(
          value,
        ),
      );
  }

  public async getDocument(
    tenantId: string,
    id: string,
  ): Promise<
    ManagedDocument |
    undefined
  > {
    const snapshot =
      await this.collection(
        COLLECTIONS.documents,
      )
        .doc(
          firestoreId(
            tenantId,
            id,
          ),
        )
        .get();

    if (!snapshot.exists) {
      return undefined;
    }

    return Object.freeze(
      snapshot.data() as
        ManagedDocument,
    );
  }

  public async listDocuments(
    tenantId: string,
    baseId?: string,
  ): Promise<
    readonly ManagedDocument[]
  > {
    let query =
      this.collection(
        COLLECTIONS.documents,
      ).where(
        "tenantId",
        "==",
        tenantId,
      );

    if (baseId) {
      query =
        query.where(
          "knowledgeBaseId",
          "==",
          baseId,
        );
    }

    const snapshot =
      await query.get();

    return Object.freeze(
      snapshot.docs.map(
        (document) =>
          Object.freeze(
            document.data() as
              ManagedDocument,
          ),
      ),
    );
  }

  public async deleteDocument(
    tenantId: string,
    id: string,
  ): Promise<boolean> {
    const reference =
      this.collection(
        COLLECTIONS.documents,
      ).doc(
        firestoreId(
          tenantId,
          id,
        ),
      );

    const snapshot =
      await reference.get();

    if (!snapshot.exists) {
      return false;
    }

    await reference.delete();

    return true;
  }

  public async saveFolder(
    value: KnowledgeFolder,
  ): Promise<void> {
    await this.collection(
      COLLECTIONS.folders,
    )
      .doc(
        firestoreId(
          value.tenantId,
          value.folderId,
        ),
      )
      .set(
        cloneForFirestore(
          value,
        ),
      );
  }

  public async deleteFolder(
    tenantId: string,
    id: string,
  ): Promise<boolean> {
    const reference =
      this.collection(
        COLLECTIONS.folders,
      ).doc(
        firestoreId(
          tenantId,
          id,
        ),
      );

    const snapshot =
      await reference.get();

    if (!snapshot.exists) {
      return false;
    }

    await reference.delete();

    return true;
  }

  public async listFolders(
    tenantId: string,
    baseId: string,
  ): Promise<
    readonly KnowledgeFolder[]
  > {
    const snapshot =
      await this.collection(
        COLLECTIONS.folders,
      )
        .where(
          "tenantId",
          "==",
          tenantId,
        )
        .where(
          "knowledgeBaseId",
          "==",
          baseId,
        )
        .get();

    return Object.freeze(
      snapshot.docs.map(
        (document) =>
          Object.freeze(
            document.data() as
              KnowledgeFolder,
          ),
      ),
    );
  }

  public async saveCollection(
    value: KnowledgeCollection,
  ): Promise<void> {
    await this.collection(
      COLLECTIONS.collections,
    )
      .doc(
        firestoreId(
          value.tenantId,
          value.collectionId,
        ),
      )
      .set(
        cloneForFirestore(
          value,
        ),
      );
  }

  public async deleteCollection(
    tenantId: string,
    id: string,
  ): Promise<boolean> {
    const reference =
      this.collection(
        COLLECTIONS.collections,
      ).doc(
        firestoreId(
          tenantId,
          id,
        ),
      );

    const snapshot =
      await reference.get();

    if (!snapshot.exists) {
      return false;
    }

    await reference.delete();

    return true;
  }

  public async listCollections(
    tenantId: string,
    baseId: string,
  ): Promise<
    readonly KnowledgeCollection[]
  > {
    const snapshot =
      await this.collection(
        COLLECTIONS.collections,
      )
        .where(
          "tenantId",
          "==",
          tenantId,
        )
        .where(
          "knowledgeBaseId",
          "==",
          baseId,
        )
        .get();

    return Object.freeze(
      snapshot.docs.map(
        (document) =>
          Object.freeze(
            document.data() as
              KnowledgeCollection,
          ),
      ),
    );
  }

  public async saveVersion<T>(
    value: KnowledgeVersion<T>,
  ): Promise<void> {
    await this.collection(
      COLLECTIONS.versions,
    )
      .doc(
        firestoreId(
          value.tenantId,
          value.versionId,
        ),
      )
      .set(
        cloneForFirestore(
          value,
        ),
      );
  }

  public async listVersions<T>(
    tenantId: string,
    resourceId: string,
  ): Promise<
    readonly KnowledgeVersion<T>[]
  > {
    const snapshot =
      await this.collection(
        COLLECTIONS.versions,
      )
        .where(
          "tenantId",
          "==",
          tenantId,
        )
        .where(
          "resourceId",
          "==",
          resourceId,
        )
        .get();

    const values =
      snapshot.docs.map(
        (document) =>
          document.data() as
            KnowledgeVersion<T>,
      );

    values.sort(
      (a, b) =>
        a.version -
        b.version,
    );

    return Object.freeze(
      values.map(
        (value) =>
          Object.freeze(
            value,
          ),
      ),
    );
  }

  public async appendActivity(
    value: KnowledgeActivity,
  ): Promise<void> {
    await this.collection(
      COLLECTIONS.activity,
    )
      .doc(
        firestoreId(
          value.tenantId,
          value.activityId,
        ),
      )
      .set(
        cloneForFirestore(
          value,
        ),
      );
  }

  public async listActivity(
    tenantId: string,
    resourceId?: string,
  ): Promise<
    readonly KnowledgeActivity[]
  > {
    let query =
      this.collection(
        COLLECTIONS.activity,
      ).where(
        "tenantId",
        "==",
        tenantId,
      );

    if (resourceId) {
      query =
        query.where(
          "resourceId",
          "==",
          resourceId,
        );
    }

    const snapshot =
      await query.get();

    const values =
      snapshot.docs.map(
        (document) =>
          document.data() as
            KnowledgeActivity,
      );

    values.sort(
      (a, b) =>
        a.timestamp.localeCompare(
          b.timestamp,
        ),
    );

    return Object.freeze(
      values.map(
        (value) =>
          Object.freeze(
            value,
          ),
      ),
    );
  }
}