import { useEffect, useMemo, useState } from "react";
import { AssistantWidget } from "@gano-bot/chat-widget";
import {
  createEmptyAssistant,
  importStudioAssistant,
  safeExportAssistant,
  validateStudioAssistant,
} from "./domain";
import type {
  AssistantStudioService,
  GroundingMode,
  StudioAssistant,
  StudioDocument,
  StudioKnowledgeBase,
  StudioTool,
} from "./domain";
type Route = {
  readonly page: "dashboard" | "assistants" | "new" | "editor" | "not-found";
  readonly assistantId?: string;
  readonly section?: string;
};
const SECTIONS = Object.freeze([
  "overview",
  "identity",
  "behavior",
  "models",
  "knowledge",
  "memory",
  "tools",
  "widget",
  "test",
  "publish",
]);
function route(path: string): Route {
  if (path === "/" || path === "/dashboard") return { page: "dashboard" };
  if (path === "/assistants") return { page: "assistants" };
  if (path === "/assistants/new") return { page: "new" };
  const match = /^\/assistants\/([^/]+)(?:\/([^/]+))?$/.exec(path);
  if (match !== null && match[1] !== undefined) {
    const section = match[2] ?? "overview";
    return SECTIONS.includes(section)
      ? { page: "editor", assistantId: decodeURIComponent(match[1]), section }
      : { page: "not-found" };
  }
  return { page: "not-found" };
}
function navigate(path: string): void {
  history.pushState({}, "", path);
  dispatchEvent(new PopStateEvent("popstate"));
}
function permitted(
  service: AssistantStudioService,
  permission: ReturnType<
    AssistantStudioService["getPrincipal"]
  >["permissions"][number],
): boolean {
  return service.getPrincipal().permissions.includes(permission);
}
export function StudioApp({
  service,
}: {
  readonly service: AssistantStudioService;
}) {
  const [current, setCurrent] = useState(() => route(location.pathname));
  const [assistants, setAssistants] = useState<readonly StudioAssistant[]>([]);
  const [knowledge, setKnowledge] = useState<readonly StudioKnowledgeBase[]>(
    [],
  );
  const [documents, setDocuments] = useState<readonly StudioDocument[]>([]);
  const [tools, setTools] = useState<readonly StudioTool[]>([]);
  const [health, setHealth] = useState<"ready" | "degraded">("degraded");
  const [loading, setLoading] = useState(true);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [error, setError] = useState<string>();
  const refresh = async (signal?: AbortSignal): Promise<void> => {
    setLoading(true);
    try {
      const [
        nextAssistants,
        nextKnowledge,
        nextDocuments,
        nextTools,
        nextHealth,
      ] = await Promise.all([
        service.listAssistants(signal),
        service.listKnowledgeBases(signal),
        service.listDocuments(signal),
        service.listTools(signal),
        service.health(signal),
      ]);
      setAssistants(nextAssistants);
      setKnowledge(nextKnowledge);
      setDocuments(nextDocuments);
      setTools(nextTools);
      setHealth(nextHealth);
      setError(undefined);
    } catch (cause) {
      if (signal?.aborted) return;
      setError(
        cause instanceof Error ? cause.message : "No se pudo cargar el Studio.",
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };
  useEffect(() => {
    const listener = (): void => setCurrent(route(location.pathname));
    addEventListener("popstate", listener);
    return () => removeEventListener("popstate", listener);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [service]);
  return (
    <div className="studio">
      <aside
        className={`studio-sidebar ${navigationOpen ? "studio-sidebar-open" : ""}`}
      >
        <div className="studio-brand">
          <span>EA</span>
          <div>
            <strong>Assistant Studio</strong>
            <small>Entorno de desarrollo</small>
          </div>
        </div>
        <nav aria-label="Navegación principal">
          <Nav href="/dashboard" active={current.page === "dashboard"}>
            Resumen
          </Nav>
          <Nav
            href="/assistants"
            active={
              current.page === "assistants" ||
              current.page === "new" ||
              current.page === "editor"
            }
          >
            Asistentes
          </Nav>
        </nav>
        <div className="studio-environment">
          <span className={`studio-dot studio-dot-${health}`} />
          {health === "ready" ? "Servicios listos" : "Servicios degradados"}
          <small>
            {service.kind === "development-memory"
              ? "Datos volátiles de desarrollo"
              : "Backend conectado"}
          </small>
        </div>
      </aside>
      <main className="studio-main">
        <header className="studio-topbar">
          <button
            className="studio-menu"
            type="button"
            aria-label="Abrir navegación"
            aria-expanded={navigationOpen}
            onClick={() => setNavigationOpen((value) => !value)}
          >
            ☰
          </button>
          <div>
            <strong>Workspace empresarial</strong>
            <small>Tenant: {service.getPrincipal().tenantId}</small>
          </div>
          <span className="studio-user">{service.getPrincipal().actorId}</span>
        </header>
        <div className="studio-content">
          {error !== undefined && (
            <div className="studio-alert studio-alert-error" role="alert">
              {error}
              <button type="button" onClick={() => void refresh()}>
                Reintentar
              </button>
            </div>
          )}
          {loading ? (
            <Loading />
          ) : current.page === "dashboard" ? (
            <Dashboard
              assistants={assistants}
              knowledge={knowledge}
              documents={documents}
              tools={tools}
              health={health}
            />
          ) : current.page === "assistants" ? (
            <AssistantList
              assistants={assistants}
              service={service}
              onRefresh={refresh}
            />
          ) : current.page === "new" ? (
            <CreateAssistant service={service} />
          ) : current.page === "editor" && current.assistantId !== undefined ? (
            <AssistantEditor
              key={current.assistantId}
              service={service}
              assistantId={current.assistantId}
              section={current.section ?? "overview"}
              knowledge={knowledge}
              documents={documents}
              tools={tools}
              onSaved={refresh}
            />
          ) : (
            <NotFound />
          )}
        </div>
      </main>
    </div>
  );
}
function Nav({
  href,
  active,
  children,
}: {
  readonly href: string;
  readonly active: boolean;
  readonly children: string;
}) {
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      onClick={(event) => {
        event.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}
function Loading() {
  return (
    <div className="studio-loading" role="status">
      <span />
      Cargando Assistant Studio…
    </div>
  );
}
function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly actions?: React.ReactNode;
}) {
  return (
    <header className="studio-page-header">
      <div>
        <small>{eyebrow}</small>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions !== undefined && <div className="studio-actions">{actions}</div>}
    </header>
  );
}
function Dashboard({
  assistants,
  knowledge,
  documents,
  tools,
  health,
}: {
  readonly assistants: readonly StudioAssistant[];
  readonly knowledge: readonly StudioKnowledgeBase[];
  readonly documents: readonly StudioDocument[];
  readonly tools: readonly StudioTool[];
  readonly health: string;
}) {
  const metrics = [
    { label: "Asistentes", value: assistants.length },
    {
      label: "Publicados",
      value: assistants.filter((item) => item.status === "published").length,
    },
    {
      label: "Borradores",
      value: assistants.filter((item) => item.status === "draft").length,
    },
    { label: "Knowledge bases", value: knowledge.length },
    { label: "Documentos", value: documents.length },
    { label: "Tools disponibles", value: tools.length },
  ];
  return (
    <>
      <PageHeader
        eyebrow="DESARROLLO"
        title="Resumen del workspace"
        description="Configura y valida asistentes empresariales sin credenciales externas."
        actions={
          <button
            className="studio-button studio-primary"
            type="button"
            onClick={() => navigate("/assistants/new")}
          >
            Crear asistente
          </button>
        }
      />
      <section className="studio-metrics" aria-label="Métricas de desarrollo">
        {metrics.map((item) => (
          <article className="studio-metric" key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </article>
        ))}
      </section>
      <section className="studio-grid">
        <article className="studio-card">
          <h2>Estado de servicios</h2>
          <p>
            <span className={`studio-dot studio-dot-${health}`} />
            {health === "ready"
              ? "Todos los adaptadores responden."
              : "Uno o más adaptadores no están disponibles."}
          </p>
          <p className="studio-muted">
            No representa disponibilidad productiva.
          </p>
        </article>
        <article className="studio-card">
          <h2>Acciones rápidas</h2>
          <div className="studio-stack">
            <button
              className="studio-button"
              type="button"
              onClick={() => navigate("/assistants")}
            >
              Ver asistentes
            </button>
            <button
              className="studio-button"
              type="button"
              onClick={() => navigate("/assistants/new")}
            >
              Nuevo borrador
            </button>
          </div>
        </article>
      </section>
    </>
  );
}
function AssistantList({
  assistants,
  service,
  onRefresh,
}: {
  readonly assistants: readonly StudioAssistant[];
  readonly service: AssistantStudioService;
  readonly onRefresh: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [busy, setBusy] = useState<string>();
  const visible = useMemo(
    () =>
      assistants
        .filter(
          (item) =>
            (status === "all" || item.status === status) &&
            (item.identity.name.toLowerCase().includes(query.toLowerCase()) ||
              item.id.includes(query.toLowerCase())),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [assistants, query, status],
  );
  const action = async (
    id: string,
    type: "duplicate" | "archive" | "delete",
  ): Promise<void> => {
    if (
      type === "delete" &&
      !confirm("¿Eliminar este asistente de desarrollo?")
    )
      return;
    setBusy(id);
    try {
      if (type === "duplicate") await service.duplicateAssistant(id);
      else if (type === "archive") await service.archiveAssistant(id);
      else await service.deleteAssistant(id);
      await onRefresh();
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="CATÁLOGO"
        title="Asistentes"
        description="Borradores y versiones preparadas dentro del tenant actual."
        actions={
          permitted(service, "assistants:write") ? (
            <button
              className="studio-button studio-primary"
              type="button"
              onClick={() => navigate("/assistants/new")}
            >
              Crear asistente
            </button>
          ) : undefined
        }
      />
      <div className="studio-toolbar">
        <label>
          Buscar
          <input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Nombre o ID"
          />
        </label>
        <label>
          Estado
          <select
            value={status}
            onChange={(event) => setStatus(event.currentTarget.value)}
          >
            <option value="all">Todos</option>
            {["draft", "ready", "published", "archived", "error"].map(
              (value) => (
                <option value={value} key={value}>
                  {value}
                </option>
              ),
            )}
          </select>
        </label>
      </div>
      {visible.length === 0 ? (
        <div className="studio-empty">
          <h2>No hay asistentes</h2>
          <p>Crea el primer borrador para iniciar el flujo guiado.</p>
        </div>
      ) : (
        <div className="studio-assistant-list">
          {visible.map((item) => (
            <article
              className="studio-card studio-assistant-card"
              key={item.id}
            >
              <div>
                <span className={`studio-badge studio-badge-${item.status}`}>
                  {item.status}
                </span>
                <h2>{item.identity.name || item.id}</h2>
                <p>{item.identity.description || "Sin descripción"}</p>
                <small>
                  {item.id} · v{item.version} ·{" "}
                  {item.model.primaryProviderId || "Sin proveedor"}
                </small>
              </div>
              <div className="studio-card-actions">
                <button
                  className="studio-button studio-primary"
                  type="button"
                  onClick={() => navigate(`/assistants/${item.id}`)}
                >
                  Abrir
                </button>
                <button
                  className="studio-button"
                  disabled={busy === item.id}
                  type="button"
                  onClick={() => void action(item.id, "duplicate")}
                >
                  Duplicar
                </button>
                <button
                  className="studio-button"
                  disabled={busy === item.id}
                  type="button"
                  onClick={() => void action(item.id, "archive")}
                >
                  Archivar
                </button>
                <button
                  className="studio-button studio-danger"
                  disabled={busy === item.id}
                  type="button"
                  onClick={() => void action(item.id, "delete")}
                >
                  Eliminar
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
function CreateAssistant({
  service,
}: {
  readonly service: AssistantStudioService;
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const create = async (): Promise<void> => {
    const normalized = id.trim().toLowerCase();
    if (
      !/^[a-z0-9][a-z0-9-]{2,63}$/.test(normalized) ||
      name.trim().length === 0
    ) {
      setError("Completa un nombre y un ID seguro.");
      return;
    }
    setSaving(true);
    try {
      const base = createEmptyAssistant(
        service.getPrincipal().tenantId,
        service.getPrincipal().actorId,
        normalized,
      );
      await service.saveAssistant(
        Object.freeze({
          ...base,
          identity: Object.freeze({ ...base.identity, name: name.trim() }),
        }),
      );
      navigate(`/assistants/${normalized}/identity`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="NUEVO ASISTENTE"
        title="Crear borrador"
        description="Primero define una identidad segura. Podrás completar las demás secciones después."
      />
      <section className="studio-card studio-form">
        <Field label="Nombre" value={name} onChange={setName} required />
        <Field
          label="Assistant ID"
          value={id}
          onChange={setId}
          required
          hint="Minúsculas, números y guiones; entre 3 y 64 caracteres."
        />
        {error !== undefined && (
          <p className="studio-field-error" role="alert">
            {error}
          </p>
        )}
        <div className="studio-actions">
          <button
            className="studio-button"
            type="button"
            onClick={() => navigate("/assistants")}
          >
            Cancelar
          </button>
          <button
            className="studio-button studio-primary"
            disabled={saving}
            type="button"
            onClick={() => void create()}
          >
            {saving ? "Creando…" : "Crear y continuar"}
          </button>
        </div>
      </section>
    </>
  );
}
function Field({
  label,
  value,
  onChange,
  type = "text",
  hint,
  required = false,
  min,
  max,
}: {
  readonly label: string;
  readonly value: string | number;
  readonly onChange: (value: string) => void;
  readonly type?: string;
  readonly hint?: string;
  readonly required?: boolean;
  readonly min?: number;
  readonly max?: number;
}) {
  return (
    <label className="studio-field">
      <span>
        {label}
        {required && " *"}
      </span>
      <input
        type={type}
        value={value}
        required={required}
        min={min}
        max={max}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {hint !== undefined && <small>{hint}</small>}
    </label>
  );
}
function Switch({
  label,
  checked,
  onChange,
  description,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (value: boolean) => void;
  readonly description?: string;
}) {
  return (
    <label className="studio-switch">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span>
        <strong>{label}</strong>
        {description !== undefined && <small>{description}</small>}
      </span>
    </label>
  );
}

function AssistantEditor({
  service,
  assistantId,
  section,
  knowledge,
  documents,
  tools,
  onSaved,
}: {
  readonly service: AssistantStudioService;
  readonly assistantId: string;
  readonly section: string;
  readonly knowledge: readonly StudioKnowledgeBase[];
  readonly documents: readonly StudioDocument[];
  readonly tools: readonly StudioTool[];
  readonly onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<StudioAssistant>();
  const [saved, setSaved] = useState<StudioAssistant>();
  const [state, setState] = useState<
    | "loading"
    | "unsaved"
    | "saving"
    | "saved"
    | "validating"
    | "publishing"
    | "error"
  >("loading");
  const [notice, setNotice] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    void service.getAssistant(assistantId, controller.signal).then((value) => {
      setDraft(value);
      setSaved(value);
      setState("saved");
    });
    return () => controller.abort();
  }, [assistantId, service]);
  useEffect(() => {
    const listener = (event: BeforeUnloadEvent): void => {
      if (state === "unsaved") event.preventDefault();
    };
    addEventListener("beforeunload", listener);
    return () => removeEventListener("beforeunload", listener);
  }, [state]);
  const update = (next: StudioAssistant): void => {
    setDraft(Object.freeze(next));
    setState("unsaved");
  };
  const save = async (): Promise<void> => {
    if (draft === undefined) return;
    setState("saving");
    try {
      const result = await service.saveAssistant(draft);
      setDraft(result);
      setSaved(result);
      setState("saved");
      setNotice("Borrador guardado correctamente.");
      await onSaved();
    } catch (cause) {
      setState("error");
      setNotice(cause instanceof Error ? cause.message : "No se pudo guardar.");
    }
  };
  const discard = (): void => {
    setDraft(saved);
    setState("saved");
  };
  if (draft === undefined) return <Loading />;
  const validation = validateStudioAssistant(draft);
  const tab = (value: string, label: string) => (
    <Nav
      href={`/assistants/${assistantId}/${value}`}
      active={section === value}
    >
      {label}
    </Nav>
  );
  return (
    <>
      <PageHeader
        eyebrow={`ASISTENTE · ${draft.id}`}
        title={draft.identity.name || "Asistente sin nombre"}
        description={`Versión ${draft.version} · ${draft.status} · ${state}`}
        actions={
          <>
            <button
              className="studio-button"
              type="button"
              onClick={() => navigate("/assistants")}
            >
              Volver
            </button>
            {state === "unsaved" && (
              <button className="studio-button" type="button" onClick={discard}>
                Descartar
              </button>
            )}
            <button
              className="studio-button studio-primary"
              type="button"
              disabled={
                state === "saving" || !permitted(service, "assistants:write")
              }
              onClick={() => void save()}
            >
              {state === "saving" ? "Guardando…" : "Guardar borrador"}
            </button>
          </>
        }
      />
      <nav className="studio-tabs" aria-label="Secciones del asistente">
        {tab("overview", "Resumen")}
        {tab("identity", "Identidad")}
        {tab("behavior", "Comportamiento")}
        {tab("models", "Modelos")}
        {tab("knowledge", "Knowledge y RAG")}
        {tab("memory", "Memoria")}
        {tab("tools", "Tools")}
        {tab("widget", "Widget")}
        {tab("test", "Probar")}
        {tab("publish", "Publicar")}
      </nav>
      {notice !== undefined && (
        <div
          className={`studio-alert ${state === "error" ? "studio-alert-error" : "studio-alert-success"}`}
          role="status"
        >
          {notice}
        </div>
      )}
      <section className="studio-editor">
        {section === "overview" ? (
          <Overview value={draft} validation={validation} />
        ) : section === "identity" ? (
          <Identity value={draft} update={update} />
        ) : section === "behavior" ? (
          <Behavior value={draft} update={update} />
        ) : section === "models" ? (
          <Models value={draft} update={update} />
        ) : section === "knowledge" ? (
          <Knowledge
            value={draft}
            bases={knowledge}
            documents={documents}
            update={update}
          />
        ) : section === "memory" ? (
          <Memory value={draft} update={update} />
        ) : section === "tools" ? (
          <Tools value={draft} tools={tools} update={update} />
        ) : section === "widget" ? (
          <WidgetPreview value={draft} service={service} update={update} />
        ) : section === "test" ? (
          <Playground value={draft} service={service} />
        ) : (
          <Publish
            value={draft}
            service={service}
            update={update}
            onSaved={onSaved}
          />
        )}
      </section>
    </>
  );
}
function Overview({
  value,
  validation,
}: {
  readonly value: StudioAssistant;
  readonly validation: ReturnType<typeof validateStudioAssistant>;
}) {
  return (
    <div className="studio-grid">
      <article className="studio-card">
        <h2>Estado de configuración</h2>
        <div className="studio-progress">
          <span
            style={{
              width: `${Math.min(100, Math.max(10, (10 - validation.issues.filter((item) => item.severity === "error").length) * 10))}%`,
            }}
          />
        </div>
        <p>
          {validation.valid
            ? "Lista para publicar"
            : "Requiere correcciones antes de publicar"}
        </p>
        <Validation result={validation} />
      </article>
      <article className="studio-card">
        <h2>Resumen técnico</h2>
        <dl className="studio-definition">
          <dt>Proveedor</dt>
          <dd>{value.model.primaryProviderId || "Sin configurar"}</dd>
          <dt>Modelo</dt>
          <dd>{value.model.model || "Sin configurar"}</dd>
          <dt>RAG</dt>
          <dd>
            {value.rag.enabled ? value.rag.groundingMode : "Deshabilitado"}
          </dd>
          <dt>Memoria</dt>
          <dd>{value.memory.enabled ? "Desarrollo" : "Deshabilitada"}</dd>
          <dt>Tools</dt>
          <dd>
            {value.tools.enabled
              ? `${value.tools.allowlist.length} habilitadas`
              : "Deshabilitadas"}
          </dd>
        </dl>
      </article>
    </div>
  );
}
function Identity({
  value,
  update,
}: {
  readonly value: StudioAssistant;
  readonly update: (value: StudioAssistant) => void;
}) {
  const patch = (
    field: keyof StudioAssistant["identity"],
    next: string | readonly string[],
  ): void =>
    update({
      ...value,
      identity: { ...value.identity, [field]: next },
      widget: {
        ...value.widget,
        ...(field === "name" ? { assistantName: String(next) } : {}),
        ...(field === "welcomeMessage" ? { welcomeMessage: String(next) } : {}),
        ...(field === "placeholder" ? { placeholder: String(next) } : {}),
        ...(field === "suggestedQuestions"
          ? { suggestedQuestions: next as readonly string[] }
          : {}),
      },
    });
  return (
    <div className="studio-form studio-card">
      <h2>Identidad</h2>
      <Field
        label="Nombre"
        value={value.identity.name}
        onChange={(next) => patch("name", next)}
        required
      />
      <label className="studio-field">
        <span>Descripción</span>
        <textarea
          value={value.identity.description}
          onChange={(event) => patch("description", event.currentTarget.value)}
          maxLength={500}
        />
      </label>
      <Field
        label="Propósito"
        value={value.identity.purpose}
        onChange={(next) => patch("purpose", next)}
      />
      <div className="studio-form-grid">
        <Field
          label="Idioma principal"
          value={value.identity.locale}
          onChange={(next) => patch("locale", next)}
        />
        <Field
          label="Tono"
          value={value.identity.tone}
          onChange={(next) => patch("tone", next)}
        />
      </div>
      <Field
        label="Logo URL"
        value={value.identity.logoUrl}
        onChange={(next) => patch("logoUrl", next)}
        hint="Sólo HTTP o HTTPS."
      />
      <Field
        label="Avatar URL"
        value={value.identity.avatarUrl}
        onChange={(next) => patch("avatarUrl", next)}
      />
      <Field
        label="Mensaje de bienvenida"
        value={value.identity.welcomeMessage}
        onChange={(next) => patch("welcomeMessage", next)}
      />
      <Field
        label="Placeholder"
        value={value.identity.placeholder}
        onChange={(next) => patch("placeholder", next)}
      />
      <Field
        label="Preguntas sugeridas"
        value={value.identity.suggestedQuestions.join(" | ")}
        onChange={(next) =>
          patch(
            "suggestedQuestions",
            Object.freeze(
              next
                .split("|")
                .map((item) => item.trim())
                .filter(Boolean),
            ),
          )
        }
        hint="Separadas por |"
      />
      <Field
        label="Tags"
        value={value.identity.tags.join(", ")}
        onChange={(next) =>
          patch(
            "tags",
            Object.freeze(
              next
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
            ),
          )
        }
      />
    </div>
  );
}
function Behavior({
  value,
  update,
}: {
  readonly value: StudioAssistant;
  readonly update: (value: StudioAssistant) => void;
}) {
  const patch = (
    field: keyof StudioAssistant["behavior"],
    next: string | number,
  ): void =>
    update({ ...value, behavior: { ...value.behavior, [field]: next } });
  return (
    <div className="studio-form studio-card">
      <h2>Comportamiento</h2>
      <label className="studio-field">
        <span>System prompt · configuración sensible</span>
        <textarea
          rows={9}
          value={value.behavior.systemPrompt}
          maxLength={12000}
          onChange={(event) => patch("systemPrompt", event.currentTarget.value)}
        />
        <small>
          {value.behavior.systemPrompt.length}/12000. No se muestra en el
          widget.
        </small>
      </label>
      <label className="studio-field">
        <span>Restricciones</span>
        <textarea
          rows={4}
          value={value.behavior.restrictions}
          onChange={(event) => patch("restrictions", event.currentTarget.value)}
        />
      </label>
      <div className="studio-form-grid">
        <label className="studio-field">
          <span>Longitud</span>
          <select
            value={value.behavior.responseLength}
            onChange={(event) =>
              patch("responseLength", event.currentTarget.value)
            }
          >
            <option value="short">Breve</option>
            <option value="balanced">Equilibrada</option>
            <option value="detailed">Detallada</option>
          </select>
        </label>
        <Field
          label="Creatividad"
          type="number"
          min={0}
          max={1}
          value={value.behavior.creativity}
          onChange={(next) => patch("creativity", Number(next))}
        />
      </div>
    </div>
  );
}
function Models({
  value,
  update,
}: {
  readonly value: StudioAssistant;
  readonly update: (value: StudioAssistant) => void;
}) {
  const patch = (
    field: keyof StudioAssistant["model"],
    next: string | number | readonly string[],
  ): void => update({ ...value, model: { ...value.model, [field]: next } });
  return (
    <div className="studio-form studio-card">
      <h2>Modelos y proveedores</h2>
      <p className="studio-muted">
        El Studio almacena IDs seguros; las claves permanecen en Backend.
      </p>
      <div className="studio-form-grid">
        <label className="studio-field">
          <span>Proveedor primario</span>
          <select
            value={value.model.primaryProviderId}
            onChange={(event) =>
              patch("primaryProviderId", event.currentTarget.value)
            }
          >
            <option value="">Seleccionar</option>
            <option value="openai">OpenAI</option>
            <option value="gemini">Gemini</option>
            <option value="deterministic">Determinista offline</option>
          </select>
        </label>
        <Field
          label="Modelo"
          value={value.model.model}
          onChange={(next) => patch("model", next)}
          required
        />
        <Field
          label="Temperatura"
          type="number"
          min={0}
          max={2}
          value={value.model.temperature}
          onChange={(next) => patch("temperature", Number(next))}
        />
        <Field
          label="Max output tokens"
          type="number"
          min={1}
          value={value.model.maximumOutputTokens}
          onChange={(next) => patch("maximumOutputTokens", Number(next))}
        />
        <Field
          label="Top P"
          type="number"
          min={0}
          max={1}
          value={value.model.topP}
          onChange={(next) => patch("topP", Number(next))}
        />
        <Field
          label="Timeout ms"
          type="number"
          min={100}
          value={value.model.timeoutMilliseconds}
          onChange={(next) => patch("timeoutMilliseconds", Number(next))}
        />
      </div>
      <Field
        label="Fallback providers"
        value={value.model.fallbackProviderIds.join(", ")}
        onChange={(next) =>
          patch(
            "fallbackProviderIds",
            Object.freeze(
              next
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
            ),
          )
        }
      />
      <div className="studio-form-grid">
        <Field
          label="Embedding provider"
          value={value.model.embeddingProviderId}
          onChange={(next) => patch("embeddingProviderId", next)}
        />
        <Field
          label="Embedding model"
          value={value.model.embeddingModel}
          onChange={(next) => patch("embeddingModel", next)}
        />
      </div>
    </div>
  );
}
function Knowledge({
  value,
  bases,
  documents,
  update,
}: {
  readonly value: StudioAssistant;
  readonly bases: readonly StudioKnowledgeBase[];
  readonly documents: readonly StudioDocument[];
  readonly update: (value: StudioAssistant) => void;
}) {
  const patch = (
    field: keyof StudioAssistant["rag"],
    next: boolean | string | number | readonly string[],
  ): void => update({ ...value, rag: { ...value.rag, [field]: next } });
  const toggle = (id: string): void =>
    patch(
      "knowledgeBaseIds",
      value.rag.knowledgeBaseIds.includes(id)
        ? value.rag.knowledgeBaseIds.filter((item) => item !== id)
        : Object.freeze([...value.rag.knowledgeBaseIds, id]),
    );
  return (
    <div className="studio-stack">
      <article className="studio-card studio-form">
        <h2>Knowledge y RAG</h2>
        <Switch
          label="Habilitar RAG"
          checked={value.rag.enabled}
          onChange={(next) => patch("enabled", next)}
          description="Recupera contexto autorizado antes de generar."
        />
        <label className="studio-field">
          <span>Grounding mode</span>
          <select
            value={value.rag.groundingMode}
            onChange={(event) =>
              patch("groundingMode", event.currentTarget.value as GroundingMode)
            }
          >
            <option value="private-strict">
              Conocimiento privado estricto
            </option>
            <option value="private-preferred">Privado preferido</option>
            <option value="general-allowed">
              Conocimiento general permitido
            </option>
          </select>
          <small>
            Estricto rechaza respuestas sin evidencia; preferido prioriza
            fuentes; general permite conocimiento externo autorizado.
          </small>
        </label>
        <div className="studio-choice-list">
          {bases.map((base) => (
            <label key={base.id}>
              <input
                type="checkbox"
                checked={value.rag.knowledgeBaseIds.includes(base.id)}
                onChange={() => toggle(base.id)}
              />
              <span>
                <strong>{base.name}</strong>
                <small>
                  {base.documentCount} documentos · {base.status}
                </small>
              </span>
            </label>
          ))}
        </div>
        <div className="studio-form-grid">
          <Field
            label="Top K"
            type="number"
            min={1}
            value={value.rag.topK}
            onChange={(next) => patch("topK", Number(next))}
          />
          <Field
            label="Minimum score"
            type="number"
            min={0}
            max={1}
            value={value.rag.minimumScore}
            onChange={(next) => patch("minimumScore", Number(next))}
          />
          <Field
            label="Context budget"
            type="number"
            min={100}
            value={value.rag.contextTokenBudget}
            onChange={(next) => patch("contextTokenBudget", Number(next))}
          />
          <Field
            label="Máximo de chunks"
            type="number"
            min={1}
            value={value.rag.maximumChunks}
            onChange={(next) => patch("maximumChunks", Number(next))}
          />
          <Field
            label="Chunks por documento"
            type="number"
            min={1}
            value={value.rag.maximumChunksPerDocument}
            onChange={(next) => patch("maximumChunksPerDocument", Number(next))}
          />
        </div>
        <Switch
          label="Mostrar citas"
          checked={value.rag.citationsEnabled}
          onChange={(next) => patch("citationsEnabled", next)}
        />
      </article>
      <article className="studio-card">
        <h2>Documentos de desarrollo</h2>
        <div className="studio-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Documento</th>
                <th>Tipo</th>
                <th>Estado</th>
                <th>Chunks</th>
              </tr>
            </thead>
            <tbody>
              {documents
                .filter((item) =>
                  value.rag.knowledgeBaseIds.includes(item.knowledgeBaseId),
                )
                .map((item) => (
                  <tr key={item.id}>
                    <td>{item.title}</td>
                    <td>{item.mediaType}</td>
                    <td>{item.status}</td>
                    <td>{item.chunks ?? "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="studio-muted">
          La carga productiva no está disponible. Sólo se muestran fixtures
          controladas.
        </p>
      </article>
    </div>
  );
}
function Memory({
  value,
  update,
}: {
  readonly value: StudioAssistant;
  readonly update: (value: StudioAssistant) => void;
}) {
  const patch = (
    field: keyof StudioAssistant["memory"],
    next: boolean | string | number,
  ): void =>
    update({
      ...value,
      memory: { ...value.memory, [field]: next },
      widget: {
        ...value.widget,
        memoryEnabled:
          field === "enabled" ? Boolean(next) : value.widget.memoryEnabled,
      },
    });
  return (
    <article className="studio-card studio-form">
      <h2>Memoria</h2>
      <div className="studio-alert studio-alert-warning">
        Privacidad: el adaptador actual es volátil y exclusivo de desarrollo. No
        selecciones datos sensibles.
      </div>
      <Switch
        label="Habilitar memoria"
        checked={value.memory.enabled}
        onChange={(next) => patch("enabled", next)}
      />
      <div className="studio-form-grid">
        <Switch
          label="Corto plazo"
          checked={value.memory.shortTerm}
          onChange={(next) => patch("shortTerm", next)}
        />
        <Switch
          label="Largo plazo"
          checked={value.memory.longTerm}
          onChange={(next) => patch("longTerm", next)}
        />
        <Switch
          label="Resumen"
          checked={value.memory.summary}
          onChange={(next) => patch("summary", next)}
        />
        <Switch
          label="Requiere consentimiento"
          checked={value.memory.consentRequired}
          onChange={(next) => patch("consentRequired", next)}
        />
        <Field
          label="Máximo de mensajes"
          type="number"
          min={1}
          value={value.memory.maximumMessages}
          onChange={(next) => patch("maximumMessages", Number(next))}
        />
        <Field
          label="Máximo de tokens"
          type="number"
          min={1}
          value={value.memory.maximumTokens}
          onChange={(next) => patch("maximumTokens", Number(next))}
        />
        <Field
          label="Retención (días)"
          type="number"
          min={1}
          value={value.memory.retentionDays}
          onChange={(next) => patch("retentionDays", Number(next))}
        />
      </div>
    </article>
  );
}
function Tools({
  value,
  tools,
  update,
}: {
  readonly value: StudioAssistant;
  readonly tools: readonly StudioTool[];
  readonly update: (value: StudioAssistant) => void;
}) {
  const patch = (
    field: keyof StudioAssistant["tools"],
    next: boolean | string | number | readonly string[],
  ): void =>
    update({
      ...value,
      tools: { ...value.tools, [field]: next },
      widget: {
        ...value.widget,
        toolsEnabled:
          field === "enabled" ? Boolean(next) : value.widget.toolsEnabled,
      },
    });
  const toggle = (id: string): void =>
    patch(
      "allowlist",
      value.tools.allowlist.includes(id)
        ? value.tools.allowlist.filter((item) => item !== id)
        : Object.freeze([...value.tools.allowlist, id]),
    );
  return (
    <article className="studio-card studio-form">
      <h2>Tools</h2>
      <Switch
        label="Habilitar herramientas"
        checked={value.tools.enabled}
        onChange={(next) => patch("enabled", next)}
        description="Sólo se ejecutarán herramientas autorizadas por Backend."
      />
      <div className="studio-tool-list">
        {tools.map((tool) => (
          <label key={tool.id}>
            <input
              type="checkbox"
              checked={value.tools.allowlist.includes(tool.id)}
              onChange={() => toggle(tool.id)}
            />
            <span>
              <strong>{tool.name}</strong>
              <small>{tool.description}</small>
              <em>
                {tool.category} · riesgo {tool.risk} · confirmación{" "}
                {tool.confirmation}
              </em>
            </span>
          </label>
        ))}
      </div>
      <div className="studio-form-grid">
        <label className="studio-field">
          <span>Riesgo máximo</span>
          <select
            value={value.tools.maximumRisk}
            onChange={(event) =>
              patch("maximumRisk", event.currentTarget.value)
            }
          >
            {["safe", "low", "medium", "high", "critical"].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <Field
          label="Máximo de llamadas"
          type="number"
          min={1}
          value={value.tools.maximumCalls}
          onChange={(next) => patch("maximumCalls", Number(next))}
        />
        <Field
          label="Máximo de rondas"
          type="number"
          min={1}
          value={value.tools.maximumRounds}
          onChange={(next) => patch("maximumRounds", Number(next))}
        />
      </div>
    </article>
  );
}
function WidgetPreview({
  value,
  service,
  update,
}: {
  readonly value: StudioAssistant;
  readonly service: AssistantStudioService;
  readonly update: (value: StudioAssistant) => void;
}) {
  const patch = (field: string, next: string | boolean): void =>
    update({ ...value, widget: { ...value.widget, [field]: next } });
  return (
    <div className="studio-preview-grid">
      <article className="studio-card studio-form">
        <h2>Branding del Widget</h2>
        <Field
          label="Nombre"
          value={value.widget.assistantName ?? ""}
          onChange={(next) => patch("assistantName", next)}
        />
        <Field
          label="Color primario"
          type="color"
          value={value.widget.primaryColor ?? "#2563eb"}
          onChange={(next) => patch("primaryColor", next)}
        />
        <Field
          label="Color secundario"
          type="color"
          value={value.widget.secondaryColor ?? "#7c3aed"}
          onChange={(next) => patch("secondaryColor", next)}
        />
        <label className="studio-field">
          <span>Tema</span>
          <select
            value={value.widget.theme ?? "system"}
            onChange={(event) => patch("theme", event.currentTarget.value)}
          >
            <option value="light">Claro</option>
            <option value="dark">Oscuro</option>
            <option value="system">Sistema</option>
            <option value="custom">Personalizado</option>
          </select>
        </label>
        <label className="studio-field">
          <span>Posición</span>
          <select
            value={value.widget.position ?? "bottom-right"}
            onChange={(event) => patch("position", event.currentTarget.value)}
          >
            <option value="bottom-right">Abajo derecha</option>
            <option value="bottom-left">Abajo izquierda</option>
            <option value="top-right">Arriba derecha</option>
            <option value="top-left">Arriba izquierda</option>
          </select>
        </label>
        <Field
          label="Bienvenida"
          value={value.widget.welcomeMessage ?? ""}
          onChange={(next) => patch("welcomeMessage", next)}
        />
        <Field
          label="Placeholder"
          value={value.widget.placeholder ?? ""}
          onChange={(next) => patch("placeholder", next)}
        />
        <Switch
          label="Pantalla completa"
          checked={value.widget.fullscreenEnabled !== false}
          onChange={(next) => patch("fullscreenEnabled", next)}
        />
        <Switch
          label="Persistencia visual"
          checked={value.widget.persistenceEnabled !== false}
          onChange={(next) => patch("persistenceEnabled", next)}
        />
      </article>
      <div className="studio-preview">
        <span>Vista previa en tiempo real</span>
        <AssistantWidget
          config={{
            ...value.widget,
            assistantId: value.id,
            tenantId: value.tenantId,
            apiUrl: "/api",
            transport: service.getChatTransport(value.id),
            autoOpen: true,
            initialState: "welcome",
          }}
        />
      </div>
    </div>
  );
}
function Playground({
  value,
  service,
}: {
  readonly value: StudioAssistant;
  readonly service: AssistantStudioService;
}) {
  const [grounding, setGrounding] = useState<GroundingMode>(
    value.rag.groundingMode,
  );
  const [key, setKey] = useState(0);
  return (
    <div className="studio-playground">
      <article className="studio-card">
        <h2>Test Playground</h2>
        <p>
          Prueba el flujo offline con citas, request IDs, correlation IDs y
          memoria de conversación.
        </p>
        <label className="studio-field">
          <span>Grounding temporal</span>
          <select
            value={grounding}
            onChange={(event) =>
              setGrounding(event.currentTarget.value as GroundingMode)
            }
          >
            <option value="private-strict">Privado estricto</option>
            <option value="private-preferred">Privado preferido</option>
            <option value="general-allowed">General permitido</option>
          </select>
        </label>
        <button
          className="studio-button"
          type="button"
          onClick={() => setKey((item) => item + 1)}
        >
          Limpiar conversación
        </button>
        <dl className="studio-definition">
          <dt>RAG</dt>
          <dd>{value.rag.enabled ? "Activo" : "Inactivo"}</dd>
          <dt>Memoria</dt>
          <dd>{value.memory.enabled ? "Activa (desarrollo)" : "Inactiva"}</dd>
          <dt>Tools</dt>
          <dd>{value.tools.allowlist.join(", ") || "Ninguna"}</dd>
          <dt>Grounding</dt>
          <dd>{grounding}</dd>
        </dl>
      </article>
      <div className="studio-playground-widget">
        <AssistantWidget
          key={key}
          config={{
            ...value.widget,
            assistantId: value.id,
            tenantId: value.tenantId,
            apiUrl: "/api",
            transport: service.getChatTransport(value.id),
            autoOpen: true,
            initialState: "welcome",
            metadata: { groundingMode: grounding },
          }}
        />
      </div>
    </div>
  );
}
function Publish({
  value,
  service,
  update,
  onSaved,
}: {
  readonly value: StudioAssistant;
  readonly service: AssistantStudioService;
  readonly update: (value: StudioAssistant) => void;
  readonly onSaved: () => Promise<void>;
}) {
  const [importText, setImportText] = useState("");
  const [message, setMessage] = useState<string>();
  const [publishing, setPublishing] = useState(false);
  const validation = validateStudioAssistant(value);
  const publish = async (): Promise<void> => {
    if (!confirm("¿Publicar esta versión de desarrollo?")) return;
    setPublishing(true);
    try {
      const result = await service.publishAssistant(value.id);
      update(result);
      setMessage("Versión publicada. No se realizó ningún despliegue externo.");
      await onSaved();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "No se pudo publicar.",
      );
    } finally {
      setPublishing(false);
    }
  };
  const importValue = (): void => {
    try {
      const next = importStudioAssistant(
        importText,
        value.tenantId,
        service.getPrincipal().actorId,
      );
      update(Object.freeze({ ...value, identity: next.identity }));
      setMessage(
        "Configuración compatible importada como cambios sin guardar.",
      );
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Importación inválida.",
      );
    }
  };
  return (
    <div className="studio-stack">
      <article className="studio-card">
        <h2>Validación</h2>
        <Validation result={validation} />
      </article>
      <article className="studio-card">
        <h2>Publicación de desarrollo</h2>
        <p>
          Publicar valida, incrementa versión, genera descriptor y marca esta
          configuración como publicada. No despliega infraestructura.
        </p>
        <button
          className="studio-button studio-primary"
          type="button"
          disabled={
            !validation.valid ||
            publishing ||
            !permitted(service, "assistants:publish")
          }
          onClick={() => void publish()}
        >
          {publishing ? "Publicando…" : "Validar y publicar"}
        </button>
        {message !== undefined && <p role="status">{message}</p>}
      </article>
      <article className="studio-card">
        <h2>Integración segura</h2>
        <pre>{`<AssistantWidget config={{ assistantId: "${value.id}", apiUrl: "/api" }} />\n\n<enterprise-assistant assistant-id="${value.id}" api-url="/api"></enterprise-assistant>\n\ndefineAssistantWidgetElement();`}</pre>
      </article>
      <article className="studio-card studio-form">
        <h2>Importar y exportar</h2>
        <button
          className="studio-button"
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(safeExportAssistant(value));
            setMessage("JSON seguro copiado cuando el navegador lo permite.");
          }}
        >
          Copiar exportación segura
        </button>
        <label className="studio-field">
          <span>Importar JSON compatible</span>
          <textarea
            rows={7}
            value={importText}
            onChange={(event) => setImportText(event.currentTarget.value)}
          />
        </label>
        <button className="studio-button" type="button" onClick={importValue}>
          Validar e importar
        </button>
        <small>
          Los prompts protegidos, tokens, claves y rutas locales no se exportan.
        </small>
      </article>
    </div>
  );
}
function Validation({
  result,
}: {
  readonly result: ReturnType<typeof validateStudioAssistant>;
}) {
  return (
    <ul className="studio-validation">
      {result.issues.map((issue, index) => (
        <li
          className={`studio-validation-${issue.severity}`}
          key={`${issue.path}-${index}`}
        >
          <strong>{issue.severity}</strong>
          <span>{issue.message}</span>
          <small>{issue.path}</small>
        </li>
      ))}
    </ul>
  );
}
function NotFound() {
  return (
    <div className="studio-empty">
      <h1>Página no encontrada</h1>
      <p>La ruta solicitada no pertenece a Assistant Studio.</p>
      <button
        className="studio-button studio-primary"
        type="button"
        onClick={() => navigate("/dashboard")}
      >
        Ir al resumen
      </button>
    </div>
  );
}
