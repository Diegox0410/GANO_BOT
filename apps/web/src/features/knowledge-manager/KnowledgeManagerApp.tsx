import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ManagedDocument,
  ManagedDocumentPreview,
  ManagedKnowledgeBase,
} from "@gano-bot/ai-core/knowledge-manager";
import { BackendKnowledgeManagerClient } from "./knowledgeManagerService";
import type {
  KnowledgeManagerClient,
  KnowledgeManagerJob,
} from "./knowledgeManagerService";
export interface KnowledgeManagerAppProps {
  readonly client?: KnowledgeManagerClient;
}
export function KnowledgeManagerApp({
  client: supplied,
}: KnowledgeManagerAppProps): React.JSX.Element {
  const client = useMemo(
    () => supplied ?? new BackendKnowledgeManagerClient(),
    [supplied],
  );
  const [bases, setBases] = useState<readonly ManagedKnowledgeBase[]>([]);
  const [activeBaseId, setActiveBaseId] = useState("");
  const [documents, setDocuments] = useState<readonly ManagedDocument[]>([]);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [files, setFiles] = useState<readonly File[]>([]);
  const [job, setJob] = useState<KnowledgeManagerJob>();
  const [preview, setPreview] = useState<ManagedDocumentPreview>();
  const [message, setMessage] = useState("Conectado al Backend de desarrollo");
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined);
  const refreshBases = async (): Promise<void> => {
    try {
      const page = await client.listBases(search);
      setBases(page.items);
      setActiveBaseId(
        (current) => current || page.items[0]?.knowledgeBaseId || "",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Backend no disponible");
    }
  };
  const refreshDocuments = async (baseId = activeBaseId): Promise<void> => {
    if (baseId === "") return;
    setDocuments(await client.listDocuments(baseId));
  };
  useEffect(() => {
    void refreshBases();
  }, [search]);
  useEffect(() => {
    void refreshDocuments();
  }, [activeBaseId]);
  const create = async (): Promise<void> => {
    if (name.trim() === "") return;
    setBusy(true);
    try {
      const base = await client.createBase(name);
      setName("");
      setActiveBaseId(base.knowledgeBaseId);
      await refreshBases();
      setMessage("Base creada y versionada");
    } finally {
      setBusy(false);
    }
  };
  const accept = (list: FileList | null): void => {
    if (list === null) return;
    const allowed = [
      ".pdf",
      ".docx",
      ".xlsx",
      ".txt",
      ".md",
      ".markdown",
      ".json",
      ".csv",
      ".html",
      ".htm",
    ];
    const selected = [...list].filter(
      (file) =>
        file.size > 0 &&
        file.size <= 25 * 1024 * 1024 &&
        allowed.some((extension) =>
          file.name.toLowerCase().endsWith(extension),
        ),
    );
    setFiles(Object.freeze(selected));
    setMessage(`${selected.length} archivo(s) validados`);
  };
  const upload = async (): Promise<void> => {
    if (activeBaseId === "" || files.length === 0) return;
    const next = new AbortController();
    controller.current = next;
    setBusy(true);
    setJob({
      jobId: "pending",
      status: "processing",
      progress: 0,
      currentStage: "validating",
      documentIds: Object.freeze([]),
      processedFiles: 0,
      failedFiles: 0,
      totalFiles: files.length,
      errors: Object.freeze([]),
    });
    try {
      const value = await client.upload(
        activeBaseId,
        "support-assistant",
        files,
        next.signal,
      );
      setJob(value);
      setFiles(Object.freeze([]));
      await refreshDocuments();
      await refreshBases();
      setMessage(
        value.status === "completed"
          ? "Ingesta completada"
          : "Ingesta completada con incidencias",
      );
    } catch (error) {
      if (next.signal.aborted) setMessage("Ingesta cancelada");
      else
        setMessage(error instanceof Error ? error.message : "Falló la ingesta");
    } finally {
      setBusy(false);
      controller.current = undefined;
    }
  };
  const openPreview = async (id: string): Promise<void> => {
    setPreview(await client.preview(id));
  };
  const documentAction = async (
    document: ManagedDocument,
    action: "reindex" | "reprocess" | "archive" | "restore",
  ): Promise<void> => {
    setBusy(true);
    try {
      if (action === "reindex") await client.reindex(document.documentId);
      else if (action === "reprocess")
        await client.reprocess(document.documentId);
      else if (action === "archive")
        await client.archiveDocument(document.documentId);
      else await client.restoreDocument(document.documentId);
      await refreshDocuments();
      setMessage(`${action} completado`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="km-shell">
      <header className="km-header">
        <div>
          <span>Knowledge Manager · Hito 12A</span>
          <h1>Conocimiento privado, organizado y trazable</h1>
          <p>
            Upload real por multipart, ingesta, chunks, preview y reindexación.
          </p>
        </div>
        <a href="/studio">Abrir Assistant Studio</a>
      </header>
      <section className="km-metrics" aria-label="Resumen">
        <article>
          <strong>{bases.length}</strong>
          <span>Bases</span>
        </article>
        <article>
          <strong>{documents.length}</strong>
          <span>Documentos</span>
        </article>
        <article>
          <strong>
            {documents.reduce((sum, item) => sum + item.chunkCount, 0)}
          </strong>
          <span>Chunks</span>
        </article>
        <article>
          <strong>{job?.progress ?? 0}%</strong>
          <span>Progreso</span>
        </article>
      </section>
      <main className="km-grid">
        <section className="km-panel">
          <div className="km-title">
            <div>
              <h2>Bases y documentos</h2>
              <p>Selecciona una base para administrar su contenido.</p>
            </div>
            <input
              aria-label="Buscar bases"
              placeholder="Buscar…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <form
            className="km-create"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <input
              aria-label="Nombre de la base"
              placeholder="Nueva base de conocimiento"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <button
              className="km-primary"
              disabled={busy || name.trim() === ""}
            >
              Crear base
            </button>
          </form>
          <label>
            Base activa
            <select
              aria-label="Base activa"
              value={activeBaseId}
              onChange={(event) => setActiveBaseId(event.target.value)}
            >
              <option value="">Selecciona…</option>
              {bases.map((base) => (
                <option key={base.knowledgeBaseId} value={base.knowledgeBaseId}>
                  {base.name}
                </option>
              ))}
            </select>
          </label>
          <div className="km-list">
            {documents.map((document) => (
              <article key={document.documentId}>
                <div>
                  <span className={`km-status km-${document.status}`}>
                    {document.status}
                  </span>
                  <h3>{document.title}</h3>
                  <small>
                    v{document.version} · {document.chunkCount} chunks ·{" "}
                    {document.mimeType}
                  </small>
                </div>
                <div className="km-actions">
                  <button onClick={() => void openPreview(document.documentId)}>
                    Preview
                  </button>
                  <button
                    onClick={() => void documentAction(document, "reindex")}
                  >
                    Reindexar
                  </button>
                  <button
                    onClick={() => void documentAction(document, "reprocess")}
                  >
                    Reprocesar
                  </button>
                  <button
                    className={document.status === "archived" ? "" : "danger"}
                    onClick={() =>
                      void documentAction(
                        document,
                        document.status === "archived" ? "restore" : "archive",
                      )
                    }
                  >
                    {document.status === "archived" ? "Restaurar" : "Archivar"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
        <aside className="km-panel">
          <h2>Upload manual</h2>
          <p>PDF, DOCX, XLSX, TXT, Markdown, JSON, CSV y HTML.</p>
          <label className="km-drop">
            <input
              aria-label="Suelta archivos aquí"
              type="file"
              multiple
              accept=".pdf,.docx,.xlsx,.txt,.md,.markdown,.json,.csv,.html,.htm"
              onChange={(event) => accept(event.target.files)}
            />
            <strong>Suelta archivos aquí</strong>
            <span>o haz clic para seleccionarlos</span>
          </label>
          <ul className="km-files">
            {files.map((file) => (
              <li key={`${file.name}-${file.size}`}>
                <div>
                  <strong>{file.name}</strong>
                  <small>
                    {(file.size / 1024).toFixed(1)} KB ·{" "}
                    {file.type || "MIME por validar"}
                  </small>
                </div>
                <button
                  onClick={() =>
                    setFiles(
                      Object.freeze(files.filter((item) => item !== file)),
                    )
                  }
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
          <button
            className="km-primary"
            disabled={busy || files.length === 0 || activeBaseId === ""}
            onClick={() => void upload()}
          >
            Iniciar ingesta
          </button>
          {busy && (
            <button
              className="km-secondary"
              onClick={() => controller.current?.abort()}
            >
              Cancelar
            </button>
          )}
          {job !== undefined && (
            <div className="km-progress">
              <progress max="100" value={job.progress}>
                {job.progress}%
              </progress>
              <strong>{job.currentStage}</strong>
              <span>
                {job.processedFiles}/{job.totalFiles} archivos
              </span>
              {job.status === "failed" && (
                <button
                  onClick={() => void client.retry(job.jobId).then(setJob)}
                >
                  Reintentar
                </button>
              )}
            </div>
          )}
          <p className="km-message" role="status">
            {message}
          </p>
        </aside>
      </main>
      {preview !== undefined && (
        <div
          className="km-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Preview de documento"
        >
          <article>
            <button
              aria-label="Cerrar preview"
              onClick={() => setPreview(undefined)}
            >
              ×
            </button>
            <h2>{preview.title}</h2>
            <p>
              {preview.mimeType} · {preview.sizeBytes} bytes · checksum{" "}
              {preview.checksum} · v{preview.version}
            </p>
            <pre>{preview.extractedText}</pre>
            <h3>Primeros chunks</h3>
            <ol>
              {preview.chunks.map((chunk) => (
                <li key={chunk.id}>{chunk.text}</li>
              ))}
            </ol>
          </article>
        </div>
      )}
    </div>
  );
}
