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
  readonly page:
    | "dashboard"
    | "assistants"
    | "new"
    | "editor"
    | "knowledge"
    | "conversations"
    | "analytics"
    | "widget"
    | "not-found";
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
  if (path === "/knowledge") return { page: "knowledge" };
  if (path === "/conversations") return { page: "conversations" };
  if (path === "/analytics") return { page: "analytics" };
  if (path === "/widget") return { page: "widget" };

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

function statusLabel(status: StudioAssistant["status"]): string {
  if (status === "published") return "Publicado";
  if (status === "ready") return "Listo";
  if (status === "validating") return "Validando";
  if (status === "archived") return "Archivado";
  if (status === "error") return "Error";
  return "Borrador";
}

function formatDate(value: string): string {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function StudioApp({
  service,
}: {
  readonly service: AssistantStudioService;
}) {
  const [current, setCurrent] = useState(() => route(location.pathname));
  const [assistants, setAssistants] = useState<readonly StudioAssistant[]>([]);
  const [knowledge, setKnowledge] = useState<readonly StudioKnowledgeBase[]>([]);
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
        cause instanceof Error ? cause.message : "No se pudo cargar GANO_BOT Studio.",
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    const listener = (): void => {
      setCurrent(route(location.pathname));
      setNavigationOpen(false);
    };
    addEventListener("popstate", listener);
    return () => removeEventListener("popstate", listener);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [service]);

  const studioActive =
    current.page === "dashboard" ||
    current.page === "assistants" ||
    current.page === "new" ||
    current.page === "editor";

  return (
    <div className="studio studio-product-shell">
      <aside
        className={`studio-sidebar ${navigationOpen ? "studio-sidebar-open" : ""}`}
      >
        <div className="studio-brand studio-product-brand">
          <span className="studio-brand-mark">GB</span>
          <div>
            <strong>GANO_BOT <em>AI</em></strong>
            <small>Assistant Platform</small>
          </div>
        </div>

        <div className="studio-sidebar-label">Workspace</div>
        <nav aria-label="Navegación principal">
          <Nav href="/dashboard" active={current.page === "dashboard"} icon="⌂">
            Inicio
          </Nav>
          <Nav
            href="/assistants"
            active={
              current.page === "assistants" ||
              current.page === "new" ||
              current.page === "editor"
            }
            icon="✦"
          >
            Asistentes
          </Nav>
          <Nav href="/knowledge" active={current.page === "knowledge"} icon="▤">
            Conocimiento
          </Nav>
          <Nav
            href="/conversations"
            active={current.page === "conversations"}
            icon="◌"
          >
            Conversaciones
          </Nav>
          <Nav href="/analytics" active={current.page === "analytics"} icon="⌁">
            Analítica
          </Nav>
          <Nav href="/widget" active={current.page === "widget"} icon="◇">
            Widget
          </Nav>
        </nav>

        <div className="studio-sidebar-label studio-sidebar-label-secondary">
          Plataforma
        </div>
        <nav aria-label="Administración de plataforma">
          <a href="/admin" className="studio-admin-link">
            <span aria-hidden="true">⚙</span>
            Platform Admin
          </a>
        </nav>

        <div className="studio-environment">
          <div className="studio-environment-row">
            <span className={`studio-dot studio-dot-${health}`} />
            <strong>{health === "ready" ? "Operativo" : "Degradado"}</strong>
          </div>
          <small>
            {service.kind === "development-memory"
              ? "Studio en modo de desarrollo"
              : "Backend conectado"}
          </small>
        </div>
      </aside>

      <main className="studio-main">
        <header className="studio-topbar studio-product-topbar">
          <button
            className="studio-menu"
            type="button"
            aria-label="Abrir navegación"
            aria-expanded={navigationOpen}
            onClick={() => setNavigationOpen((value) => !value)}
          >
            ☰
          </button>
          <div className="studio-topbar-copy">
            <strong>{studioActive ? "GANO_BOT Studio" : "GANO_BOT AI"}</strong>
            <small>Crea, entrena y publica asistentes con tu conocimiento.</small>
          </div>
          <div className="studio-topbar-actions">
            <button
              className="studio-button studio-topbar-create"
              type="button"
              onClick={() => navigate("/assistants/new")}
            >
              + Crear asistente
            </button>
            <span className="studio-user" title={service.getPrincipal().actorId}>
              {service.getPrincipal().actorId}
            </span>
          </div>
        </header>

        <div className="studio-content studio-product-content">
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
              service={service}
            />
          ) : current.page === "assistants" ? (
            <AssistantList
              assistants={assistants}
              service={service}
              onRefresh={refresh}
            />
          ) : current.page === "new" ? (
            <CreateAssistant service={service} />
          ) : current.page === "knowledge" ? (
            <KnowledgeHub knowledge={knowledge} documents={documents} service={service} />
          ) : current.page === "conversations" ? (
            <ConversationsHub assistants={assistants} />
          ) : current.page === "analytics" ? (
            <AnalyticsHub
              assistants={assistants}
              knowledge={knowledge}
              documents={documents}
              tools={tools}
            />
          ) : current.page === "widget" ? (
            <WidgetHub assistants={assistants} />
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
  icon,
  children,
}: {
  readonly href: string;
  readonly active: boolean;
  readonly icon?: string;
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
      {icon !== undefined && <span className="studio-nav-icon" aria-hidden="true">{icon}</span>}
      <span>{children}</span>
    </a>
  );
}

function Loading() {
  return (
    <div className="studio-loading" role="status">
      <span />
      Cargando GANO_BOT Studio…
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
  service,
}: {
  readonly assistants: readonly StudioAssistant[];
  readonly knowledge: readonly StudioKnowledgeBase[];
  readonly documents: readonly StudioDocument[];
  readonly tools: readonly StudioTool[];
  readonly health: string;
  readonly service: AssistantStudioService;
}) {
  const activeAssistants = assistants.filter(
    (item) => item.status === "published" || item.status === "ready",
  ).length;
  const readyDocuments = documents.filter((item) => item.status === "ready").length;
  const totalChunks = documents.reduce((sum, item) => sum + (item.chunks ?? 0), 0);
  const recentDocuments = [...documents]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 4);
  const recentAssistants = [...assistants]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 3);

  return (
    <>
      <section className="studio-dashboard-hero">
        <div>
          <span className="studio-dashboard-kicker">TU PLATAFORMA DE ASISTENTES</span>
          <h1>Crea asistentes que conocen tu negocio.</h1>
          <p>
            Define su identidad, agrega documentos y datos, prueba sus respuestas
            y publícalos en tus canales desde un solo lugar.
          </p>
          <div className="studio-dashboard-hero-actions">
            <button
              className="studio-button studio-primary"
              type="button"
              onClick={() => navigate("/assistants/new")}
            >
              + Crear nuevo asistente
            </button>
            <button
              className="studio-button"
              type="button"
              onClick={() => navigate("/knowledge")}
            >
              Gestionar conocimiento
            </button>
          </div>
        </div>
        <div className="studio-dashboard-hero-status">
          <span className={`studio-dot studio-dot-${health}`} />
          <div>
            <strong>{health === "ready" ? "Sistema operativo" : "Revisión requerida"}</strong>
            <small>
              {service.kind === "backend"
                ? "Servicios conectados al backend"
                : "Entorno de desarrollo activo"}
            </small>
          </div>
        </div>
      </section>

      <section className="studio-metrics studio-product-metrics" aria-label="Resumen del Studio">
        <MetricCard label="Asistentes" value={assistants.length} detail={`${activeAssistants} listos o publicados`} />
        <MetricCard label="Conocimiento" value={knowledge.length} detail="bases configuradas" />
        <MetricCard label="Documentos" value={documents.length} detail={`${readyDocuments} procesados`} />
        <MetricCard label="Chunks" value={totalChunks} detail="fragmentos disponibles" />
      </section>

      <section className="studio-dashboard-section">
        <div className="studio-section-heading">
          <div>
            <span>TUS ASISTENTES</span>
            <h2>Asistentes recientes</h2>
          </div>
          <button className="studio-button studio-button-ghost" type="button" onClick={() => navigate("/assistants")}>
            Ver todos
          </button>
        </div>

        {recentAssistants.length === 0 ? (
          <article className="studio-card studio-empty-state">
            <h3>Tu primer asistente empieza aquí</h3>
            <p>Configura nombre, propósito, apariencia y conocimiento. GANO_BOT se encarga del resto.</p>
            <button className="studio-button studio-primary" type="button" onClick={() => navigate("/assistants/new")}>
              Crear asistente
            </button>
          </article>
        ) : (
          <div className="studio-assistant-showcase">
            {recentAssistants.map((assistant) => {
              const linkedDocuments = documents.filter((document) =>
                assistant.rag.knowledgeBaseIds.includes(document.knowledgeBaseId),
              ).length;
              return (
                <article className="studio-assistant-product-card" key={assistant.id}>
                  <div className="studio-assistant-product-head">
                    <div className="studio-assistant-avatar">
                      {assistant.identity.avatarUrl ? (
                        <img src={assistant.identity.avatarUrl} alt="" />
                      ) : (
                        <span>AI</span>
                      )}
                    </div>
                    <span className={`studio-status studio-status-${assistant.status}`}>
                      {statusLabel(assistant.status)}
                    </span>
                  </div>
                  <h3>{assistant.identity.name || assistant.id}</h3>
                  <p>{assistant.identity.description || "Asistente listo para configurar."}</p>
                  <div className="studio-assistant-product-meta">
                    <span>{linkedDocuments} documentos vinculados</span>
                    <span>Actualizado {formatDate(assistant.updatedAt)}</span>
                  </div>
                  <div className="studio-assistant-product-actions">
                    <button className="studio-button studio-primary" type="button" onClick={() => navigate(`/assistants/${encodeURIComponent(assistant.id)}/test`)}>
                      Probar
                    </button>
                    <button className="studio-button" type="button" onClick={() => navigate(`/assistants/${encodeURIComponent(assistant.id)}`)}>
                      Editar
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="studio-dashboard-columns">
        <article className="studio-card studio-dashboard-knowledge-card">
          <div className="studio-section-heading studio-section-heading-compact">
            <div>
              <span>CONOCIMIENTO</span>
              <h2>Documentos recientes</h2>
            </div>
            <button className="studio-button studio-button-ghost" type="button" onClick={() => navigate("/knowledge")}>
              Abrir biblioteca
            </button>
          </div>
          {recentDocuments.length === 0 ? (
            <p className="studio-muted">Todavía no hay documentos disponibles.</p>
          ) : (
            <div className="studio-document-feed">
              {recentDocuments.map((document) => (
                <div className="studio-document-feed-item" key={document.id}>
                  <span className="studio-document-icon">DOC</span>
                  <div>
                    <strong>{document.title}</strong>
                    <small>{document.mediaType} · {document.status}</small>
                  </div>
                  <span>{formatDate(document.updatedAt)}</span>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="studio-card studio-dashboard-start-card">
          <span className="studio-dashboard-kicker">FLUJO RECOMENDADO</span>
          <h2>De idea a asistente publicado</h2>
          <ol className="studio-product-steps">
            <li><strong>1</strong><span><b>Crea su identidad</b><small>Nombre, logo, propósito e idioma.</small></span></li>
            <li><strong>2</strong><span><b>Agrega conocimiento</b><small>PDF, Word, Excel, Markdown y más.</small></span></li>
            <li><strong>3</strong><span><b>Prueba respuestas</b><small>Valida tono, fuentes y comportamiento.</small></span></li>
            <li><strong>4</strong><span><b>Publica</b><small>Widget listo para tu sitio o aplicación.</small></span></li>
          </ol>
          <button className="studio-button studio-primary" type="button" onClick={() => navigate("/assistants/new")}>
            Empezar ahora
          </button>
        </article>
      </section>

      <section className="studio-dashboard-mini-grid">
        <article className="studio-mini-card" onClick={() => navigate("/knowledge")}>
          <span>▤</span><div><strong>Conocimiento</strong><small>Administra las fuentes de tus asistentes.</small></div>
        </article>
        <article className="studio-mini-card" onClick={() => navigate("/widget")}>
          <span>◇</span><div><strong>Widget</strong><small>Configura la experiencia que verá tu cliente.</small></div>
        </article>
        <article className="studio-mini-card" onClick={() => navigate("/analytics")}>
          <span>⌁</span><div><strong>Analítica</strong><small>Supervisa configuración y cobertura.</small></div>
        </article>
        <article className="studio-mini-card" onClick={() => { location.href = "/admin"; }}>
          <span>⚙</span><div><strong>Platform Admin</strong><small>Administración técnica de la plataforma.</small></div>
        </article>
      </section>

      <div className="studio-dashboard-footnote">
        <span>{tools.length} herramientas disponibles</span>
        <span>Tenant: {service.getPrincipal().tenantId}</span>
      </div>
    </>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: number;
  readonly detail: string;
}) {
  return (
    <article className="studio-metric studio-product-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function KnowledgeHub({
  knowledge,
  documents,
  service,
}: {
  readonly knowledge: readonly StudioKnowledgeBase[];
  readonly documents: readonly StudioDocument[];
  readonly service: AssistantStudioService;
}) {
  const ready = documents.filter((item) => item.status === "ready").length;
  const totalChunks = documents.reduce((sum, item) => sum + (item.chunks ?? 0), 0);

  return (
    <>
      <PageHeader
        eyebrow="CONOCIMIENTO"
        title="La información que hace útil a tu asistente"
        description="Organiza las fuentes que tus asistentes pueden consultar para responder con precisión."
        actions={
          <button
            className="studio-button studio-primary"
            type="button"
            onClick={() => { location.href = "/admin/knowledge-manager"; }}
          >
            Abrir Knowledge Manager
          </button>
        }
      />

      <section className="studio-metrics studio-product-metrics">
        <MetricCard label="Bases" value={knowledge.length} detail="colecciones disponibles" />
        <MetricCard label="Documentos" value={documents.length} detail={`${ready} listos`} />
        <MetricCard label="Chunks" value={totalChunks} detail="fragmentos indexados" />
        <MetricCard label="Asociación" value={knowledge.filter((item) => item.status === "active").length} detail="bases activas" />
      </section>

      <section className="studio-grid studio-knowledge-overview-grid">
        <article className="studio-card">
          <div className="studio-section-heading studio-section-heading-compact">
            <div><span>BIBLIOTECA</span><h2>Bases de conocimiento</h2></div>
          </div>
          {knowledge.length === 0 ? (
            <p className="studio-muted">No hay bases disponibles en este entorno.</p>
          ) : (
            <div className="studio-stack">
              {knowledge.map((base) => (
                <div className="studio-knowledge-row" key={base.id}>
                  <div><strong>{base.name}</strong><small>{base.id}</small></div>
                  <div><b>{base.documentCount}</b><small>documentos</small></div>
                  <span className={`studio-status ${base.status === "active" ? "studio-status-ready" : "studio-status-archived"}`}>
                    {base.status === "active" ? "Activa" : "Deshabilitada"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="studio-card studio-knowledge-callout">
          <span className="studio-dashboard-kicker">GESTIÓN AVANZADA</span>
          <h2>Knowledge Manager</h2>
          <p>
            El administrador técnico puede cargar, versionar, reprocesar y asociar
            documentos a los asistentes desde la herramienta especializada.
          </p>
          <button className="studio-button studio-primary" type="button" onClick={() => { location.href = "/admin/knowledge-manager"; }}>
            Gestionar documentos
          </button>
          <small>
            Fuente actual: {service.kind === "backend" ? "Backend" : "entorno de desarrollo"}
          </small>
        </article>
      </section>
    </>
  );
}

function ConversationsHub({
  assistants,
}: {
  readonly assistants: readonly StudioAssistant[];
}) {
  return (
    <>
      <PageHeader
        eyebrow="CONVERSACIONES"
        title="Entiende qué preguntan tus usuarios"
        description="Este espacio será el centro de revisión de conversaciones, calidad y preguntas sin resolver."
        actions={
          assistants[0] !== undefined ? (
            <button className="studio-button studio-primary" type="button" onClick={() => navigate(`/assistants/${encodeURIComponent(assistants[0]!.id)}/test`)}>
              Abrir playground
            </button>
          ) : undefined
        }
      />
      <section className="studio-card studio-feature-placeholder">
        <div className="studio-feature-placeholder-icon">◌</div>
        <div>
          <span className="studio-dashboard-kicker">PRÓXIMA CONEXIÓN</span>
          <h2>Historial real de conversaciones</h2>
          <p>
            Esta pantalla no muestra números inventados. En el Sprint de Conversaciones
            conectaremos el historial real, feedback, fuentes utilizadas y preguntas sin respuesta.
          </p>
        </div>
      </section>
    </>
  );
}

function AnalyticsHub({
  assistants,
  knowledge,
  documents,
  tools,
}: {
  readonly assistants: readonly StudioAssistant[];
  readonly knowledge: readonly StudioKnowledgeBase[];
  readonly documents: readonly StudioDocument[];
  readonly tools: readonly StudioTool[];
}) {
  const configuredRag = assistants.filter((item) => item.rag.enabled).length;
  const citations = assistants.filter((item) => item.rag.citationsEnabled).length;
  const toolsEnabled = assistants.filter((item) => item.tools.enabled).length;

  return (
    <>
      <PageHeader
        eyebrow="ANALÍTICA"
        title="Cobertura y preparación del workspace"
        description="Por ahora mostramos señales verificables de configuración. Las métricas de uso real se conectarán al backend de observabilidad."
      />
      <section className="studio-metrics studio-product-metrics">
        <MetricCard label="Asistentes" value={assistants.length} detail={`${configuredRag} con RAG activo`} />
        <MetricCard label="Citas" value={citations} detail="asistentes con fuentes habilitadas" />
        <MetricCard label="Documentos" value={documents.length} detail={`${knowledge.length} bases`} />
        <MetricCard label="Tools" value={tools.length} detail={`${toolsEnabled} asistentes con herramientas`} />
      </section>
      <section className="studio-card studio-feature-placeholder">
        <div className="studio-feature-placeholder-icon">⌁</div>
        <div>
          <span className="studio-dashboard-kicker">SIN DATOS SIMULADOS</span>
          <h2>Analítica productiva en el siguiente Sprint</h2>
          <p>
            Conversaciones, satisfacción, temas frecuentes, documentos consultados,
            preguntas sin respuesta, uso y costos se mostrarán aquí cuando estén conectados
            a sus fuentes reales.
          </p>
        </div>
      </section>
    </>
  );
}

function WidgetHub({
  assistants,
}: {
  readonly assistants: readonly StudioAssistant[];
}) {
  return (
    <>
      <PageHeader
        eyebrow="WIDGET"
        title="Diseña cómo se verá tu asistente"
        description="Personaliza identidad, colores y experiencia antes de publicarlo en tu sitio."
        actions={
          assistants[0] !== undefined ? (
            <button className="studio-button studio-primary" type="button" onClick={() => navigate(`/assistants/${encodeURIComponent(assistants[0]!.id)}/widget`)}>
              Configurar widget
            </button>
          ) : (
            <button className="studio-button studio-primary" type="button" onClick={() => navigate("/assistants/new")}>
              Crear asistente
            </button>
          )
        }
      />
      <section className="studio-widget-product-preview">
        <article className="studio-card studio-widget-product-copy">
          <span className="studio-dashboard-kicker">EXPERIENCIA DE MARCA</span>
          <h2>Un widget listo para cada negocio</h2>
          <p>
            Cada asistente podrá definir nombre, logo, color, mensaje inicial,
            preguntas sugeridas, posición y comportamiento sin modificar código.
          </p>
          <div className="studio-widget-feature-list">
            <span>✓ Identidad personalizada</span>
            <span>✓ Colores de marca</span>
            <span>✓ Fuentes y referencias</span>
            <span>✓ Responsive</span>
          </div>
        </article>
        <article className="studio-widget-preview-shell">
          <div className="studio-widget-preview-head"><strong>GANO_BOT AI</strong><span>×</span></div>
          <div className="studio-widget-preview-body">
            <div className="studio-widget-preview-avatar">AI</div>
            <h3>¡Hola! Soy tu asistente 👋</h3>
            <p>Estoy listo para responder utilizando el conocimiento que me asignes.</p>
            <button className="studio-button studio-primary" type="button">Iniciar conversación</button>
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
  const [openMenu, setOpenMenu] = useState<string>();

  const normalizedQuery = query.trim().toLowerCase();

  const visible = useMemo(
    () =>
      assistants
        .filter((item) => {
          const matchesStatus =
            status === "all" || item.status === status;

          const matchesQuery =
            normalizedQuery.length === 0 ||
            item.identity.name.toLowerCase().includes(normalizedQuery) ||
            item.identity.description.toLowerCase().includes(normalizedQuery) ||
            item.id.toLowerCase().includes(normalizedQuery) ||
            item.identity.tags.some((tag) =>
              tag.toLowerCase().includes(normalizedQuery),
            );

          return matchesStatus && matchesQuery;
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [assistants, normalizedQuery, status],
  );

  const totals = useMemo(
    () => ({
      all: assistants.length,
      ready: assistants.filter(
        (item) =>
          item.status === "ready" || item.status === "published",
      ).length,
      draft: assistants.filter((item) => item.status === "draft").length,
      archived: assistants.filter((item) => item.status === "archived").length,
    }),
    [assistants],
  );

  const action = async (
    id: string,
    type: "duplicate" | "archive" | "delete",
  ): Promise<void> => {
    if (
      type === "delete" &&
      !confirm(
        "¿Eliminar este asistente? Esta acción no se puede deshacer.",
      )
    ) {
      return;
    }

    setBusy(id);
    setOpenMenu(undefined);

    try {
      if (type === "duplicate") {
        await service.duplicateAssistant(id);
      } else if (type === "archive") {
        await service.archiveAssistant(id);
      } else {
        await service.deleteAssistant(id);
      }

      await onRefresh();
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="TUS ASISTENTES"
        title="Asistentes"
        description="Crea, configura, prueba y publica asistentes inteligentes para cada negocio."
        actions={
          permitted(service, "assistants:write") ? (
            <button
              className="studio-button studio-primary"
              type="button"
              onClick={() => navigate("/assistants/new")}
            >
              + Crear asistente
            </button>
          ) : undefined
        }
      />

      <section
        className="studio-assistant-summary"
        aria-label="Resumen de asistentes"
      >
        <button
          type="button"
          className={`studio-assistant-summary-card ${
            status === "all" ? "is-active" : ""
          }`}
          onClick={() => setStatus("all")}
        >
          <span>Todos</span>
          <strong>{totals.all}</strong>
          <small>asistentes creados</small>
        </button>

        <button
          type="button"
          className={`studio-assistant-summary-card ${
            status === "ready" ? "is-active" : ""
          }`}
          onClick={() => setStatus("ready")}
        >
          <span>Operativos</span>
          <strong>{totals.ready}</strong>
          <small>listos o publicados</small>
        </button>

        <button
          type="button"
          className={`studio-assistant-summary-card ${
            status === "draft" ? "is-active" : ""
          }`}
          onClick={() => setStatus("draft")}
        >
          <span>Borradores</span>
          <strong>{totals.draft}</strong>
          <small>en configuración</small>
        </button>

        <button
          type="button"
          className={`studio-assistant-summary-card ${
            status === "archived" ? "is-active" : ""
          }`}
          onClick={() => setStatus("archived")}
        >
          <span>Archivados</span>
          <strong>{totals.archived}</strong>
          <small>fuera de operación</small>
        </button>
      </section>

      <section className="studio-assistant-catalog">
        <div className="studio-assistant-catalog-toolbar">
          <div className="studio-assistant-search">
            <span aria-hidden="true">⌕</span>

            <input
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Buscar por nombre, ID, descripción o etiqueta..."
              aria-label="Buscar asistentes"
            />

            {query.length > 0 && (
              <button
                type="button"
                aria-label="Limpiar búsqueda"
                onClick={() => setQuery("")}
              >
                ×
              </button>
            )}
          </div>

          <label className="studio-assistant-filter">
            <span>Estado</span>

            <select
              value={status}
              onChange={(event) => setStatus(event.currentTarget.value)}
            >
              <option value="all">Todos</option>
              <option value="draft">Borrador</option>
              <option value="ready">Listo</option>
              <option value="published">Publicado</option>
              <option value="archived">Archivado</option>
              <option value="error">Error</option>
            </select>
          </label>
        </div>

        <div className="studio-assistant-catalog-meta">
          <span>
            {visible.length}{" "}
            {visible.length === 1 ? "asistente" : "asistentes"}
          </span>

          {(query.length > 0 || status !== "all") && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setStatus("all");
              }}
            >
              Limpiar filtros
            </button>
          )}
        </div>

        {visible.length === 0 ? (
          <article className="studio-card studio-assistant-empty">
            <div className="studio-assistant-empty-icon">AI</div>

            <span className="studio-dashboard-kicker">
              {assistants.length === 0
                ? "TU PRIMER ASISTENTE"
                : "SIN RESULTADOS"}
            </span>

            <h2>
              {assistants.length === 0
                ? "Crea un asistente inteligente en minutos"
                : "No encontramos asistentes"}
            </h2>

            <p>
              {assistants.length === 0
                ? "Define su identidad, conecta conocimiento, personaliza su experiencia y publícalo cuando esté listo."
                : "Prueba con otro nombre, ID, etiqueta o estado."}
            </p>

            {assistants.length === 0 &&
              permitted(service, "assistants:write") && (
                <button
                  className="studio-button studio-primary"
                  type="button"
                  onClick={() => navigate("/assistants/new")}
                >
                  + Crear mi primer asistente
                </button>
              )}
          </article>
        ) : (
          <div className="studio-assistant-catalog-grid">
            {visible.map((item) => {
              const isBusy = busy === item.id;

              const operational =
                item.status === "ready" ||
                item.status === "published";

              const linkedBases = item.rag.knowledgeBaseIds.length;

              return (
                <article
                  className="studio-assistant-catalog-card"
                  key={item.id}
                >
                  <div className="studio-assistant-catalog-card-top">
                    <div
                      className="studio-assistant-catalog-avatar"
                      style={{
                        background:
                          item.widget.primaryColor ??
                          "linear-gradient(135deg, #2563eb, #7c3aed)",
                      }}
                    >
                      {item.identity.avatarUrl ? (
                        <img
                          src={item.identity.avatarUrl}
                          alt=""
                        />
                      ) : (
                        <span>
                          {item.identity.name
                            ? item.identity.name
                                .split(/\s+/)
                                .slice(0, 2)
                                .map((word) => word[0])
                                .join("")
                                .toUpperCase()
                            : "AI"}
                        </span>
                      )}
                    </div>

                    <div className="studio-assistant-catalog-status">
                      <span
                        className={`studio-status studio-status-${item.status}`}
                      >
                        <i />
                        {statusLabel(item.status)}
                      </span>

                      <div className="studio-assistant-menu-wrap">
                        <button
                          className="studio-assistant-menu-button"
                          type="button"
                          aria-label={`Más acciones para ${
                            item.identity.name || item.id
                          }`}
                          aria-expanded={openMenu === item.id}
                          onClick={() =>
                            setOpenMenu((current) =>
                              current === item.id
                                ? undefined
                                : item.id,
                            )
                          }
                        >
                          •••
                        </button>

                        {openMenu === item.id && (
                          <div className="studio-assistant-menu">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void action(item.id, "duplicate")
                              }
                            >
                              Duplicar asistente
                            </button>

                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void action(item.id, "archive")
                              }
                            >
                              Archivar
                            </button>

                            <button
                              type="button"
                              className="studio-assistant-menu-danger"
                              disabled={isBusy}
                              onClick={() =>
                                void action(item.id, "delete")
                              }
                            >
                              Eliminar
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="studio-assistant-catalog-body">
                    <div className="studio-assistant-title-row">
                      <div>
                        <h2>
                          {item.identity.name || item.id}
                        </h2>

                        <span className="studio-assistant-id">
                          {item.id}
                        </span>
                      </div>
                    </div>

                    <p>
                      {item.identity.description ||
                        "Configura la descripción y el propósito de este asistente."}
                    </p>

                    <div className="studio-assistant-tags">
                      {item.identity.tags.slice(0, 3).map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>

                    <div className="studio-assistant-capabilities">
                      <div>
                        <span>Conocimiento</span>
                        <strong>
                          {linkedBases > 0
                            ? `${linkedBases} ${
                                linkedBases === 1 ? "base" : "bases"
                              }`
                            : "Sin conectar"}
                        </strong>
                      </div>

                      <div>
                        <span>RAG</span>
                        <strong>
                          {item.rag.enabled ? "Activo" : "Inactivo"}
                        </strong>
                      </div>

                      <div>
                        <span>Modelo</span>
                        <strong>
                          {item.model.primaryProviderId ||
                            "Sin configurar"}
                        </strong>
                      </div>
                    </div>
                  </div>

                  <div className="studio-assistant-catalog-footer">
                    <div>
                      <span>
                        v{item.version}
                      </span>

                      <span>
                        Actualizado {formatDate(item.updatedAt)}
                      </span>
                    </div>

                    <span
                      className={`studio-assistant-operational ${
                        operational ? "is-ready" : ""
                      }`}
                    >
                      <i />
                      {operational
                        ? "Operativo"
                        : "Configuración pendiente"}
                    </span>
                  </div>

                  <div className="studio-assistant-catalog-actions">
                    <button
                      className="studio-button studio-primary"
                      type="button"
                      onClick={() =>
                        navigate(
                          `/assistants/${encodeURIComponent(
                            item.id,
                          )}/overview`,
                        )
                      }
                    >
                      Configurar
                    </button>

                    <button
                      className="studio-button"
                      type="button"
                      onClick={() =>
                        navigate(
                          `/assistants/${encodeURIComponent(
                            item.id,
                          )}/test`,
                        )
                      }
                    >
                      Probar
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
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
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const normalizedId = id.trim().toLowerCase();

  const idValid =
    normalizedId.length >= 3 &&
    normalizedId.length <= 64 &&
    /^[a-z0-9][a-z0-9-]{2,63}$/.test(normalizedId);

  const nameValid = name.trim().length > 0;

  const create = async (): Promise<void> => {
    if (!idValid || !nameValid) {
      setError(
        "Completa el nombre y utiliza un ID válido con minúsculas, números o guiones.",
      );
      return;
    }

    setSaving(true);
    setError(undefined);

    try {
      const base = createEmptyAssistant(
        service.getPrincipal().tenantId,
        service.getPrincipal().actorId,
        normalizedId,
      );

      await service.saveAssistant(
        Object.freeze({
          ...base,
          identity: Object.freeze({
            ...base.identity,
            name: name.trim(),
            description: description.trim(),
          }),
          widget: Object.freeze({
            ...base.widget,
            assistantName: name.trim(),
          }),
        }),
      );

      navigate(
        `/assistants/${encodeURIComponent(normalizedId)}/identity`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No se pudo crear el asistente.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="NUEVO ASISTENTE"
        title="Crea tu asistente"
        description="Empieza con su identidad. Después podrás agregar conocimiento, comportamiento, herramientas y personalizar el widget."
      />

      <section className="studio-create-layout">
        <article className="studio-card studio-create-main">
          <div className="studio-create-progress">
            <div className="studio-create-progress-head">
              <span>Configuración inicial</span>
              <strong>Paso 1 de 6</strong>
            </div>

            <div className="studio-create-progress-track">
              <span />
            </div>
          </div>

          <div className="studio-create-heading">
            <div className="studio-create-heading-icon">AI</div>

            <div>
              <h2>Identidad del asistente</h2>
              <p>
                Esta información será la base de la experiencia que
                verán tus usuarios.
              </p>
            </div>
          </div>

          <div className="studio-form studio-create-form">
            <Field
              label="Nombre del asistente"
              value={name}
              onChange={(next) => {
                setName(next);
                setError(undefined);
              }}
              required
              hint="Ejemplo: Asistente de Ventas, Soporte GANO o Consultor Virtual."
            />

            <label className="studio-field">
              <span>Descripción</span>

              <textarea
                rows={4}
                value={description}
                maxLength={500}
                placeholder="Describe brevemente qué hará este asistente..."
                onChange={(event) =>
                  setDescription(event.currentTarget.value)
                }
              />

              <small>
                {description.length}/500 caracteres
              </small>
            </label>

            <Field
              label="Assistant ID"
              value={id}
              onChange={(next) => {
                setId(
                  next
                    .toLowerCase()
                    .replace(/\s+/g, "-")
                    .replace(/[^a-z0-9-]/g, ""),
                );
                setError(undefined);
              }}
              required
              hint="Identificador técnico único. Minúsculas, números y guiones; entre 3 y 64 caracteres."
            />

            {normalizedId.length > 0 && (
              <div
                className={`studio-create-id-preview ${
                  idValid ? "is-valid" : "is-invalid"
                }`}
              >
                <span>
                  {idValid ? "✓" : "!"}
                </span>

                <div>
                  <strong>
                    {idValid
                      ? "ID válido"
                      : "Revisa el identificador"}
                  </strong>

                  <small>
                    {normalizedId}
                  </small>
                </div>
              </div>
            )}

            {error !== undefined && (
              <p
                className="studio-field-error"
                role="alert"
              >
                {error}
              </p>
            )}

            <div className="studio-create-actions">
              <button
                className="studio-button"
                type="button"
                disabled={saving}
                onClick={() => navigate("/assistants")}
              >
                Cancelar
              </button>

              <button
                className="studio-button studio-primary"
                disabled={
                  saving ||
                  !idValid ||
                  !nameValid ||
                  !permitted(service, "assistants:write")
                }
                type="button"
                onClick={() => void create()}
              >
                {saving
                  ? "Creando asistente…"
                  : "Crear y continuar →"}
              </button>
            </div>
          </div>
        </article>

        <aside className="studio-create-sidebar">
          <article className="studio-create-preview">
            <span className="studio-dashboard-kicker">
              VISTA PREVIA
            </span>

            <div className="studio-create-preview-avatar">
              {name.trim()
                ? name
                    .trim()
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((word) => word[0])
                    .join("")
                    .toUpperCase()
                : "AI"}
            </div>

            <h3>
              {name.trim() || "Tu nuevo asistente"}
            </h3>

            <p>
              {description.trim() ||
                "La descripción de tu asistente aparecerá aquí."}
            </p>

            <div className="studio-create-preview-message">
              <span>AI</span>

              <p>
                ¡Hola! Estoy listo para ayudarte. Agrega conocimiento
                para que pueda responder sobre tu negocio.
              </p>
            </div>
          </article>

          <article className="studio-card studio-create-roadmap">
            <span className="studio-dashboard-kicker">
              CONFIGURACIÓN
            </span>

            <h3>Tu asistente en 6 pasos</h3>

            <ol>
              <li className="is-current">
                <strong>1</strong>
                <div>
                  <b>Identidad</b>
                  <small>Nombre y propósito</small>
                </div>
              </li>

              <li>
                <strong>2</strong>
                <div>
                  <b>Conocimiento</b>
                  <small>Documentos y datos</small>
                </div>
              </li>

              <li>
                <strong>3</strong>
                <div>
                  <b>Comportamiento</b>
                  <small>Tono e instrucciones</small>
                </div>
              </li>

              <li>
                <strong>4</strong>
                <div>
                  <b>Widget</b>
                  <small>Logo, colores y experiencia</small>
                </div>
              </li>

              <li>
                <strong>5</strong>
                <div>
                  <b>Prueba</b>
                  <small>Valida sus respuestas</small>
                </div>
              </li>

              <li>
                <strong>6</strong>
                <div>
                  <b>Publicación</b>
                  <small>Activa tu asistente</small>
                </div>
              </li>
            </ol>
          </article>
        </aside>
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
