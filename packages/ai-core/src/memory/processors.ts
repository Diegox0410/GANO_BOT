import { MemoryError } from "./errors.js";
import type {
  ConversationSummary,
  MemoryExtractor,
  MemoryMessage,
  MemoryRecord,
  MemoryScope,
  MemorySummarizer,
} from "./types.js";
const SENSITIVE =
  /\b(password|contraseña|token|api[-_ ]?key|secret|tarjeta|cuenta bancaria|diagnóstico|historia clínica|medical)\b/i;
function deterministicId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `memory_${(hash >>> 0).toString(16)}`;
}
export class DeterministicMemorySummarizer implements MemorySummarizer {
  public constructor(
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}
  public async summarize(
    messages: readonly MemoryMessage[],
    _scope: MemoryScope,
    signal?: AbortSignal,
  ): Promise<ConversationSummary> {
    if (signal?.aborted === true)
      throw new MemoryError("REQUEST_CANCELLED", "El resumen fue cancelado.");
    const contents = messages
      .map((message) => message.content.trim())
      .filter((value) => value.length > 0);
    const select = (pattern: RegExp) =>
      Object.freeze(contents.filter((value) => pattern.test(value)).slice(-5));
    return Object.freeze({
      text: contents
        .slice(-8)
        .map((value, index) => `${index + 1}. ${value}`)
        .join("\n")
        .slice(0, 4_000),
      objectives: select(/\b(objetivo|quiero|necesito)\b/i),
      decisions: select(/\b(decidí|decidimos|acordamos)\b/i),
      pendingTopics: select(/\b(pendiente|después|falta)\b/i),
      facts: select(/\b(soy|tengo|trabajo|vivo)\b/i),
      constraints: select(/\b(no puedo|restricción|límite)\b/i),
      lastState: contents.at(-1) ?? "",
      createdAt: this.now(),
    });
  }
}
export class ConservativeMemoryExtractor implements MemoryExtractor {
  public constructor(
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly generateId: (value: string) => string = deterministicId,
  ) {}
  public async extract(
    messages: readonly MemoryMessage[],
    scope: MemoryScope,
    signal?: AbortSignal,
  ): Promise<readonly MemoryRecord[]> {
    const records: MemoryRecord[] = [];
    for (const message of messages) {
      if (signal?.aborted === true)
        throw new MemoryError(
          "REQUEST_CANCELLED",
          "La extracción fue cancelada.",
        );
      if (message.role !== "user") continue;
      const content = message.content.trim();
      if (content.length === 0 || SENSITIVE.test(content)) continue;
      const match =
        /\b(prefiero|me gusta|mi objetivo es|decidí|no puedo|soy|trabajo en|vivo en)\s+(.{2,300})/i.exec(
          content,
        );
      if (match === null) continue;
      const prefix = match[1]?.toLowerCase() ?? "";
      const category =
        prefix.includes("prefiero") || prefix.includes("gusta")
          ? "preference"
          : prefix.includes("objetivo")
            ? "goal"
            : prefix.includes("decidí")
              ? "decision"
              : prefix.includes("no puedo")
                ? "constraint"
                : "fact";
      const timestamp = this.now();
      const extracted = match[0].trim();
      records.push(
        Object.freeze({
          id: this.generateId(
            `${scope.tenantId}:${scope.assistantId}:${scope.userId}:${category}:${extracted.toLowerCase()}`,
          ),
          scope: Object.freeze({ ...scope }),
          category,
          content: extracted,
          source: "extracted",
          confidence: 0.8,
          createdAt: timestamp,
          updatedAt: timestamp,
          status: "active",
          tags: Object.freeze(["conservative-extraction"]),
          metadata: Object.freeze({ sourceMessageId: message.id }),
        }),
      );
    }
    return Object.freeze(records);
  }
}
export function createDeterministicMemorySummarizer(
  now?: () => string,
): MemorySummarizer {
  return new DeterministicMemorySummarizer(now);
}
export function createConservativeMemoryExtractor(
  now?: () => string,
): MemoryExtractor {
  return new ConservativeMemoryExtractor(now);
}
