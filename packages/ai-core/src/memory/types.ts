import type { AIIdentifier, AIMessage, AIMetadata } from "../types.js";
export type MemoryCategory =
  | "conversation"
  | "fact"
  | "preference"
  | "goal"
  | "decision"
  | "constraint"
  | "summary"
  | "custom";
export type MemoryRecordStatus = "active" | "expired" | "deleted";
export interface MemoryScope {
  readonly tenantId: AIIdentifier;
  readonly assistantId: AIIdentifier;
  readonly userId: AIIdentifier;
  readonly conversationId: AIIdentifier;
  readonly requestId: AIIdentifier;
  readonly correlationId: AIIdentifier;
}
export interface MemoryRecord {
  readonly id: AIIdentifier;
  readonly scope: MemoryScope;
  readonly category: MemoryCategory;
  readonly content: string;
  readonly source: "user" | "assistant" | "system" | "extracted";
  readonly confidence: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt?: string;
  readonly status: MemoryRecordStatus;
  readonly tags: readonly string[];
  readonly metadata?: AIMetadata;
}
export type MemoryMessage = AIMessage;
export interface MemoryFact extends MemoryRecord {
  readonly category: "fact" | "goal" | "decision" | "constraint";
}
export interface MemoryPreference extends MemoryRecord {
  readonly category: "preference";
}
export interface ConversationSummary {
  readonly text: string;
  readonly objectives: readonly string[];
  readonly decisions: readonly string[];
  readonly pendingTopics: readonly string[];
  readonly facts: readonly string[];
  readonly constraints: readonly string[];
  readonly lastState: string;
  readonly createdAt: string;
}
export interface MemoryQuery {
  readonly scope: MemoryScope;
  readonly categories?: readonly MemoryCategory[];
  readonly text?: string;
  readonly limit?: number;
  readonly includeExpired?: boolean;
  readonly signal?: AbortSignal;
}
export interface MemoryRetentionPolicy {
  readonly ttlMilliseconds?: number;
  readonly maximumRecordsPerUser?: number;
  readonly maximumRecordsPerConversation?: number;
  readonly consentRequired?: boolean;
  readonly allowedCategories?: readonly MemoryCategory[];
  readonly forbiddenCategories?: readonly MemoryCategory[];
}
export interface MemoryConfiguration {
  readonly enabled?: boolean;
  readonly shortTermEnabled?: boolean;
  readonly longTermEnabled?: boolean;
  readonly summaryEnabled?: boolean;
  readonly maximumMessages?: number;
  readonly maximumCharacters?: number;
  readonly maximumTokens?: number;
  readonly retention?: MemoryRetentionPolicy;
  readonly memoryInjectionOrder?: "before-knowledge" | "after-knowledge";
}
export interface MemoryUsage {
  readonly estimatedTokens: number;
  readonly characterCount: number;
}
export interface MemoryMetrics {
  readonly readMilliseconds: number;
  readonly writeMilliseconds: number;
  readonly summaryMilliseconds: number;
  readonly extractionMilliseconds: number;
  readonly cleanupMilliseconds: number;
  readonly totalMilliseconds: number;
  readonly messageCount: number;
  readonly factCount: number;
  readonly preferenceCount: number;
  readonly expiredCount: number;
}
export interface MemoryResult {
  readonly scope: MemoryScope;
  readonly messages: readonly MemoryMessage[];
  readonly summary?: ConversationSummary;
  readonly facts: readonly MemoryFact[];
  readonly preferences: readonly MemoryPreference[];
  readonly warnings: readonly string[];
  readonly usage: MemoryUsage;
  readonly metrics: MemoryMetrics;
  readonly metadata?: AIMetadata;
}
export interface MemoryStore {
  save(record: MemoryRecord): Promise<MemoryRecord>;
  find(query: MemoryQuery): Promise<readonly MemoryRecord[]>;
  findByScope(
    scope: Partial<
      Pick<
        MemoryScope,
        "tenantId" | "assistantId" | "userId" | "conversationId"
      >
    >,
  ): Promise<readonly MemoryRecord[]>;
  get(id: AIIdentifier, scope: MemoryScope): Promise<MemoryRecord | undefined>;
  remove(id: AIIdentifier, scope: MemoryScope): Promise<boolean>;
  removeByScope(
    scope: Partial<
      Pick<
        MemoryScope,
        "tenantId" | "assistantId" | "userId" | "conversationId"
      >
    >,
  ): Promise<number>;
  cleanup(now: string): Promise<number>;
}
export interface MemorySummarizer {
  summarize(
    messages: readonly MemoryMessage[],
    scope: MemoryScope,
    signal?: AbortSignal,
  ): Promise<ConversationSummary>;
}
export interface MemoryExtractor {
  extract(
    messages: readonly MemoryMessage[],
    scope: MemoryScope,
    signal?: AbortSignal,
  ): Promise<readonly MemoryRecord[]>;
}
export interface MemoryPipelineRequest {
  readonly scope: MemoryScope;
  readonly messages: readonly MemoryMessage[];
  readonly consent?: boolean;
  readonly signal?: AbortSignal;
  readonly metadata?: AIMetadata;
}
export interface MemoryPipeline {
  process(request: MemoryPipelineRequest): Promise<MemoryResult>;
  recall(query: MemoryQuery): Promise<MemoryResult>;
  forget(
    scope: Partial<
      Pick<
        MemoryScope,
        "tenantId" | "assistantId" | "userId" | "conversationId"
      >
    >,
  ): Promise<number>;
}
export interface MemoryDependencies {
  readonly store: MemoryStore;
  readonly summarizer?: MemorySummarizer;
  readonly extractor?: MemoryExtractor;
  readonly now?: () => string;
  readonly generateId?: (prefix: string) => string;
}
export interface MemoryServices {
  readonly pipeline: MemoryPipeline;
  readonly store: MemoryStore;
  readonly configuration: MemoryConfiguration;
}
