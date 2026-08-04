import { MemoryError, validateMemoryScope } from "./errors.js";
import {
  createConservativeMemoryExtractor,
  createDeterministicMemorySummarizer,
} from "./processors.js";
import type {
  ConversationSummary,
  MemoryCategory,
  MemoryConfiguration,
  MemoryDependencies,
  MemoryFact,
  MemoryMessage,
  MemoryMetrics,
  MemoryPipeline,
  MemoryPipelineRequest,
  MemoryPreference,
  MemoryQuery,
  MemoryRecord,
  MemoryResult,
} from "./types.js";
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
function containsSensitiveData(content: string): boolean {
  return /\b(password|contraseña|token|api[-_ ]?key|secret|tarjeta|cuenta bancaria|diagnóstico|historia clínica|medical)\b/i.test(
    content,
  );
}
function elapsed(start: number): number {
  return Date.now() - start;
}
function allowed(
  category: MemoryCategory,
  configuration: MemoryConfiguration,
): boolean {
  const policy = configuration.retention;
  if (policy?.forbiddenCategories?.includes(category) === true) return false;
  return (
    policy?.allowedCategories === undefined ||
    policy.allowedCategories.includes(category)
  );
}
export class DefaultMemoryPipeline implements MemoryPipeline {
  private readonly now: () => string;
  private readonly summarizer;
  private readonly extractor;
  public constructor(
    private readonly dependencies: MemoryDependencies,
    private readonly configuration: MemoryConfiguration = {},
  ) {
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.summarizer =
      dependencies.summarizer ?? createDeterministicMemorySummarizer(this.now);
    this.extractor =
      dependencies.extractor ?? createConservativeMemoryExtractor(this.now);
    if ((configuration.maximumMessages ?? 30) < 0)
      throw new MemoryError(
        "INVALID_CONFIGURATION",
        "maximumMessages no puede ser negativo.",
      );
  }
  public async process(request: MemoryPipelineRequest): Promise<MemoryResult> {
    const totalStarted = Date.now();
    validateMemoryScope(request.scope);
    if (request.signal?.aborted === true)
      throw new MemoryError(
        "REQUEST_CANCELLED",
        "El pipeline de memoria fue cancelado.",
      );
    const policy = this.configuration.retention;
    if (policy?.consentRequired === true && request.consent !== true)
      throw new MemoryError(
        "CONSENT_REQUIRED",
        "La memoria requiere consentimiento explícito.",
      );
    const cleanupStarted = Date.now();
    const expiredCount = await this.dependencies.store.cleanup(this.now());
    const cleanupMilliseconds = elapsed(cleanupStarted);
    const recent = this.shortTerm(request.messages);
    let summary: ConversationSummary | undefined;
    const summaryStarted = Date.now();
    if (this.configuration.summaryEnabled !== false && recent.length > 0)
      summary = await this.summarizer.summarize(
        recent,
        request.scope,
        request.signal,
      );
    const summaryMilliseconds = elapsed(summaryStarted);
    const extractionStarted = Date.now();
    const extracted =
      this.configuration.longTermEnabled === false
        ? Object.freeze([])
        : await this.extractor.extract(recent, request.scope, request.signal);
    const extractionMilliseconds = elapsed(extractionStarted);
    const writeStarted = Date.now();
    const saved: MemoryRecord[] = [];
    if (
      this.configuration.shortTermEnabled !== false &&
      allowed("conversation", this.configuration)
    ) {
      for (const message of recent) {
        const timestamp = this.now();
        const record: MemoryRecord = Object.freeze({
          id: `message-${message.id}`,
          scope: Object.freeze({ ...request.scope }),
          category: "conversation",
          content: message.content,
          source:
            message.role === "assistant"
              ? "assistant"
              : message.role === "user"
                ? "user"
                : "system",
          confidence: 1,
          createdAt: message.createdAt,
          updatedAt: timestamp,
          ...(policy?.ttlMilliseconds !== undefined
            ? {
                expiresAt: new Date(
                  Date.parse(timestamp) + policy.ttlMilliseconds,
                ).toISOString(),
              }
            : {}),
          status: "active",
          tags: Object.freeze([]),
          metadata: Object.freeze({
            messageId: message.id,
            role: message.role,
            contentType: message.contentType,
            status: message.status,
          }),
        });
        saved.push(await this.dependencies.store.save(record));
      }
    }
    for (const record of extracted)
      if (allowed(record.category, this.configuration))
        saved.push(
          await this.dependencies.store.save({
            ...record,
            ...(policy?.ttlMilliseconds !== undefined
              ? {
                  expiresAt: new Date(
                    Date.parse(this.now()) + policy.ttlMilliseconds,
                  ).toISOString(),
                }
              : {}),
          }),
        );
    if (summary !== undefined && allowed("summary", this.configuration))
      await this.dependencies.store.save({
        id: `summary-${request.scope.conversationId}`,
        scope: request.scope,
        category: "summary",
        content: summary.text,
        source: "system",
        confidence: 1,
        createdAt: summary.createdAt,
        updatedAt: summary.createdAt,
        ...(policy?.ttlMilliseconds !== undefined
          ? {
              expiresAt: new Date(
                Date.parse(summary.createdAt) + policy.ttlMilliseconds,
              ).toISOString(),
            }
          : {}),
        status: "active",
        tags: Object.freeze([]),
      });
    await this.enforceLimits(request.scope);
    const writeMilliseconds = elapsed(writeStarted);
    const facts = Object.freeze(
      saved.filter((record): record is MemoryFact =>
        ["fact", "goal", "decision", "constraint"].includes(record.category),
      ),
    );
    const preferences = Object.freeze(
      saved.filter(
        (record): record is MemoryPreference =>
          record.category === "preference",
      ),
    );
    const text = [
      ...recent.map((message) => message.content),
      summary?.text ?? "",
      ...facts.map((fact) => fact.content),
      ...preferences.map((preference) => preference.content),
    ].join("\n");
    const metrics: MemoryMetrics = Object.freeze({
      readMilliseconds: 0,
      writeMilliseconds,
      summaryMilliseconds,
      extractionMilliseconds,
      cleanupMilliseconds,
      totalMilliseconds: elapsed(totalStarted),
      messageCount: recent.length,
      factCount: facts.length,
      preferenceCount: preferences.length,
      expiredCount,
    });
    return Object.freeze({
      scope: Object.freeze({ ...request.scope }),
      messages: recent,
      ...(summary !== undefined ? { summary } : {}),
      facts,
      preferences,
      warnings: Object.freeze(
        extracted.length > saved.length
          ? ["Algunas categorías extraídas fueron bloqueadas por la política."]
          : [],
      ),
      usage: Object.freeze({
        estimatedTokens: estimateTokens(text),
        characterCount: text.length,
      }),
      metrics,
      ...(request.metadata !== undefined
        ? { metadata: Object.freeze({ ...request.metadata }) }
        : {}),
    });
  }
  public async recall(query: MemoryQuery): Promise<MemoryResult> {
    const started = Date.now();
    validateMemoryScope(query.scope);
    const records = await this.dependencies.store.find(query);
    const messages = Object.freeze(
      records
        .filter((record) => record.category === "conversation")
        .map((record) => this.toMessage(record)),
    );
    const summaryRecord = records
      .filter((record) => record.category === "summary")
      .at(-1);
    const facts = Object.freeze(
      records.filter((record): record is MemoryFact =>
        ["fact", "goal", "decision", "constraint"].includes(record.category),
      ),
    );
    const preferences = Object.freeze(
      records.filter(
        (record): record is MemoryPreference =>
          record.category === "preference",
      ),
    );
    const text = records.map((record) => record.content).join("\n");
    return Object.freeze({
      scope: query.scope,
      messages,
      ...(summaryRecord !== undefined
        ? {
            summary: Object.freeze({
              text: summaryRecord.content,
              objectives: Object.freeze([]),
              decisions: Object.freeze([]),
              pendingTopics: Object.freeze([]),
              facts: Object.freeze([]),
              constraints: Object.freeze([]),
              lastState: summaryRecord.content,
              createdAt: summaryRecord.createdAt,
            }),
          }
        : {}),
      facts,
      preferences,
      warnings: Object.freeze([]),
      usage: Object.freeze({
        estimatedTokens: estimateTokens(text),
        characterCount: text.length,
      }),
      metrics: Object.freeze({
        readMilliseconds: elapsed(started),
        writeMilliseconds: 0,
        summaryMilliseconds: 0,
        extractionMilliseconds: 0,
        cleanupMilliseconds: 0,
        totalMilliseconds: elapsed(started),
        messageCount: messages.length,
        factCount: facts.length,
        preferenceCount: preferences.length,
        expiredCount: 0,
      }),
    });
  }
  public forget(
    scope: Partial<
      Pick<
        import("./types.js").MemoryScope,
        "tenantId" | "assistantId" | "userId" | "conversationId"
      >
    >,
  ): Promise<number> {
    return this.dependencies.store.removeByScope(scope);
  }
  private shortTerm(
    messages: readonly MemoryMessage[],
  ): readonly MemoryMessage[] {
    const maximum = this.configuration.maximumMessages ?? 30;
    const maximumCharacters = Math.min(
      this.configuration.maximumCharacters ?? 12_000,
      (this.configuration.maximumTokens ?? 3_000) * 4,
    );
    const selected: MemoryMessage[] = [];
    let characters = 0;
    for (const message of [...messages].reverse()) {
      const content = message.content.trim();
      if (content.length === 0 || containsSensitiveData(content)) continue;
      if (selected.length >= maximum) break;
      const remaining = maximumCharacters - characters;
      if (remaining <= 0) break;
      selected.push(
        Object.freeze({
          ...message,
          content: content.slice(Math.max(0, content.length - remaining)),
        }),
      );
      characters += Math.min(content.length, remaining);
    }
    return Object.freeze(selected.reverse());
  }
  private toMessage(record: MemoryRecord): MemoryMessage {
    const role = record.metadata?.role;
    const resolvedRole =
      role === "assistant" ||
      role === "system" ||
      role === "developer" ||
      role === "tool"
        ? role
        : "user";
    return Object.freeze({
      id:
        typeof record.metadata?.messageId === "string"
          ? record.metadata.messageId
          : record.id,
      role: resolvedRole,
      content: record.content,
      contentType: "text",
      status: "completed",
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }
  private async enforceLimits(
    scope: import("./types.js").MemoryScope,
  ): Promise<void> {
    const records = await this.dependencies.store.find({
      scope,
      includeExpired: true,
    });
    const maximumConversation =
      this.configuration.retention?.maximumRecordsPerConversation;
    if (
      maximumConversation !== undefined &&
      records.length > maximumConversation
    )
      for (const record of records.slice(
        0,
        records.length - maximumConversation,
      ))
        await this.dependencies.store.remove(record.id, scope);
    const maximumUser = this.configuration.retention?.maximumRecordsPerUser;
    if (maximumUser !== undefined) {
      const userRecords = await this.dependencies.store.findByScope({
        tenantId: scope.tenantId,
        assistantId: scope.assistantId,
        userId: scope.userId,
      });
      for (const record of userRecords.slice(
        0,
        Math.max(0, userRecords.length - maximumUser),
      ))
        await this.dependencies.store.remove(record.id, record.scope);
    }
  }
}
export function createMemoryPipeline(
  dependencies: MemoryDependencies,
  configuration: MemoryConfiguration = {},
): MemoryPipeline {
  return new DefaultMemoryPipeline(dependencies, configuration);
}
