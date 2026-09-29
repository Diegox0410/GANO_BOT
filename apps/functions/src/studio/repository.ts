import type { StudioAssistantConfiguration, StudioPublishedVersion, StudioRepository } from "./contracts.js";

const key = (tenantId: string, assistantId: string) => `${tenantId}:${assistantId}`;

export class InMemoryStudioRepository implements StudioRepository {
  private readonly drafts = new Map<string, StudioAssistantConfiguration>();
  private readonly published = new Map<string, StudioPublishedVersion>();

  async list(tenantId: string): Promise<readonly StudioAssistantConfiguration[]> {
    return Object.freeze([...this.drafts.values()].filter(x => x.tenantId === tenantId).map(x => structuredClone(x)));
  }
  async get(tenantId: string, assistantId: string): Promise<StudioAssistantConfiguration | undefined> {
    const value = this.drafts.get(key(tenantId, assistantId));
    return value ? structuredClone(value) : undefined;
  }
  async save(value: StudioAssistantConfiguration): Promise<void> {
    this.drafts.set(key(value.tenantId, value.id), structuredClone(value));
  }
  async remove(tenantId: string, assistantId: string): Promise<void> {
    this.drafts.delete(key(tenantId, assistantId));
  }
  async getPublished(tenantId: string, assistantId: string): Promise<StudioPublishedVersion | undefined> {
    const value = this.published.get(key(tenantId, assistantId));
    return value ? structuredClone(value) : undefined;
  }
  async savePublished(value: StudioPublishedVersion): Promise<void> {
    this.published.set(key(value.tenantId, value.assistantId), structuredClone(value));
  }
}
