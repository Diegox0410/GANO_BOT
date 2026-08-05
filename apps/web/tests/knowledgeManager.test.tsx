import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { KnowledgeManagerApp } from "../src/features/knowledge-manager/KnowledgeManagerApp";
import type { KnowledgeManagerClient } from "../src/features/knowledge-manager/knowledgeManagerService";
const base = Object.freeze({
  knowledgeBaseId: "kb-ui",
  tenantId: "development-tenant",
  name: "Base UI",
  slug: "base-ui",
  description: "",
  language: "es",
  allowedLanguages: Object.freeze(["es"]),
  tags: Object.freeze([]),
  status: "ready" as const,
  version: 1,
  ownerId: "actor",
  createdBy: "actor",
  updatedBy: "actor",
  createdAt: "2026-08-04T00:00:00.000Z",
  updatedAt: "2026-08-04T00:00:00.000Z",
  assistantIds: Object.freeze([]),
  documentCount: 1,
  chunkCount: 1,
  totalSizeBytes: 10,
  configuration: Object.freeze({
    retrievalEnabled: true,
    embeddingState: "pending" as const,
    chunkingStrategyId: "heading",
  }),
  permissions: Object.freeze({ public: false }),
  metadata: Object.freeze({}),
});
const document = Object.freeze({
  documentId: "doc-ui",
  tenantId: "development-tenant",
  knowledgeBaseId: "kb-ui",
  assistantId: "support-assistant",
  title: "manual.md",
  originalFileName: "manual.md",
  source: "browser-upload",
  sourceKind: "markdown" as const,
  extension: ".md",
  mimeType: "text/markdown",
  sizeBytes: 20,
  language: "es",
  checksum: "abc",
  version: 1,
  status: "ready" as const,
  collectionIds: Object.freeze([]),
  tags: Object.freeze([]),
  permissions: Object.freeze({ public: false }),
  metadata: Object.freeze({}),
  createdBy: "actor",
  updatedBy: "actor",
  createdAt: "2026-08-04T00:00:00.000Z",
  updatedAt: "2026-08-04T00:00:00.000Z",
  chunkCount: 1,
});
describe("Knowledge Manager workflow", () => {
  it("envía File multipart mediante el puerto, muestra progreso, preview y reindexa", async () => {
    const upload = vi.fn(async () =>
      Object.freeze({
        jobId: "job-ui",
        status: "completed" as const,
        progress: 100,
        currentStage: "ready",
        documentIds: Object.freeze(["doc-ui"]),
        processedFiles: 1,
        failedFiles: 0,
        totalFiles: 1,
        errors: Object.freeze([]),
      }),
    );
    const preview = vi.fn(async () =>
      Object.freeze({
        documentId: "doc-ui",
        title: "manual.md",
        mimeType: "text/markdown",
        sizeBytes: 20,
        status: "ready" as const,
        checksum: "abc…",
        version: 1,
        metadata: Object.freeze({}),
        sections: Object.freeze(["Manual"]),
        pages: Object.freeze([]),
        sheets: Object.freeze([]),
        chunks: Object.freeze([
          { id: "chunk-ui", text: "Contenido trazable", index: 0 },
        ]),
        extractedText: "Contenido trazable",
      }),
    );
    const reindex = vi.fn(async () => document);
    const client: KnowledgeManagerClient = {
      listBases: async () =>
        Object.freeze({
          items: Object.freeze([base]),
          page: 1,
          pageSize: 20,
          total: 1,
          hasNext: false,
          hasPrevious: false,
        }),
      createBase: async () => base,
      upload,
      listDocuments: async () => Object.freeze([document]),
      preview,
      reindex,
      reprocess: async () => document,
      archiveDocument: async () =>
        Object.freeze({ ...document, status: "archived" as const }),
      restoreDocument: async () => document,
      retry: async () => {
        throw new Error("no usado");
      },
      cancel: async () => {
        throw new Error("no usado");
      },
    };
    const user = userEvent.setup();
    render(<KnowledgeManagerApp client={client} />);
    expect(await screen.findByText("manual.md")).toBeInTheDocument();
    const input = screen.getByLabelText(
      "Suelta archivos aquí",
    ) as HTMLInputElement;
    await user.upload(
      input,
      new File(["# Manual"], "nuevo.md", { type: "text/markdown" }),
    );
    await user.click(screen.getByRole("button", { name: "Iniciar ingesta" }));
    await waitFor(() => expect(upload).toHaveBeenCalledOnce());
    expect((await screen.findAllByText("100%")).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(
      await screen.findByRole("dialog", { name: "Preview de documento" }),
    ).toHaveTextContent("Contenido trazable");
    await user.click(screen.getByLabelText("Cerrar preview"));
    await user.click(screen.getByRole("button", { name: "Reindexar" }));
    await waitFor(() => expect(reindex).toHaveBeenCalledOnce());
  });
});
