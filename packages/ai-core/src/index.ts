/**
 * @gano-bot/ai-core
 *
 * Núcleo desacoplado de inteligencia artificial de GanoBot.
 *
 * Este paquete define contratos para:
 * - Proveedores de modelos de lenguaje.
 * - Generación de respuestas.
 * - Embeddings.
 * - Recuperación semántica.
 * - Flujo RAG.
 * - Fuentes y citas.
 */

import type {
  ChatMessage,
  ChatRole,
  ChatSourceReference,
  GanoBotContext,
  Identifier,
} from "@gano-bot/shared";

export const GANO_BOT_AI_CORE_VERSION = "0.1.0" as const;

export type AIProviderName =
  | "openai"
  | "google"
  | "anthropic"
  | "mock"
  | "custom";

export type AIRequestStatus =
  | "idle"
  | "processing"
  | "completed"
  | "failed";

export type FinishReason =
  | "stop"
  | "length"
  | "content-filter"
  | "tool-call"
  | "error"
  | "unknown";

export interface AIModelConfig {
  provider: AIProviderName;
  model: string;

  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  timeoutMs?: number;
}

export interface AIUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AIGenerationMessage {
  role: ChatRole;
  content: string;
}

export interface AIGenerationRequest {
  messages: AIGenerationMessage[];

  context?: GanoBotContext;
  systemPrompt?: string;

  config: AIModelConfig;

  metadata?: Record<string, unknown>;
}

export interface AIGenerationResponse {
  id: Identifier;

  provider: AIProviderName;
  model: string;

  content: string;
  finishReason: FinishReason;

  usage?: AIUsage;
  metadata?: Record<string, unknown>;
}

export interface AIProvider {
  readonly name: AIProviderName;

  generate(
    request: AIGenerationRequest,
  ): Promise<AIGenerationResponse>;
}

export interface EmbeddingRequest {
  texts: string[];

  model?: string;
  metadata?: Record<string, unknown>;
}

export interface EmbeddingVector {
  index: number;
  values: number[];
}

export interface EmbeddingResponse {
  model: string;
  dimensions: number;

  embeddings: EmbeddingVector[];

  usage?: AIUsage;
}

export interface EmbeddingProvider {
  readonly name: AIProviderName;

  embed(
    request: EmbeddingRequest,
  ): Promise<EmbeddingResponse>;
}

export interface KnowledgeDocument {
  id: Identifier;
  title: string;
  content: string;

  source?: string;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeChunk {
  id: Identifier;
  documentId: Identifier;

  title: string;
  content: string;

  position?: number;
  metadata?: Record<string, unknown>;
}

export interface RetrievedKnowledgeChunk
  extends KnowledgeChunk {
  score: number;
}

export interface RetrievalRequest {
  query: string;

  embedding?: number[];

  limit?: number;
  minimumScore?: number;

  filters?: Record<string, unknown>;
}

export interface RetrievalResponse {
  query: string;
  chunks: RetrievedKnowledgeChunk[];
}

export interface KnowledgeRetriever {
  retrieve(
    request: RetrievalRequest,
  ): Promise<RetrievalResponse>;
}

export interface RAGRequest {
  query: string;

  conversation?: ChatMessage[];
  context?: GanoBotContext;

  modelConfig: AIModelConfig;

  retrievalLimit?: number;
  minimumScore?: number;

  systemPrompt?: string;

  metadata?: Record<string, unknown>;
}

export interface RAGResponse {
  answer: string;

  generation: AIGenerationResponse;

  sources: ChatSourceReference[];
  retrievedChunks: RetrievedKnowledgeChunk[];
}

export interface RAGPipelineDependencies {
  provider: AIProvider;
  retriever: KnowledgeRetriever;
}

export interface RAGPipeline {
  execute(
    request: RAGRequest,
  ): Promise<RAGResponse>;
}

export class AIProviderNotConfiguredError
  extends Error {
  public readonly code =
    "AI_PROVIDER_NOT_CONFIGURED";

  public constructor(providerName: string) {
    super(
      `El proveedor de inteligencia artificial "${providerName}" no está configurado.`,
    );

    this.name =
      "AIProviderNotConfiguredError";
  }
}

export class AIProviderRequestError
  extends Error {
  public readonly code =
    "AI_PROVIDER_REQUEST_FAILED";

  public constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message, {
      cause,
    });

    this.name =
      "AIProviderRequestError";
  }
}

export class KnowledgeRetrievalError
  extends Error {
  public readonly code =
    "KNOWLEDGE_RETRIEVAL_FAILED";

  public constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message, {
      cause,
    });

    this.name =
      "KnowledgeRetrievalError";
  }
}

export function createGenerationMessage(
  role: ChatRole,
  content: string,
): AIGenerationMessage {
  return {
    role,
    content: content.trim(),
  };
}

export function createSourceReference(
  chunk: RetrievedKnowledgeChunk,
): ChatSourceReference {
  return {
    id: chunk.id,
    title: chunk.title,
    excerpt: chunk.content,
    documentId: chunk.documentId,
    score: chunk.score,
  };
}

export function buildContextBlock(
  chunks: RetrievedKnowledgeChunk[],
): string {
  if (chunks.length === 0) {
    return "";
  }

  return chunks
    .map((chunk, index) => {
      const sourceNumber = index + 1;

      return [
        `[Fuente ${sourceNumber}]`,
        `Título: ${chunk.title}`,
        `Contenido: ${chunk.content}`,
      ].join("\n");
    })
    .join("\n\n");
}

export function normalizeRetrievalLimit(
  value: number | undefined,
  fallback = 5,
): number {
  if (
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return fallback;
  }

  return Math.max(
    1,
    Math.floor(value),
  );
}

export function normalizeMinimumScore(
  value: number | undefined,
  fallback = 0,
): number {
  if (
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return fallback;
  }

  return Math.min(
    1,
    Math.max(0, value),
  );
}

function createGenerationRequest(
  request: RAGRequest,
  messages: AIGenerationMessage[],
): AIGenerationRequest {
  const generationRequest: AIGenerationRequest = {
    messages,
    config: request.modelConfig,
  };

  if (request.context !== undefined) {
    generationRequest.context =
      request.context;
  }

  if (request.systemPrompt !== undefined) {
    generationRequest.systemPrompt =
      request.systemPrompt;
  }

  if (request.metadata !== undefined) {
    generationRequest.metadata =
      request.metadata;
  }

  return generationRequest;
}

export function createRAGPipeline({
  provider,
  retriever,
}: RAGPipelineDependencies): RAGPipeline {
  return {
    async execute(
      request: RAGRequest,
    ): Promise<RAGResponse> {
      const query = request.query.trim();

      const retrievalLimit =
        normalizeRetrievalLimit(
          request.retrievalLimit,
        );

      const minimumScore =
        normalizeMinimumScore(
          request.minimumScore,
        );

      let retrieval: RetrievalResponse;

      try {
        retrieval =
          await retriever.retrieve({
            query,
            limit: retrievalLimit,
            minimumScore,
          });
      } catch (error) {
        throw new KnowledgeRetrievalError(
          "No se pudo recuperar información de la base de conocimiento.",
          error,
        );
      }

      const contextBlock =
        buildContextBlock(
          retrieval.chunks,
        );

      const conversationMessages =
        request.conversation?.map(
          (
            message,
          ): AIGenerationMessage => ({
            role: message.role,
            content: message.content,
          }),
        ) ?? [];

      const userMessageContent = [
        query,
        contextBlock
          ? [
              "",
              "Contexto recuperado:",
              contextBlock,
            ].join("\n")
          : "",
      ]
        .filter(
          (part) => part.length > 0,
        )
        .join("\n");

      const messages: AIGenerationMessage[] = [
        ...conversationMessages,
        createGenerationMessage(
          "user",
          userMessageContent,
        ),
      ];

      const generationRequest =
        createGenerationRequest(
          request,
          messages,
        );

      let generation: AIGenerationResponse;

      try {
        generation =
          await provider.generate(
            generationRequest,
          );
      } catch (error) {
        throw new AIProviderRequestError(
          "El proveedor de inteligencia artificial no pudo generar una respuesta.",
          error,
        );
      }

      return {
        answer: generation.content,
        generation,
        sources: retrieval.chunks.map(
          createSourceReference,
        ),
        retrievedChunks:
          retrieval.chunks,
      };
    },
  };
}

export type {
  ChatMessage,
  ChatRole,
  ChatSourceReference,
  GanoBotContext,
  Identifier,
} from "@gano-bot/shared";

export * from "./types.js";
export * from "./embeddings.js";
export * from "./providers/index.js";
export * from "./chat/index.js";
export * from "./runtime/index.js";
export {
  GANO_SIM_INTENT_RULES,
  GANO_SIM_ENTITY_PATTERNS,
} from "./intentDetector.js";
export * as KnowledgePlatform from "./knowledge/index.js";
export * as RAGEngine from "./rag/index.js";
export * as MemoryEngine from "./memory/index.js";
export * as ToolsEngine from "./tools-engine/index.js";
export * as KnowledgeManager from "./knowledge-manager/index.js";
