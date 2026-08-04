import type {
  AssistantWidgetConfig,
  UniversalChatTransport,
} from "@gano-bot/chat-widget";
export type StudioAssistantStatus =
  "draft" | "validating" | "ready" | "published" | "archived" | "error";
export type StudioSeverity = "error" | "warning" | "info" | "success";
export type GroundingMode =
  "private-strict" | "private-preferred" | "general-allowed";
export type StudioPermission =
  | "assistants:read"
  | "assistants:write"
  | "assistants:publish"
  | "knowledge:read"
  | "knowledge:write"
  | "tools:read"
  | "tools:configure"
  | "metrics:read";
export interface StudioPrincipal {
  readonly actorId: string;
  readonly tenantId: string;
  readonly permissions: readonly StudioPermission[];
}
export interface StudioValidationIssue {
  readonly severity: StudioSeverity;
  readonly path: string;
  readonly message: string;
}
export interface StudioValidationResult {
  readonly valid: boolean;
  readonly issues: readonly StudioValidationIssue[];
  readonly checkedAt: string;
}
export interface StudioIdentityConfig {
  readonly name: string;
  readonly description: string;
  readonly purpose: string;
  readonly locale: string;
  readonly allowedLocales: readonly string[];
  readonly logoUrl: string;
  readonly avatarUrl: string;
  readonly welcomeMessage: string;
  readonly placeholder: string;
  readonly suggestedQuestions: readonly string[];
  readonly tone: string;
  readonly instructions: string;
  readonly tags: readonly string[];
}
export interface StudioModelConfig {
  readonly primaryProviderId: string;
  readonly model: string;
  readonly temperature: number;
  readonly maximumOutputTokens: number;
  readonly topP: number;
  readonly timeoutMilliseconds: number;
  readonly fallbackProviderIds: readonly string[];
  readonly embeddingProviderId: string;
  readonly embeddingModel: string;
}
export interface StudioRagConfig {
  readonly enabled: boolean;
  readonly groundingMode: GroundingMode;
  readonly knowledgeBaseIds: readonly string[];
  readonly topK: number;
  readonly minimumScore: number;
  readonly contextTokenBudget: number;
  readonly maximumChunks: number;
  readonly maximumChunksPerDocument: number;
  readonly citationsEnabled: boolean;
  readonly insufficientKnowledgeMessage: string;
  readonly rankingStrategy: string;
  readonly rerankingStrategy: string;
}
export interface StudioMemoryConfig {
  readonly enabled: boolean;
  readonly shortTerm: boolean;
  readonly longTerm: boolean;
  readonly summary: boolean;
  readonly maximumMessages: number;
  readonly maximumTokens: number;
  readonly retentionDays: number;
  readonly consentRequired: boolean;
  readonly allowedCategories: readonly string[];
  readonly forbiddenCategories: readonly string[];
  readonly injectionOrder: "before-knowledge" | "after-knowledge";
  readonly storeKind: "development-memory";
}
export interface StudioToolsConfig {
  readonly enabled: boolean;
  readonly allowlist: readonly string[];
  readonly categories: readonly string[];
  readonly maximumRisk: "safe" | "low" | "medium" | "high" | "critical";
  readonly maximumCalls: number;
  readonly maximumRounds: number;
}
export interface StudioBehaviorConfig {
  readonly systemPrompt: string;
  readonly restrictions: string;
  readonly responseLength: "short" | "balanced" | "detailed";
  readonly creativity: number;
  readonly insufficientPolicy: "explicit" | "ask-clarification";
}
export interface StudioAssistant {
  readonly id: string;
  readonly tenantId: string;
  readonly version: number;
  readonly status: StudioAssistantStatus;
  readonly identity: StudioIdentityConfig;
  readonly behavior: StudioBehaviorConfig;
  readonly model: StudioModelConfig;
  readonly rag: StudioRagConfig;
  readonly memory: StudioMemoryConfig;
  readonly tools: StudioToolsConfig;
  readonly widget: Omit<
    AssistantWidgetConfig,
    "assistantId" | "apiUrl" | "transport" | "storage" | "tokenProvider"
  >;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly validation: StudioValidationResult;
}
export interface StudioKnowledgeBase {
  readonly id: string;
  readonly name: string;
  readonly status: "active" | "disabled";
  readonly documentCount: number;
}
export interface StudioDocument {
  readonly id: string;
  readonly knowledgeBaseId: string;
  readonly title: string;
  readonly mediaType: string;
  readonly status: string;
  readonly size?: number;
  readonly chunks?: number;
  readonly updatedAt: string;
}
export interface StudioTool {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly risk: string;
  readonly permissions: readonly string[];
  readonly confirmation: string;
}
export interface StudioDashboard {
  readonly totalAssistants: number;
  readonly activeAssistants: number;
  readonly draftAssistants: number;
  readonly knowledgeBases: number;
  readonly documents: number;
  readonly enabledTools: number;
  readonly serviceStatus: "ready" | "degraded";
}
export interface AssistantStudioService {
  readonly kind: "backend" | "development-memory";
  getPrincipal(): StudioPrincipal;
  listAssistants(signal?: AbortSignal): Promise<readonly StudioAssistant[]>;
  getAssistant(
    id: string,
    signal?: AbortSignal,
  ): Promise<StudioAssistant | undefined>;
  saveAssistant(
    value: StudioAssistant,
    signal?: AbortSignal,
  ): Promise<StudioAssistant>;
  deleteAssistant(id: string, signal?: AbortSignal): Promise<void>;
  duplicateAssistant(
    id: string,
    signal?: AbortSignal,
  ): Promise<StudioAssistant>;
  archiveAssistant(id: string, signal?: AbortSignal): Promise<StudioAssistant>;
  publishAssistant(id: string, signal?: AbortSignal): Promise<StudioAssistant>;
  listKnowledgeBases(
    signal?: AbortSignal,
  ): Promise<readonly StudioKnowledgeBase[]>;
  listDocuments(signal?: AbortSignal): Promise<readonly StudioDocument[]>;
  listTools(signal?: AbortSignal): Promise<readonly StudioTool[]>;
  health(signal?: AbortSignal): Promise<"ready" | "degraded">;
  getChatTransport(assistantId: string): UniversalChatTransport;
}
export function createEmptyAssistant(
  tenantId: string,
  actorId: string,
  id: string,
  now = new Date().toISOString(),
): StudioAssistant {
  return Object.freeze({
    id,
    tenantId,
    version: 1,
    status: "draft",
    identity: Object.freeze({
      name: "",
      description: "",
      purpose: "",
      locale: "es",
      allowedLocales: Object.freeze(["es"]),
      logoUrl: "",
      avatarUrl: "",
      welcomeMessage: "Hola, ¿en qué puedo ayudarte?",
      placeholder: "Escribe tu mensaje…",
      suggestedQuestions: Object.freeze([]),
      tone: "profesional",
      instructions: "",
      tags: Object.freeze([]),
    }),
    behavior: Object.freeze({
      systemPrompt: "",
      restrictions: "",
      responseLength: "balanced",
      creativity: 0.3,
      insufficientPolicy: "explicit",
    }),
    model: Object.freeze({
      primaryProviderId: "",
      model: "",
      temperature: 0.3,
      maximumOutputTokens: 1024,
      topP: 1,
      timeoutMilliseconds: 30000,
      fallbackProviderIds: Object.freeze([]),
      embeddingProviderId: "",
      embeddingModel: "",
    }),
    rag: Object.freeze({
      enabled: false,
      groundingMode: "private-preferred",
      knowledgeBaseIds: Object.freeze([]),
      topK: 5,
      minimumScore: 0.25,
      contextTokenBudget: 4000,
      maximumChunks: 8,
      maximumChunksPerDocument: 3,
      citationsEnabled: true,
      insufficientKnowledgeMessage:
        "No encuentro información suficiente en las fuentes disponibles.",
      rankingStrategy: "score",
      rerankingStrategy: "none",
    }),
    memory: Object.freeze({
      enabled: false,
      shortTerm: true,
      longTerm: false,
      summary: true,
      maximumMessages: 20,
      maximumTokens: 2000,
      retentionDays: 30,
      consentRequired: true,
      allowedCategories: Object.freeze([]),
      forbiddenCategories: Object.freeze(["secrets"]),
      injectionOrder: "before-knowledge",
      storeKind: "development-memory",
    }),
    tools: Object.freeze({
      enabled: false,
      allowlist: Object.freeze([]),
      categories: Object.freeze([]),
      maximumRisk: "low",
      maximumCalls: 4,
      maximumRounds: 2,
    }),
    widget: Object.freeze({
      assistantName: "Asistente",
      theme: "system",
      position: "bottom-right",
      primaryColor: "#2563eb",
      secondaryColor: "#7c3aed",
      welcomeMessage: "Hola, ¿en qué puedo ayudarte?",
      placeholder: "Escribe tu mensaje…",
      suggestedQuestions: Object.freeze([]),
      citationsEnabled: true,
      toolsEnabled: false,
      memoryEnabled: false,
      persistenceEnabled: true,
      fullscreenEnabled: true,
      streamingEnabled: false,
      autoOpen: true,
    }),
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
    updatedBy: actorId,
    validation: Object.freeze({
      valid: false,
      issues: Object.freeze([]),
      checkedAt: now,
    }),
  });
}
function safeUrl(value: string): boolean {
  if (value.length === 0) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
export function validateStudioAssistant(
  value: StudioAssistant,
  now = new Date().toISOString(),
): StudioValidationResult {
  const issues: StudioValidationIssue[] = [];
  const add = (
    severity: StudioSeverity,
    path: string,
    message: string,
  ): void => {
    issues.push(Object.freeze({ severity, path, message }));
  };
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(value.id))
    add("error", "id", "El ID debe usar minúsculas, números y guiones.");
  if (value.identity.name.trim().length === 0)
    add("error", "identity.name", "El nombre es obligatorio.");
  if (value.identity.name.length > 100)
    add("error", "identity.name", "El nombre supera 100 caracteres.");
  if (value.model.primaryProviderId.length === 0)
    add("error", "model.primaryProviderId", "Selecciona un proveedor.");
  if (value.model.model.length === 0)
    add("error", "model.model", "Selecciona un modelo.");
  if (
    value.rag.enabled &&
    value.rag.groundingMode === "private-strict" &&
    value.rag.knowledgeBaseIds.length === 0
  )
    add(
      "error",
      "rag.knowledgeBaseIds",
      "El modo privado estricto necesita conocimiento.",
    );
  if (value.memory.enabled && value.memory.maximumMessages < 1)
    add(
      "error",
      "memory.maximumMessages",
      "La memoria necesita un límite válido.",
    );
  if (value.tools.enabled && value.tools.allowlist.length === 0)
    add("error", "tools.allowlist", "Selecciona al menos una herramienta.");
  if (!safeUrl(value.identity.logoUrl) || !safeUrl(value.identity.avatarUrl))
    add(
      "error",
      "identity.logoUrl",
      "Logo o avatar contiene una URL insegura.",
    );
  if (!/^#[0-9a-fA-F]{6}$/.test(value.widget.primaryColor ?? ""))
    add(
      "error",
      "widget.primaryColor",
      "El color primario debe ser hexadecimal.",
    );
  if (value.behavior.systemPrompt.length > 12000)
    add(
      "error",
      "behavior.systemPrompt",
      "El prompt supera el límite permitido.",
    );
  if (value.rag.minimumScore < 0 || value.rag.minimumScore > 1)
    add("error", "rag.minimumScore", "El score debe estar entre 0 y 1.");
  if (value.memory.enabled && value.memory.storeKind === "development-memory")
    add(
      "warning",
      "memory.storeKind",
      "La memoria utiliza almacenamiento de desarrollo.",
    );
  if (value.status === "published")
    add("info", "status", "Esta versión está publicada.");
  if (issues.every((issue) => issue.severity !== "error"))
    add("success", "configuration", "La configuración es válida.");
  return Object.freeze({
    valid: issues.every((issue) => issue.severity !== "error"),
    issues: Object.freeze(issues),
    checkedAt: now,
  });
}
export function safeExportAssistant(value: StudioAssistant): string {
  const safe = Object.freeze({
    ...value,
    behavior: Object.freeze({ ...value.behavior, systemPrompt: "[PROTECTED]" }),
    validation: value.validation,
  });
  return JSON.stringify(
    Object.freeze({ schemaVersion: 1, assistant: safe }),
    null,
    2,
  );
}
export function importStudioAssistant(
  text: string,
  tenantId: string,
  actorId: string,
): StudioAssistant {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error("El archivo no contiene JSON válido.", { cause: error });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error("La configuración importada no es válida.");
  const root = parsed as Readonly<Record<string, unknown>>;
  if (
    root.schemaVersion !== 1 ||
    typeof root.assistant !== "object" ||
    root.assistant === null ||
    Array.isArray(root.assistant)
  )
    throw new Error("La versión o esquema no es compatible.");
  const raw = root.assistant as Readonly<Record<string, unknown>>;
  if (
    typeof raw.id !== "string" ||
    typeof raw.identity !== "object" ||
    raw.identity === null
  )
    throw new Error("La configuración no contiene un asistente válido.");
  const base = createEmptyAssistant(tenantId, actorId, raw.id);
  const identity = raw.identity as Readonly<Record<string, unknown>>;
  return Object.freeze({
    ...base,
    identity: Object.freeze({
      ...base.identity,
      name: typeof identity.name === "string" ? identity.name : "",
      description:
        typeof identity.description === "string" ? identity.description : "",
    }),
  });
}
