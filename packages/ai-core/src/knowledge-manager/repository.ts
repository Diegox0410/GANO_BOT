import type {
  KnowledgeActivity,
  KnowledgeCollection,
  KnowledgeFolder,
  KnowledgeVersion,
  ManagedDocument,
  ManagedKnowledgeBase,
} from "./types.js";
export interface KnowledgeManagerRepository {
  saveBase(value: ManagedKnowledgeBase): Promise<void>;
  getBase(
    tenantId: string,
    id: string,
  ): Promise<ManagedKnowledgeBase | undefined>;
  listBases(tenantId: string): Promise<readonly ManagedKnowledgeBase[]>;
  deleteBase(tenantId: string, id: string): Promise<boolean>;
  saveDocument(value: ManagedDocument): Promise<void>;
  getDocument(
    tenantId: string,
    id: string,
  ): Promise<ManagedDocument | undefined>;
  listDocuments(
    tenantId: string,
    baseId?: string,
  ): Promise<readonly ManagedDocument[]>;
  deleteDocument(tenantId: string, id: string): Promise<boolean>;
  saveFolder(value: KnowledgeFolder): Promise<void>;
  deleteFolder(tenantId: string, id: string): Promise<boolean>;
  listFolders(
    tenantId: string,
    baseId: string,
  ): Promise<readonly KnowledgeFolder[]>;
  saveCollection(value: KnowledgeCollection): Promise<void>;
  deleteCollection(tenantId: string, id: string): Promise<boolean>;
  listCollections(
    tenantId: string,
    baseId: string,
  ): Promise<readonly KnowledgeCollection[]>;
  saveVersion<T>(value: KnowledgeVersion<T>): Promise<void>;
  listVersions<T>(
    tenantId: string,
    resourceId: string,
  ): Promise<readonly KnowledgeVersion<T>[]>;
  appendActivity(value: KnowledgeActivity): Promise<void>;
  listActivity(
    tenantId: string,
    resourceId?: string,
  ): Promise<readonly KnowledgeActivity[]>;
}
const key = (...parts: readonly string[]): string => JSON.stringify(parts);
/** Adaptador volátil exclusivamente para desarrollo y pruebas. */
export class InMemoryKnowledgeManagerRepository implements KnowledgeManagerRepository {
  private readonly bases = new Map<string, ManagedKnowledgeBase>();
  private readonly documents = new Map<string, ManagedDocument>();
  private readonly folders = new Map<string, KnowledgeFolder>();
  private readonly collections = new Map<string, KnowledgeCollection>();
  private readonly versions: KnowledgeVersion<unknown>[] = [];
  private readonly activity: KnowledgeActivity[] = [];
  public async saveBase(value: ManagedKnowledgeBase): Promise<void> {
    this.bases.set(key(value.tenantId, value.knowledgeBaseId), value);
  }
  public async getBase(
    tenantId: string,
    id: string,
  ): Promise<ManagedKnowledgeBase | undefined> {
    return this.bases.get(key(tenantId, id));
  }
  public async listBases(
    tenantId: string,
  ): Promise<readonly ManagedKnowledgeBase[]> {
    return Object.freeze(
      [...this.bases.values()].filter((v) => v.tenantId === tenantId),
    );
  }
  public async deleteBase(tenantId: string, id: string): Promise<boolean> {
    return this.bases.delete(key(tenantId, id));
  }
  public async saveDocument(value: ManagedDocument): Promise<void> {
    this.documents.set(key(value.tenantId, value.documentId), value);
  }
  public async getDocument(
    tenantId: string,
    id: string,
  ): Promise<ManagedDocument | undefined> {
    return this.documents.get(key(tenantId, id));
  }
  public async listDocuments(
    tenantId: string,
    baseId?: string,
  ): Promise<readonly ManagedDocument[]> {
    return Object.freeze(
      [...this.documents.values()].filter(
        (v) =>
          v.tenantId === tenantId &&
          (baseId === undefined || v.knowledgeBaseId === baseId),
      ),
    );
  }
  public async deleteDocument(tenantId: string, id: string): Promise<boolean> {
    return this.documents.delete(key(tenantId, id));
  }
  public async saveFolder(value: KnowledgeFolder): Promise<void> {
    this.folders.set(key(value.tenantId, value.folderId), value);
  }
  public async deleteFolder(tenantId: string, id: string): Promise<boolean> {
    return this.folders.delete(key(tenantId, id));
  }
  public async listFolders(
    tenantId: string,
    baseId: string,
  ): Promise<readonly KnowledgeFolder[]> {
    return Object.freeze(
      [...this.folders.values()].filter(
        (v) => v.tenantId === tenantId && v.knowledgeBaseId === baseId,
      ),
    );
  }
  public async saveCollection(value: KnowledgeCollection): Promise<void> {
    this.collections.set(key(value.tenantId, value.collectionId), value);
  }
  public async deleteCollection(
    tenantId: string,
    id: string,
  ): Promise<boolean> {
    return this.collections.delete(key(tenantId, id));
  }
  public async listCollections(
    tenantId: string,
    baseId: string,
  ): Promise<readonly KnowledgeCollection[]> {
    return Object.freeze(
      [...this.collections.values()].filter(
        (v) => v.tenantId === tenantId && v.knowledgeBaseId === baseId,
      ),
    );
  }
  public async saveVersion<T>(value: KnowledgeVersion<T>): Promise<void> {
    this.versions.push(value);
  }
  public async listVersions<T>(
    tenantId: string,
    resourceId: string,
  ): Promise<readonly KnowledgeVersion<T>[]> {
    return Object.freeze(
      this.versions.filter(
        (v) => v.tenantId === tenantId && v.resourceId === resourceId,
      ) as readonly KnowledgeVersion<T>[],
    );
  }
  public async appendActivity(value: KnowledgeActivity): Promise<void> {
    this.activity.push(value);
  }
  public async listActivity(
    tenantId: string,
    resourceId?: string,
  ): Promise<readonly KnowledgeActivity[]> {
    return Object.freeze(
      this.activity.filter(
        (v) =>
          v.tenantId === tenantId &&
          (resourceId === undefined || v.resourceId === resourceId),
      ),
    );
  }
}
