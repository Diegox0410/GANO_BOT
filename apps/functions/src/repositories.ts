import { BackendApiError } from "./errors.js";
import type { AssistantDescriptor } from "@gano-bot/ai-core";
import type {
  ConversationApiResource,
  DocumentApiResource,
  IngestionJobApiResource,
  KnowledgeBaseApiResource,
} from "./contracts.js";
const key = (...values: readonly string[]): string => JSON.stringify(values);
/** Repositorio volátil exclusivo para desarrollo y pruebas. */
export class InMemoryAssistantRepository {
  private readonly values = new Map<string, AssistantDescriptor>();
  public register(value: AssistantDescriptor): void {
    this.values.set(key(value.tenantId, value.id), Object.freeze(value));
  }
  public get(tenantId: string, id: string): AssistantDescriptor | undefined {
    return this.values.get(key(tenantId, id));
  }
  public list(tenantId: string): readonly AssistantDescriptor[] {
    return Object.freeze(
      [...this.values.values()].filter((item) => item.tenantId === tenantId),
    );
  }
}
/** Repositorio volátil exclusivo para desarrollo y pruebas. */
export class InMemoryConversationRepository {
  private readonly values = new Map<string, ConversationApiResource>();
  public save(value: ConversationApiResource): void {
    this.values.set(
      key(value.tenantId, value.assistantId, value.id),
      Object.freeze({ ...value, messages: Object.freeze([...value.messages]) }),
    );
  }
  public get(
    tenantId: string,
    assistantId: string,
    id: string,
    actorId: string,
    others = false,
  ): ConversationApiResource | undefined {
    const value = this.values.get(key(tenantId, assistantId, id));
    return value !== undefined && (others || value.ownerId === actorId)
      ? value
      : undefined;
  }
  public list(
    tenantId: string,
    actorId: string,
    others = false,
  ): readonly ConversationApiResource[] {
    return Object.freeze(
      [...this.values.values()].filter(
        (item) =>
          item.tenantId === tenantId && (others || item.ownerId === actorId),
      ),
    );
  }
  public delete(
    tenantId: string,
    assistantId: string,
    id: string,
    actorId: string,
    others = false,
  ): boolean {
    const value = this.get(tenantId, assistantId, id, actorId, others);
    return value === undefined
      ? false
      : this.values.delete(key(tenantId, assistantId, id));
  }
}
export class InMemoryKnowledgeCatalog {
  public constructor(
    private readonly bases: readonly KnowledgeBaseApiResource[] = Object.freeze(
      [],
    ),
    private readonly documents: readonly DocumentApiResource[] = Object.freeze(
      [],
    ),
  ) {}
  public listBases(tenantId: string): readonly KnowledgeBaseApiResource[] {
    return Object.freeze(
      this.bases.filter((item) => item.tenantId === tenantId),
    );
  }
  public listDocuments(tenantId: string): readonly DocumentApiResource[] {
    return Object.freeze(
      this.documents.filter((item) => item.tenantId === tenantId),
    );
  }
  public getBase(
    tenantId: string,
    id: string,
  ): KnowledgeBaseApiResource | undefined {
    return this.bases.find(
      (item) => item.tenantId === tenantId && item.id === id,
    );
  }
  public getDocument(
    tenantId: string,
    id: string,
  ): DocumentApiResource | undefined {
    return this.documents.find(
      (item) => item.tenantId === tenantId && item.id === id,
    );
  }
}
/** Repositorio volátil exclusivo para desarrollo y pruebas; sólo admite fixtures autorizadas. */
export class InMemoryIngestionJobRepository {
  private readonly jobs = new Map<string, IngestionJobApiResource>();
  public constructor(
    private readonly fixtures: readonly string[] = Object.freeze([
      "sample.txt",
      "sample.md",
      "sample.json",
      "sample.csv",
      "sample.html",
    ]),
  ) {}
  public create(
    id: string,
    tenantId: string,
    assistantId: string,
    fixtureId: string,
    now: string,
  ): IngestionJobApiResource {
    if (
      !this.fixtures.includes(fixtureId) ||
      fixtureId.includes("..") ||
      fixtureId.includes("/") ||
      fixtureId.includes("\\")
    )
      throw new BackendApiError(
        "BAD_REQUEST",
        "La fixture de ingesta no está autorizada.",
        400,
      );
    const job = Object.freeze({
      id,
      tenantId,
      assistantId,
      fixtureId,
      status: "completed" as const,
      createdAt: now,
      updatedAt: now,
    });
    this.jobs.set(key(tenantId, id), job);
    return job;
  }
  public get(
    tenantId: string,
    id: string,
  ): IngestionJobApiResource | undefined {
    return this.jobs.get(key(tenantId, id));
  }
}
