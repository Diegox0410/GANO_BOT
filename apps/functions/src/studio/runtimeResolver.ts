import type { StudioAssistantConfiguration } from "./contracts.js";
import type { StudioControlPlane } from "./service.js";

export interface RuntimeAssistantConfiguration {
  readonly assistantId: string;
  readonly tenantId: string;
  readonly version: number;
  readonly systemPrompt: string;
  readonly locale: string;
  readonly groundingMode: StudioAssistantConfiguration["rag"]["groundingMode"];
  readonly knowledgeBaseIds: readonly string[];
  readonly memoryEnabled: boolean;
  readonly toolAllowlist: readonly string[];
  readonly maximumToolCalls: number;
  readonly maximumToolRounds: number;
}

export class StudioRuntimeConfigurationResolver {
  public constructor(private readonly studio: StudioControlPlane) {}
  public async resolve(tenantId: string, assistantId: string): Promise<RuntimeAssistantConfiguration> {
    const value = await this.studio.resolvePublished(tenantId, assistantId);
    const prompt = [
      value.behavior.systemPrompt.trim(),
      value.identity.instructions.trim(),
      value.behavior.restrictions.trim() ? `Restricciones:\n${value.behavior.restrictions.trim()}` : "",
    ].filter(Boolean).join("\n\n");
    return Object.freeze({
      assistantId: value.id,
      tenantId: value.tenantId,
      version: value.version,
      systemPrompt: prompt,
      locale: value.identity.locale,
      groundingMode: value.rag.groundingMode,
      knowledgeBaseIds: Object.freeze([...value.rag.knowledgeBaseIds]),
      memoryEnabled: value.memory.enabled,
      toolAllowlist: Object.freeze(value.tools.enabled ? [...value.tools.allowlist] : []),
      maximumToolCalls: value.tools.maximumCalls,
      maximumToolRounds: value.tools.maximumRounds,
    });
  }
}
