/** Proveedor conversacional Gemini mediante API REST. */
import {
  AIChatProviderError,
  BaseAIChatProvider,
  createAIChatAssistantMessage,
  throwIfAIChatAborted,
} from "./base";

import type { BaseAIChatProviderConfig } from "./base";
import type {
  AIChatFinishReason,
  AIChatGenerationResult,
  AIChatMessage,
  AIChatProviderDescriptor,
  AIChatRequest,
  AIChatToolCall,
  AIChatUsage,
} from "./types";
import type { AIIdentifier, AIMetadata, AIUnknownRecord } from "../types";

export const DEFAULT_GEMINI_CHAT_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_GEMINI_CHAT_MODEL = "gemini-2.5-flash";
export const DEFAULT_GEMINI_CHAT_TIMEOUT_MS = 60_000;

export interface GeminiChatProviderConfig {
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly timeoutMilliseconds?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetchImplementation?: typeof fetch;
  readonly lifecycleListeners?: BaseAIChatProviderConfig["lifecycleListeners"];
  readonly metadata?: AIMetadata;
}

interface ResolvedGeminiChatProviderConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly timeoutMilliseconds: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly fetchImplementation: typeof fetch;
}

interface GeminiFunctionCall {
  readonly name?: string;
  readonly args?: unknown;
}

interface GeminiFunctionResponse {
  readonly name: string;
  readonly response: unknown;
}

interface GeminiPart {
  readonly text?: string;
  readonly functionCall?: GeminiFunctionCall;
  readonly functionResponse?: GeminiFunctionResponse;
}

interface GeminiContent {
  readonly role?: "user" | "model";
  readonly parts: readonly GeminiPart[];
}

interface GeminiCandidate {
  readonly content?: GeminiContent;
  readonly finishReason?: string;
}

interface GeminiResponse {
  readonly candidates?: readonly GeminiCandidate[];
  readonly usageMetadata?: {
    readonly promptTokenCount?: number;
    readonly candidatesTokenCount?: number;
    readonly totalTokenCount?: number;
    readonly cachedContentTokenCount?: number;
  };
  readonly promptFeedback?: {
    readonly blockReason?: string;
    readonly blockReasonMessage?: string;
  };
  readonly modelVersion?: string;
  readonly error?: { readonly message?: string };
}

interface GeminiRequestBody {
  readonly systemInstruction?: { readonly parts: readonly GeminiPart[] };
  readonly contents: readonly GeminiContent[];
  readonly tools?: readonly [{
    readonly functionDeclarations: readonly {
      readonly name: string;
      readonly description: string;
      readonly parameters: unknown;
    }[];
  }];
  readonly generationConfig?: {
    readonly temperature?: number;
    readonly topP?: number;
    readonly topK?: number;
    readonly maxOutputTokens?: number;
    readonly stopSequences?: readonly string[];
    readonly responseMimeType?: "application/json" | "text/plain";
  };
}

function normalizeText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized !== undefined && normalized.length > 0 ? normalized : undefined;
}

function requireText(value: string, field: string): string {
  const normalized = normalizeText(value);
  if (normalized === undefined) {
    throw new AIChatProviderError(
      "INVALID_CONFIGURATION",
      `La configuración de Gemini requiere un valor válido para "${field}".`,
      { providerId: "gemini" },
    );
  }
  return normalized;
}

function resolveConfig(config: GeminiChatProviderConfig): ResolvedGeminiChatProviderConfig {
  const timeoutMilliseconds = config.timeoutMilliseconds ?? DEFAULT_GEMINI_CHAT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMilliseconds) || timeoutMilliseconds <= 0) {
    throw new AIChatProviderError(
      "INVALID_CONFIGURATION",
      "El tiempo de espera de Gemini debe ser un número mayor que cero.",
      { providerId: "gemini" },
    );
  }
  const fetchImplementation = config.fetchImplementation ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") {
    throw new AIChatProviderError(
      "INVALID_CONFIGURATION",
      "El entorno actual no dispone de una implementación válida de fetch.",
      { providerId: "gemini" },
    );
  }
  return Object.freeze({
    apiKey: requireText(config.apiKey, "apiKey"),
    model: normalizeText(config.model) ?? DEFAULT_GEMINI_CHAT_MODEL,
    baseUrl: (normalizeText(config.baseUrl) ?? DEFAULT_GEMINI_CHAT_BASE_URL).replace(/\/+$/g, ""),
    timeoutMilliseconds: Math.floor(timeoutMilliseconds),
    headers: Object.freeze({ ...(config.headers ?? {}) }),
    fetchImplementation,
  });
}

function createDescriptor(model: string, metadata: AIMetadata | undefined): AIChatProviderDescriptor {
  const descriptor: {
    id: string;
    name: "google";
    displayName: string;
    defaultModel: string;
    capabilities: AIChatProviderDescriptor["capabilities"];
    enabled: boolean;
    metadata?: AIMetadata;
  } = {
    id: "gemini",
    name: "google",
    displayName: "Google Gemini",
    defaultModel: model,
    capabilities: Object.freeze({
      supportsStreaming: false,
      supportsTools: true,
      supportsJson: true,
      supportsMultimodal: false,
      supportsSeed: false,
    }),
    enabled: true,
  };
  if (metadata !== undefined) descriptor.metadata = metadata;
  return Object.freeze(descriptor);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMetadataToolCalls(message: AIChatMessage): readonly GeminiPart[] {
  const serialized = message.metadata?.["toolCalls"];
  if (typeof serialized !== "string") return Object.freeze([]);
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed)) return Object.freeze([]);
    const parts: GeminiPart[] = [];
    for (const item of parsed) {
      if (!isRecord(item) || typeof item["name"] !== "string") continue;
      const name = item["name"].trim();
      if (name.length === 0) continue;
      parts.push({ functionCall: { name, args: item["arguments"] ?? {} } });
    }
    return Object.freeze(parts);
  } catch {
    return Object.freeze([]);
  }
}

function convertToolResult(message: AIChatMessage): GeminiPart {
  const part = message.parts?.find((candidate) => candidate.type === "tool-result");
  const name = part?.type === "tool-result" ? part.toolName : normalizeText(message.name) ?? "tool";
  const response = part?.type === "tool-result"
    ? { result: part.result, isError: part.isError }
    : { result: message.content };
  return { functionResponse: { name, response } };
}

function convertMessage(message: AIChatMessage): GeminiContent | undefined {
  if (message.role === "system" || message.role === "developer") return undefined;
  if (message.role === "tool") {
    return Object.freeze({ role: "user", parts: Object.freeze([convertToolResult(message)]) });
  }
  const functionParts = message.role === "assistant" ? parseMetadataToolCalls(message) : Object.freeze([]);
  const parts: GeminiPart[] = [];
  if (message.content.length > 0) parts.push({ text: message.content });
  parts.push(...functionParts);
  if (parts.length === 0) parts.push({ text: "" });
  return Object.freeze({
    role: message.role === "assistant" ? "model" : "user",
    parts: Object.freeze(parts),
  });
}

function createRequestBody(request: AIChatRequest): GeminiRequestBody {
  const systemParts: string[] = [];
  if (request.systemPrompt !== undefined) systemParts.push(request.systemPrompt);
  for (const message of request.messages) {
    if (message.role === "system" || message.role === "developer") systemParts.push(message.content);
  }
  const contents = request.messages
    .map(convertMessage)
    .filter((content): content is GeminiContent => content !== undefined);
  const body: {
    systemInstruction?: { parts: readonly GeminiPart[] };
    contents: readonly GeminiContent[];
    tools?: GeminiRequestBody["tools"];
    generationConfig?: GeminiRequestBody["generationConfig"];
  } = { contents: Object.freeze(contents) };
  if (systemParts.length > 0) {
    body.systemInstruction = { parts: Object.freeze([{ text: systemParts.join("\n\n") }]) };
  }
  if (request.tools !== undefined && request.tools.length > 0) {
    body.tools = Object.freeze([{
      functionDeclarations: Object.freeze(request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }))),
    }]);
  }
  const options = request.options;
  if (options !== undefined) {
    const generationConfig: {
      temperature?: number;
      topP?: number;
      topK?: number;
      maxOutputTokens?: number;
      stopSequences?: readonly string[];
      responseMimeType?: "application/json" | "text/plain";
    } = {};
    if (options.temperature !== undefined) generationConfig.temperature = options.temperature;
    if (options.topP !== undefined) generationConfig.topP = options.topP;
    if (options.topK !== undefined) generationConfig.topK = options.topK;
    if (options.maximumOutputTokens !== undefined) generationConfig.maxOutputTokens = options.maximumOutputTokens;
    if (options.stopSequences !== undefined) generationConfig.stopSequences = options.stopSequences;
    if (options.responseFormat !== undefined) {
      generationConfig.responseMimeType = options.responseFormat === "json" ? "application/json" : "text/plain";
    }
    if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;
  }
  return body;
}

function normalizeFinishReason(value: string | undefined): AIChatFinishReason {
  switch (value) {
    case "STOP": return "stop";
    case "MAX_TOKENS": return "length";
    case "SAFETY":
    case "RECITATION":
    case "PROHIBITED_CONTENT": return "content_filter";
    default: return "unknown";
  }
}

function normalizeUsage(response: GeminiResponse): AIChatUsage | undefined {
  const usage = response.usageMetadata;
  if (usage === undefined) return undefined;
  const inputTokens = usage.promptTokenCount ?? 0;
  const outputTokens = usage.candidatesTokenCount ?? 0;
  const result: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedInputTokens?: number;
  } = { inputTokens, outputTokens, totalTokens: usage.totalTokenCount ?? inputTokens + outputTokens };
  if (usage.cachedContentTokenCount !== undefined) result.cachedInputTokens = usage.cachedContentTokenCount;
  return Object.freeze(result);
}

function normalizeArguments(value: unknown): AIUnknownRecord {
  return isRecord(value) ? value : Object.freeze({});
}

function createAbortController(externalSignal: AbortSignal | undefined, timeout: number): {
  readonly signal: AbortSignal;
  readonly dispose: () => void;
  readonly didTimeout: () => boolean;
} {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
  const abort = (): void => controller.abort();
  if (externalSignal?.aborted === true) controller.abort();
  else externalSignal?.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    dispose: () => { clearTimeout(timeoutId); externalSignal?.removeEventListener("abort", abort); },
    didTimeout: () => timedOut,
  };
}

export class GeminiChatProvider extends BaseAIChatProvider {
  private readonly geminiConfig: ResolvedGeminiChatProviderConfig;

  public constructor(config: GeminiChatProviderConfig) {
    const resolved = resolveConfig(config);
    super({
      descriptor: createDescriptor(resolved.model, config.metadata),
      defaultModel: resolved.model,
      lifecycleListeners: config.lifecycleListeners,
    });
    this.geminiConfig = resolved;
  }

  protected async generateChatResponse(request: AIChatRequest, model: string): Promise<AIChatGenerationResult> {
    throwIfAIChatAborted(request.signal, { providerId: this.descriptor.id, requestId: request.requestId, model });
    const abort = createAbortController(request.signal, this.geminiConfig.timeoutMilliseconds);
    try {
      const encodedModel = encodeURIComponent(model);
      const response = await this.geminiConfig.fetchImplementation(
        `${this.geminiConfig.baseUrl}/models/${encodedModel}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": this.geminiConfig.apiKey, ...this.geminiConfig.headers },
          body: JSON.stringify(createRequestBody(request)),
          signal: abort.signal,
        },
      );
      const text = await response.text();
      let payload: GeminiResponse;
      try {
        payload = text.trim().length === 0 ? {} : JSON.parse(text) as GeminiResponse;
      } catch (error) {
        throw new AIChatProviderError(
          "INVALID_PROVIDER_RESPONSE",
          "Gemini devolvió una respuesta que no contiene JSON válido.",
          { providerId: this.descriptor.id, statusCode: response.status, requestId: request.requestId, model },
          error,
        );
      }
      if (!response.ok) {
        throw new AIChatProviderError(
          "PROVIDER_ERROR",
          normalizeText(payload.error?.message) ?? `Gemini respondió con el estado HTTP ${response.status}.`,
          {
            providerId: this.descriptor.id,
            providerName: this.descriptor.name,
            requestId: request.requestId,
            model,
            statusCode: response.status,
            retryable: response.status === 408 || response.status === 429 || response.status >= 500,
          },
          payload,
        );
      }
      return this.normalizeResponse(payload, request, model);
    } catch (error) {
      if (abort.didTimeout()) {
        throw new AIChatProviderError(
          "PROVIDER_ERROR",
          `La solicitud a Gemini excedió el tiempo máximo de ${this.geminiConfig.timeoutMilliseconds} ms.`,
          { providerId: this.descriptor.id, providerName: this.descriptor.name, requestId: request.requestId, model, retryable: true },
          error,
        );
      }
      throw error;
    } finally {
      abort.dispose();
    }
  }

  private normalizeResponse(payload: GeminiResponse, request: AIChatRequest, model: string): AIChatGenerationResult {
    const blockReason = normalizeText(payload.promptFeedback?.blockReason);
    if (blockReason !== undefined) {
      throw new AIChatProviderError(
        "INVALID_PROVIDER_RESPONSE",
        normalizeText(payload.promptFeedback?.blockReasonMessage) ?? `Gemini bloqueó la solicitud: ${blockReason}.`,
        { providerId: this.descriptor.id, providerName: this.descriptor.name, requestId: request.requestId, model, retryable: false },
        payload,
      );
    }
    const candidate = payload.candidates?.[0];
    if (candidate === undefined) {
      throw new AIChatProviderError(
        "INVALID_PROVIDER_RESPONSE",
        "Gemini no devolvió ningún candidato de respuesta.",
        { providerId: this.descriptor.id, requestId: request.requestId, model },
        payload,
      );
    }
    const parts = candidate.content?.parts ?? [];
    const content = parts.map((part) => part.text ?? "").join("");
    const toolCalls: AIChatToolCall[] = [];
    for (const [index, part] of parts.entries()) {
      const name = normalizeText(part.functionCall?.name);
      if (name === undefined) continue;
      toolCalls.push(Object.freeze({
        id: `gemini_tool_${index + 1}` as AIIdentifier,
        name,
        arguments: normalizeArguments(part.functionCall?.args),
      }));
    }
    if (content.length === 0 && toolCalls.length === 0) {
      throw new AIChatProviderError(
        "INVALID_PROVIDER_RESPONSE",
        "Gemini devolvió un candidato sin texto ni llamadas a herramientas.",
        { providerId: this.descriptor.id, requestId: request.requestId, model },
        payload,
      );
    }
    const frozenToolCalls = Object.freeze(toolCalls);
    const metadata: AIMetadata = frozenToolCalls.length === 0 ? {} : {
      toolCalls: JSON.stringify(frozenToolCalls.map((call) => ({ id: call.id, name: call.name, arguments: call.arguments }))),
    };
    const assistantMessage = createAIChatAssistantMessage({ content, toolCalls: frozenToolCalls, metadata });
    const usage = normalizeUsage(payload);
    const result: {
      provider: "google";
      model: string;
      content: string;
      message: typeof assistantMessage;
      toolCalls: readonly AIChatToolCall[];
      finishReason: AIChatFinishReason;
      usage?: AIChatUsage;
      raw: GeminiResponse;
    } = {
      provider: "google",
      model: normalizeText(payload.modelVersion) ?? model,
      content,
      message: assistantMessage,
      toolCalls: frozenToolCalls,
      finishReason: frozenToolCalls.length > 0 ? "tool_calls" : normalizeFinishReason(candidate.finishReason),
      raw: payload,
    };
    if (usage !== undefined) result.usage = usage;
    return Object.freeze(result);
  }
}

export function createGeminiChatProvider(config: GeminiChatProviderConfig): GeminiChatProvider {
  return new GeminiChatProvider(config);
}
