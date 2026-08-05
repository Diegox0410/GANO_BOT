import { useEffect, useMemo, useRef, useState } from "react";
import type {
  KnowledgeCollection,
  KnowledgeFolder,
  KnowledgeVersion,
  ManagedDocument,
  ManagedDocumentPreview,
  ManagedKnowledgeBase,
} from "@gano-bot/ai-core/knowledge-manager";
import { BackendKnowledgeManagerClient } from "./knowledgeManagerService";
import type {
  KnowledgeManagerClient,
  KnowledgeManagerJob,
  KnowledgeAssistantOption,
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
  const [folders, setFolders] = useState<readonly KnowledgeFolder[]>([]);
  const [collections, setCollections] = useState<readonly KnowledgeCollection[]>([]);
  const [assistants, setAssistants] = useState<readonly KnowledgeAssistantOption[]>([]);
  const [folderFilter, setFolderFilter] = useState("");
  const [collectionFilter, setCollectionFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [folderName, setFolderName] = useState("");
  const [collectionName, setCollectionName] = useState("");
  const [editing, setEditing] = useState<ManagedDocument>();
  const [editTitle, setEditTitle] = useState("");
  const [editLanguage, setEditLanguage] = useState("");
  const [editTags, setEditTags] = useState("");
  const [versions, setVersions] = useState<readonly KnowledgeVersion<ManagedDocument | ManagedKnowledgeBase>[]>([]);
  const [versionLabel, setVersionLabel] = useState("");
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
    setDocuments(await client.listDocuments(baseId, {
      ...(folderFilter === "" ? {} : { folderId: folderFilter }),
      ...(collectionFilter === "" ? {} : { collectionId: collectionFilter }),
      ...(tagFilter.trim() === "" ? {} : { tags: [tagFilter.trim()] }),
    }));
  };
  const refreshOrganization = async (baseId = activeBaseId): Promise<void> => {
    if (baseId === "") return;
    const [nextFolders, nextCollections] = await Promise.all([
      client.listFolders(baseId),
      client.listCollections(baseId),
    ]);
    setFolders(nextFolders);
    setCollections(nextCollections);
  };
  useEffect(() => {
    void refreshBases();
  }, [search]);
  useEffect(() => {
    void refreshDocuments();
    void refreshOrganization();
  }, [activeBaseId, folderFilter, collectionFilter, tagFilter]);
  useEffect(() => {
    void client.listAssistants().then(setAssistants).catch(() => setAssistants([]));
  }, [client]);
  const activeBase = bases.find((base) => base.knowledgeBaseId === activeBaseId);
  const perform = async (work: () => Promise<unknown>, success: string): Promise<void> => {
    setBusy(true);
    try {
      await work();
      await Promise.all([refreshBases(), refreshDocuments(), refreshOrganization()]);
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible completar la acción");
    } finally {
      setBusy(false);
    }
  };
  const openEditor = (document: ManagedDocument): void => {
    setEditing(document);
    setEditTitle(document.title);
    setEditLanguage(document.language);
    setEditTags(document.tags.join(", "));
  };
  const openVersions = async (kind: "bases" | "documents", id: string): Promise<void> => {
    const values = await client.listVersions<ManagedDocument | ManagedKnowledgeBase>(kind, id);
    setVersions(values);
    setVersionLabel(`${kind}:${id}`);
  };
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
        "gano-assistant",
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
          <div className="km-create">
            <select aria-label="Filtrar por carpeta" value={folderFilter} onChange={(event) => setFolderFilter(event.target.value)}>
              <option value="">Todas las carpetas</option>
              {folders.map((folder) => <option key={folder.folderId} value={folder.folderId}>{folder.name}</option>)}
            </select>
            <select aria-label="Filtrar por colección" value={collectionFilter} onChange={(event) => setCollectionFilter(event.target.value)}>
              <option value="">Todas las colecciones</option>
              {collections.map((collection) => <option key={collection.collectionId} value={collection.collectionId}>{collection.name}</option>)}
            </select>
            <input aria-label="Filtrar por tag" placeholder="Tag exacto" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} />
          </div>
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
                  <button onClick={() => openEditor(document)}>Metadata</button>
                  <button onClick={() => void openVersions("documents", document.documentId)}>Versiones</button>
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
          <hr />
          <h2>Organización</h2>
          <form className="km-create" onSubmit={(event) => { event.preventDefault(); if (folderName.trim() !== "") void perform(() => client.createFolder(activeBaseId, folderName).then(() => setFolderName("")), "Carpeta creada"); }}>
            <input aria-label="Nueva carpeta" placeholder="Nueva carpeta" value={folderName} onChange={(event) => setFolderName(event.target.value)} />
            <button disabled={busy || activeBaseId === ""}>Crear</button>
          </form>
          <ul className="km-files">
            {folders.map((folder) => <li key={folder.folderId}><strong>{folder.name}</strong><span><button onClick={() => { const value = prompt("Nuevo nombre", folder.name); if (value !== null) void perform(() => client.renameFolder(activeBaseId, folder.folderId, value), "Carpeta renombrada"); }}>Renombrar</button><button className="danger" onClick={() => void perform(() => client.deleteFolder(activeBaseId, folder.folderId), "Carpeta eliminada")}>Eliminar</button></span></li>)}
          </ul>
          <form className="km-create" onSubmit={(event) => { event.preventDefault(); if (collectionName.trim() !== "") void perform(() => client.createCollection(activeBaseId, collectionName).then(() => setCollectionName("")), "Colección creada"); }}>
            <input aria-label="Nueva colección" placeholder="Nueva colección" value={collectionName} onChange={(event) => setCollectionName(event.target.value)} />
            <button disabled={busy || activeBaseId === ""}>Crear</button>
          </form>
          <ul className="km-files">{collections.map((collection) => <li key={collection.collectionId}><strong>{collection.name}</strong><small>{collection.documentIds.length} documentos</small></li>)}</ul>
          <h2>Asistentes</h2>
          <ul className="km-files">
            {assistants.map((assistant) => {
              const associated = activeBase?.assistantIds.includes(assistant.id) ?? false;
              const crossTenant = activeBase !== undefined && assistant.tenantId !== activeBase.tenantId;
              return <li key={assistant.id}><div><strong>{assistant.name}</strong><small>{crossTenant ? "Asociación cruzada bloqueada" : associated ? "Asociado" : "Disponible"}</small></div><button disabled={busy || crossTenant || activeBaseId === ""} onClick={() => void perform(() => associated ? client.disassociateAssistant(activeBaseId, assistant.id) : client.associateAssistant(activeBaseId, assistant), associated ? "Asistente desasociado" : "Asistente asociado")}>{associated ? "Quitar" : "Asociar"}</button></li>;
            })}
          </ul>
          <button onClick={() => activeBaseId !== "" && void openVersions("bases", activeBaseId)}>Versiones de la base</button>
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
      {editing !== undefined && (
        <div className="km-modal" role="dialog" aria-modal="true" aria-label="Editar metadata documental"><article>
          <button aria-label="Cerrar editor" onClick={() => setEditing(undefined)}>×</button>
          <h2>Metadata documental</h2>
          <label>Título<input aria-label="Título documental" value={editTitle} onChange={(event) => setEditTitle(event.target.value)} /></label>
          <label>Idioma<input aria-label="Idioma documental" value={editLanguage} onChange={(event) => setEditLanguage(event.target.value)} /></label>
          <label>Tags<input aria-label="Tags documentales" value={editTags} onChange={(event) => setEditTags(event.target.value)} /></label>
          <label>Carpeta<select aria-label="Carpeta documental" value={editing.folderId ?? ""} onChange={(event) => { const folderId = event.target.value; void perform(() => client.moveDocument(editing.documentId, folderId || undefined).then((value) => setEditing(value)), "Documento movido"); }}><option value="">Sin carpeta</option>{folders.map((folder) => <option key={folder.folderId} value={folder.folderId}>{folder.name}</option>)}</select></label>
          <fieldset><legend>Colecciones</legend>{collections.map((collection) => <label key={collection.collectionId}><input type="checkbox" checked={editing.collectionIds.includes(collection.collectionId)} onChange={(event) => { const ids = event.target.checked ? [...editing.collectionIds, collection.collectionId] : editing.collectionIds.filter((id) => id !== collection.collectionId); void perform(() => client.setDocumentCollections(editing.documentId, ids).then((value) => setEditing(value)), "Colecciones actualizadas"); }} />{collection.name}</label>)}</fieldset>
          <button className="km-primary" disabled={editTitle.trim() === "" || editLanguage.trim() === ""} onClick={() => void perform(() => client.updateDocument(editing.documentId, { title: editTitle, language: editLanguage, tags: editTags.split(",").map((tag) => tag.trim()).filter(Boolean) }).then((value) => { setEditing(value); setEditing(undefined); }), "Metadata guardada en Backend")}>Guardar metadata</button>
        </article></div>
      )}
      {versions.length > 0 && (
        <div className="km-modal" role="dialog" aria-modal="true" aria-label="Historial de versiones"><article>
          <button aria-label="Cerrar versiones" onClick={() => { setVersions([]); setVersionLabel(""); }}>×</button>
          <h2>Versiones</h2><p>Compara metadata y restaura snapshots. Los binarios históricos no están disponibles; la restauración solo recupera metadata.</p>
          <ul>{versions.map((version) => <li key={version.versionId}><strong>v{version.version}</strong> · {version.reason} · {version.createdAt}<pre>{JSON.stringify(version.snapshot, null, 2)}</pre><button onClick={() => { const [kind, id] = versionLabel.split(":"); if ((kind === "bases" || kind === "documents") && id !== undefined) void perform(() => client.restoreVersion(kind, id, version.versionId), "Metadata restaurada").then(() => setVersions([])); }}>Restaurar metadata</button></li>)}</ul>
        </article></div>
      )}
    </div>
  );
}
