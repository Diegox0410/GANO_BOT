import {
  InMemoryKnowledgeManagerRepository,
  KnowledgeManagerService,
} from "@gano-bot/ai-core/knowledge-manager";
import { BrowserBytesDocumentProcessor } from "@gano-bot/ingestion";
import {
  createCitationBuilder,
  createRetriever,
} from "@gano-bot/ai-core/knowledge";
import { createBackendApplication } from "../application.js";
import { InMemoryAssistantRepository } from "../repositories.js";
import type { BackendChatGateway } from "../services.js";
const processor = new BrowserBytesDocumentProcessor();
const manager = new KnowledgeManagerService({
  repository: new InMemoryKnowledgeManagerRepository(),
  processor,
  generateId: (() => {
    let id = 0;
    return (prefix: string) => `${prefix}-${++id}`;
  })(),
});
const assert = Object.freeze({
  equal(actual: unknown, expected: unknown): void {
    if (actual !== expected)
      throw new Error(
        `Esperado ${String(expected)}, recibido ${String(actual)}`,
      );
  },
  ok(value: unknown): void {
    if (!value) throw new Error("Aserción fallida");
  },
  match(value: string, pattern: RegExp): void {
    if (!pattern.test(value)) throw new Error(`No coincide: ${value}`);
  },
});
const gateway: BackendChatGateway = Object.freeze({
  async generate() {
    throw new Error("No usado");
  },
});
const app = createBackendApplication(
  {
    chat: gateway,
    assistants: new InMemoryAssistantRepository(),
    knowledgeManager: manager,
  },
  { maximumBodyBytes: 60 * 1024 * 1024 },
);
const headers = {
  authorization: "Bearer dev:tenant-http:actor-http:tenant-admin",
};
async function data<T>(response: Response): Promise<T> {
  const value: unknown = await response.json();
  if (
    typeof value !== "object" ||
    value === null ||
    !("success" in value) ||
    value.success !== true ||
    !("data" in value)
  )
    throw new Error(`Respuesta inválida ${response.status}`);
  return value.data as T;
}
const created = await data<{ readonly knowledgeBaseId: string }>(
  await app.handle(
    new Request("http://local/v1/knowledge-manager/bases", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "HTTP real" }),
    }),
  ),
);
const form = new FormData();
form.set("assistantId", "assistant-http");
form.append(
  "files",
  new File(["# Garantía\n\nLa garantía dura dos años."], "garantia.md", {
    type: "text/markdown",
  }),
);
form.append(
  "files",
  new File(["producto,plazo\nA,30 días"], "productos.csv", {
    type: "text/csv",
  }),
);
const uploadResponse = await app.handle(
  new Request(
    `http://local/v1/knowledge-manager/bases/${created.knowledgeBaseId}/documents`,
    { method: "POST", headers, body: form },
  ),
);
assert.equal(uploadResponse.status, 202);
const job = await data<{
  readonly status: string;
  readonly documentIds: readonly string[];
  readonly processedFiles: number;
  readonly progress: number;
}>(uploadResponse);
assert.equal(job.status, "completed");
assert.equal(job.processedFiles, 2);
assert.equal(job.progress, 100);
const docs = await data<
  readonly {
    readonly documentId: string;
    readonly chunkCount: number;
    readonly status: string;
  }[]
>(
  await app.handle(
    new Request(
      `http://local/v1/knowledge-manager/bases/${created.knowledgeBaseId}/documents`,
      { headers },
    ),
  ),
);
assert.equal(docs.length, 2);
assert.ok(
  docs.every(
    (document) => document.status === "ready" && document.chunkCount > 0,
  ),
);
const firstId = job.documentIds[0];
if (firstId === undefined) throw new Error("Falta documentId");
const preview = await data<{
  readonly extractedText: string;
  readonly checksum: string;
  readonly chunks: readonly unknown[];
}>(
  await app.handle(
    new Request(
      `http://local/v1/knowledge-manager/documents/${firstId}/preview`,
      { headers },
    ),
  ),
);
assert.match(preview.extractedText, /garantía/i);
assert.match(preview.checksum, /…$/);
assert.ok(preview.chunks.length > 0);
const reindex = await app.handle(
  new Request(
    `http://local/v1/knowledge-manager/documents/${firstId}/reindex`,
    { method: "POST", headers },
  ),
);
assert.equal(reindex.status, 200);
const invalid = await app.handle(
  new Request(
    `http://local/v1/knowledge-manager/bases/${created.knowledgeBaseId}/documents`,
    {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: "{}",
    },
  ),
);
assert.equal(invalid.status, 415);
const crossTenant = await app.handle(
  new Request(
    `http://local/v1/knowledge-manager/documents/${firstId}/preview`,
    {
      headers: { authorization: "Bearer dev:tenant-other:actor:tenant-admin" },
    },
  ),
);
assert.equal(crossTenant.status, 404);
const managed = await manager.getDocument(
  Object.freeze({
    actorId: "actor-http",
    tenantId: "tenant-http",
    permissions: Object.freeze(["documents:read"] as const),
  }),
  firstId,
);
const chunks = await processor.getChunks(managed);
const retriever = createRetriever({
  source: {
    async retrieveCandidates() {
      return Object.freeze(
        chunks.map((chunk) => Object.freeze({ chunk, score: 1 })),
      );
    },
  },
});
const retrieval = await retriever.retrieve({
  query: "garantía",
  filters: {
    tenantId: "tenant-http",
    assistantId: "assistant-http",
    knowledgeBaseId: created.knowledgeBaseId,
  },
  context: {
    requestId: "rag-http",
    correlationId: "rag-http",
    tenantId: "tenant-http",
    assistantId: "assistant-http",
    knowledgeBaseId: created.knowledgeBaseId,
  },
});
const citations = await createCitationBuilder().build({
  results: retrieval.items,
  documents: { [firstId]: { title: managed.title, source: managed.source } },
});
assert.ok(retrieval.items.some((item) => /garantía/i.test(item.chunk.content)));
assert.equal(citations[0]?.documentId, firstId);
console.log(
  "Knowledge Manager Backend: multipart, jobs, preview, tenant, reindex, RAG y citas OK",
);
