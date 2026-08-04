import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type {
  AIChatProvider,
  AIChatRequest,
  AIEmbeddingRequest,
  AIEmbeddingService,
} from "@gano-bot/ai-core";
import {
  createInMemoryKnowledgeRepository,
  createInMemoryVectorStore,
} from "@gano-bot/ai-core/knowledge";
import { createRAGPipeline } from "@gano-bot/ai-core/rag";
import { ingestLocalFiles } from "../runner.js";

const fixtureDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../tests/fixtures",
);
const embeddingService: AIEmbeddingService = Object.freeze({
  async embed(request: AIEmbeddingRequest) {
    const createdAt = "2026-08-04T00:00:00.000Z";
    return Object.freeze({
      model: "deterministic-test",
      embeddings: Object.freeze(
        request.inputs.map((input) =>
          Object.freeze({
            id: input.id,
            vector: Object.freeze([1, 0]),
            dimensions: 2,
            model: "deterministic-test",
            createdAt,
          }),
        ),
      ),
      usageTokens: request.inputs.length,
      durationMilliseconds: 0,
    });
  },
});
const chatProvider: AIChatProvider = Object.freeze({
  name: "custom",
  descriptor: Object.freeze({
    id: "rag-test-provider",
    name: "custom",
    displayName: "RAG test provider",
    defaultModel: "test",
    enabled: true,
    capabilities: Object.freeze({
      supportsStreaming: false,
      supportsTools: false,
      supportsJson: false,
      supportsMultimodal: false,
      supportsSeed: true,
    }),
  }),
  async generate(request: AIChatRequest) {
    const now = "2026-08-04T00:00:00.000Z";
    const content =
      "La evidencia recuperada contiene un primer párrafo [Fuente 1].";
    return Object.freeze({
      id: "generation-1",
      requestId: request.requestId,
      provider: "custom",
      model: "test",
      content,
      message: Object.freeze({
        id: "assistant-1",
        role: "assistant",
        content,
        contentType: "text",
        status: "completed",
        createdAt: now,
        updatedAt: now,
      }),
      toolCalls: Object.freeze([]),
      finishReason: "stop",
      createdAt: now,
      durationMilliseconds: 1,
      usage: Object.freeze({
        inputTokens: 10,
        outputTokens: 8,
        totalTokens: 18,
      }),
    });
  },
});

test("RAG end-to-end desde ingesta con aislamiento, citas y grounding", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gano-rag-"));
  try {
    await cp(
      join(fixtureDirectory, "sample.txt"),
      join(directory, "sample.txt"),
    );
    const repository = createInMemoryKnowledgeRepository();
    const ingestion = await ingestLocalFiles({
      rootDirectory: directory,
      tenantId: "tenant-rag",
      assistantId: "assistant-rag",
      knowledgeBaseId: "base-rag",
      repository,
      embeddingService,
    });
    assert.equal(ingestion.failedCount, 0);
    assert.ok(ingestion.embeddings.length > 0);
    const vectorStore = createInMemoryVectorStore("rag-test", 2);
    const context = {
      requestId: "index-request",
      correlationId: "index-correlation",
      tenantId: "tenant-rag",
      assistantId: "assistant-rag",
      knowledgeBaseId: "base-rag",
    };
    await vectorStore.upsert(ingestion.embeddings, context);
    const pipeline = createRAGPipeline(
      { repository, vectorStore, chatProvider, embeddingService },
      {
        groundingMode: "strict-private-knowledge",
        topK: 4,
        minimumScore: 0.5,
        contextBudget: {
          maximumCharacters: 2_000,
          maximumTokens: 500,
          maximumChunks: 3,
          maximumChunksPerDocument: 2,
        },
        citationsEnabled: true,
      },
    );
    const result = await pipeline.execute({
      query: "¿Qué contiene el primer párrafo?",
      tenantId: "tenant-rag",
      assistantId: "assistant-rag",
      knowledgeBaseId: "base-rag",
      requestId: "rag-request",
      correlationId: "rag-correlation",
    });
    assert.equal(result.status, "completed");
    assert.equal(result.grounding.valid, true);
    assert.ok(result.selectedChunks.length > 0);
    assert.equal(result.citations.length, result.selectedChunks.length);
    assert.ok(result.metrics.contextCharacterCount > 0);
    assert.ok(result.answer.includes("evidencia"));
    await assert.rejects(
      vectorStore.search({
        vector: [1, 0],
        filter: {
          tenantId: "other",
          assistantId: "assistant-rag",
          knowledgeBaseId: "base-rag",
        },
        limit: 1,
        context,
      }),
      /multiempresa/,
    );
    const noEvidence = await pipeline.execute({
      query: "sin coincidencia",
      queryEmbedding: [-1, 0],
      tenantId: "tenant-rag",
      assistantId: "assistant-rag",
      knowledgeBaseId: "base-rag",
      requestId: "no-evidence",
      correlationId: "no-evidence",
    });
    assert.equal(noEvidence.status, "insufficient-evidence");
    assert.equal(noEvidence.generation, undefined);
    const preferred = createRAGPipeline(
      { repository, vectorStore, chatProvider, embeddingService },
      { groundingMode: "private-knowledge-preferred", minimumScore: 0.5 },
    );
    const preferredResult = await preferred.execute({
      query: "primer párrafo",
      tenantId: "tenant-rag",
      assistantId: "assistant-rag",
      knowledgeBaseId: "base-rag",
      requestId: "preferred",
      correlationId: "preferred",
    });
    assert.equal(preferredResult.status, "completed");
    assert.ok(preferredResult.citations.length > 0);
    const general = createRAGPipeline(
      { repository, vectorStore, chatProvider, embeddingService },
      { groundingMode: "general-knowledge-allowed", minimumScore: 0.5 },
    );
    const generalResult = await general.execute({
      query: "consulta general",
      queryEmbedding: [-1, 0],
      tenantId: "tenant-rag",
      assistantId: "assistant-rag",
      knowledgeBaseId: "base-rag",
      requestId: "general",
      correlationId: "general",
    });
    assert.equal(generalResult.status, "completed");
    assert.equal(generalResult.citations.length, 0);
    assert.ok(generalResult.generation !== undefined);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      pipeline.execute({
        query: "cancelada",
        tenantId: "tenant-rag",
        assistantId: "assistant-rag",
        knowledgeBaseId: "base-rag",
        requestId: "cancelled",
        correlationId: "cancelled",
        signal: controller.signal,
      }),
      /cancelada/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
