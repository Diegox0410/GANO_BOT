import type { ApiPrincipal } from "../contracts.js";

export type StudioAssistantStatus = "draft" | "published" | "archived";
export type StudioRisk = "safe" | "low" | "medium" | "high" | "critical";

export interface StudioAssistantConfiguration {
  readonly id: string;
  readonly tenantId: string;
  readonly version: number;
  readonly status: StudioAssistantStatus;
  readonly identity: {
    readonly name: string;
    readonly description: string;
    readonly purpose: string;
    readonly locale: string;
    readonly allowedLocales: readonly string[];
    readonly tone: string;
    readonly instructions: string;
    readonly welcomeMessage: string;
  };
  readonly behavior: {
    readonly systemPrompt: string;
    readonly restrictions: string;
    readonly responseLength: "short" | "balanced" | "detailed";
    readonly creativity: number;
    readonly insufficientPolicy: "explicit" | "ask-clarification";
  };
  readonly rag: {
    readonly enabled: boolean;
    readonly groundingMode: "private-strict" | "private-preferred" | "general-allowed";
    readonly knowledgeBaseIds: readonly string[];
    readonly topK: number;
    readonly minimumScore: number;
    readonly citationsEnabled: boolean;
  };
  readonly memory: {
    readonly enabled: boolean;
    readonly shortTerm: boolean;
    readonly longTerm: boolean;
    readonly summary: boolean;
    readonly retentionDays: number;
    readonly consentRequired: boolean;
  };
  readonly tools: {
    readonly enabled: boolean;
    readonly allowlist: readonly string[];
    readonly maximumRisk: StudioRisk;
    readonly maximumCalls: number;
    readonly maximumRounds: number;
  };
  readonly channels: readonly ("WEB" | "WHATSAPP" | "INSTAGRAM" | "FACEBOOK" | "OTHER")[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: string;
  readonly updatedBy: string;
}

export interface StudioPublishedVersion {
  readonly tenantId: string;
  readonly assistantId: string;
  readonly version: number;
  readonly configuration: StudioAssistantConfiguration;
  readonly publishedAt: string;
  readonly publishedBy: string;
}

export interface StudioRepository {
  list(tenantId: string): Promise<readonly StudioAssistantConfiguration[]>;
  get(tenantId: string, assistantId: string): Promise<StudioAssistantConfiguration | undefined>;
  save(value: StudioAssistantConfiguration): Promise<void>;
  remove(tenantId: string, assistantId: string): Promise<void>;
  getPublished(tenantId: string, assistantId: string): Promise<StudioPublishedVersion | undefined>;
  savePublished(value: StudioPublishedVersion): Promise<void>;
}

export interface StudioMutationContext {
  readonly principal: ApiPrincipal;
  readonly now: string;
}
