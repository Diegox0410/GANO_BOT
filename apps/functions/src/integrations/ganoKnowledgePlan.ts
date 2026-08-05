export const GANO_KNOWLEDGE_BASE_IDS = Object.freeze({
  PUBLIC: "gano-public",
  AFFILIATE: "gano-affiliate",
} as const);

export const GANO_KNOWLEDGE_ACCESS_SCOPES = Object.freeze({
  PUBLIC: "public",
  AFFILIATE: "affiliate",
} as const);

export const GANO_KNOWLEDGE_DOCUMENT_STATUS = Object.freeze({
  PENDING: "pending",
  READY: "ready",
  DISABLED: "disabled",
} as const);

export type GanoKnowledgeBaseId =
  (typeof GANO_KNOWLEDGE_BASE_IDS)[keyof typeof GANO_KNOWLEDGE_BASE_IDS];

export type GanoKnowledgeAccessScope =
  (typeof GANO_KNOWLEDGE_ACCESS_SCOPES)[keyof typeof GANO_KNOWLEDGE_ACCESS_SCOPES];

export type GanoKnowledgeDocumentStatus =
  (typeof GANO_KNOWLEDGE_DOCUMENT_STATUS)[keyof typeof GANO_KNOWLEDGE_DOCUMENT_STATUS];

export interface GanoKnowledgeFolderDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly accessScope: GanoKnowledgeAccessScope;
}

export interface GanoKnowledgeDocumentDefinition {
  readonly id: string;
  readonly baseId: GanoKnowledgeBaseId;
  readonly folderId: string;
  readonly title: string;
  readonly description: string;
  readonly language: string;
  readonly accessScope: GanoKnowledgeAccessScope;
  readonly tags: readonly string[];
  readonly status: GanoKnowledgeDocumentStatus;

  /**
   * Ruta relativa prevista para el documento fuente.
   *
   * El archivo todavía puede no existir durante la fase de definición.
   */
  readonly sourcePath: string;

  /**
   * Indica si el contenido requiere revisión explícita antes de ser ingerido.
   */
  readonly requiresApproval: boolean;
}

export interface GanoKnowledgeBaseDefinition {
  readonly id: GanoKnowledgeBaseId;
  readonly tenantId: string;
  readonly name: string;
  readonly description: string;
  readonly language: string;
  readonly accessScope: GanoKnowledgeAccessScope;
  readonly assistantIds: readonly string[];
  readonly folders: readonly GanoKnowledgeFolderDefinition[];
  readonly documents: readonly GanoKnowledgeDocumentDefinition[];
}

const TENANT_ID = "gano-sim";
const ASSISTANT_ID = "gano-assistant";

const PUBLIC_FOLDERS = Object.freeze([
  Object.freeze({
    id: "historia",
    name: "Historia",
    description:
      "Contenido histórico público y antecedentes empresariales autorizados.",
    accessScope: GANO_KNOWLEDGE_ACCESS_SCOPES.PUBLIC,
  }),

  Object.freeze({
    id: "legalidad",
    name: "Legalidad",
    description:
      "Contenido educativo público sobre venta directa, multinivel y cumplimiento.",
    accessScope: GANO_KNOWLEDGE_ACCESS_SCOPES.PUBLIC,
  }),

  Object.freeze({
    id: "multinivel",
    name: "Multinivel",
    description:
      "Conceptos educativos generales sobre redes de distribución y desarrollo comercial.",
    accessScope: GANO_KNOWLEDGE_ACCESS_SCOPES.PUBLIC,
  }),

  Object.freeze({
    id: "productos",
    name: "Productos",
    description:
      "Información pública autorizada de productos, presentaciones y materiales.",
    accessScope: GANO_KNOWLEDGE_ACCESS_SCOPES.PUBLIC,
  }),

  Object.freeze({
    id: "plan-compensacion-educativo",
    name: "Plan de compensación educativo",
    description:
      "Explicaciones públicas y educativas del plan de compensación, sin promesas de ingresos.",
    accessScope: GANO_KNOWLEDGE_ACCESS_SCOPES.PUBLIC,
  }),

  Object.freeze({
    id: "academia",
    name: "Academia",
    description:
      "Materiales públicos de formación, aprendizaje y desarrollo.",
    accessScope: GANO_KNOWLEDGE_ACCESS_SCOPES.PUBLIC,
  }),

  Object.freeze({
    id: "uso-de-gano-sim",
    name: "Uso de Gano Sim",
    description:
      "Guías públicas para conocer y utilizar las funciones disponibles en Gano Sim.",
    accessScope: GANO_KNOWLEDGE_ACCESS_SCOPES.PUBLIC,
  }),
] satisfies readonly GanoKnowledgeFolderDefinition[]);

const AFFILIATE_FOLDERS = Object.freeze([
  Object.freeze({
    id: "reglas-operativas",
    name: "Reglas operativas",
    description:
      "Reglas empresariales internas disponibles únicamente para afiliados autorizados.",
    accessScope: GANO_KNOWLEDGE_ACCESS_SCOPES.AFFILIATE,
  }),

  Object.freeze({
    id: "manuales-internos",
    name: "Manuales internos",
    description:
      "Manuales y procedimientos internos de operación.",
    accessScope: GANO_KNOWLEDGE_ACCESS_SCOPES.AFFILIATE,
  }),

  Object.freeze({
    id: "procedimientos",
    name: "Procedimientos",
    description:
      "Procesos documentados para afiliados y usuarios internos autorizados.",
    accessScope: GANO_KNOWLEDGE_ACCESS_SCOPES.AFFILIATE,
  }),

  Object.freeze({
    id: "contenido-exclusivo-afiliados",
    name: "Contenido exclusivo para afiliados",
    description:
      "Materiales que requieren sesión activa y autorización empresarial.",
    accessScope: GANO_KNOWLEDGE_ACCESS_SCOPES.AFFILIATE,
  }),
] satisfies readonly GanoKnowledgeFolderDefinition[]);

const PUBLIC_DOCUMENTS = Object.freeze([
  Object.freeze({
    id: "que-es-gano-sim",
    baseId: GANO_KNOWLEDGE_BASE_IDS.PUBLIC,
    folderId: "uso-de-gano-sim",
    title: "Qué es Gano Sim",
    description:
      "Descripción pública de la plataforma, sus módulos y sus modalidades de acceso.",
    language: "es",
    accessScope: GANO_KNOWLEDGE_ACCESS_SCOPES.PUBLIC,
    tags: Object.freeze([
      "gano-sim",
      "plataforma",
      "introduccion",
      "publico",
    ]),
    status: GANO_KNOWLEDGE_DOCUMENT_STATUS.PENDING,
    sourcePath:
      "knowledge/gano-public/uso-de-gano-sim/que-es-gano-sim.md",
    requiresApproval: true,
  }),

  Object.freeze({
    id: "historia-gano-itouch",
    baseId: GANO_KNOWLEDGE_BASE_IDS.PUBLIC,
    folderId: "historia",
    title: "Historia de Gano iTouch",
    description:
      "Documento histórico público basado únicamente en fuentes autorizadas.",
    language: "es",
    accessScope: GANO_KNOWLEDGE_ACCESS_SCOPES.PUBLIC,
    tags: Object.freeze([
      "historia",
      "gano-itouch",
      "empresa",
      "publico",
    ]),
    status: GANO_KNOWLEDGE_DOCUMENT_STATUS.PENDING,
    sourcePath:
      "knowledge/gano-public/historia/historia-gano-itouch.md",
    requiresApproval: true,
  }),

  Object.freeze({
    id: "plan-compensacion-conceptos-generales",
    baseId: GANO_KNOWLEDGE_BASE_IDS.PUBLIC,
    folderId: "plan-compensacion-educativo",
    title: "Conceptos generales del plan de compensación",
    description:
      "Explicación educativa sin cálculos personales ni promesas de ingresos.",
    language: "es",
    accessScope: GANO_KNOWLEDGE_ACCESS_SCOPES.PUBLIC,
    tags: Object.freeze([
      "plan-compensacion",
      "educacion",
      "ingresos",
      "publico",
    ]),
    status: GANO_KNOWLEDGE_DOCUMENT_STATUS.PENDING,
    sourcePath:
      "knowledge/gano-public/plan-compensacion-educativo/conceptos-generales.md",
    requiresApproval: true,
  }),

  Object.freeze({
    id: "preguntas-frecuentes-publicas",
    baseId: GANO_KNOWLEDGE_BASE_IDS.PUBLIC,
    folderId: "uso-de-gano-sim",
    title: "Preguntas frecuentes públicas",
    description:
      "Respuestas verificadas sobre el acceso público, las funciones y las limitaciones de Gano Sim.",
    language: "es",
    accessScope: GANO_KNOWLEDGE_ACCESS_SCOPES.PUBLIC,
    tags: Object.freeze([
      "faq",
      "preguntas-frecuentes",
      "gano-sim",
      "publico",
    ]),
    status: GANO_KNOWLEDGE_DOCUMENT_STATUS.PENDING,
    sourcePath:
      "knowledge/gano-public/uso-de-gano-sim/preguntas-frecuentes.md",
    requiresApproval: true,
  }),
] satisfies readonly GanoKnowledgeDocumentDefinition[]);

export const GANO_PUBLIC_KNOWLEDGE_BASE =
  Object.freeze({
    id: GANO_KNOWLEDGE_BASE_IDS.PUBLIC,
    tenantId: TENANT_ID,
    name: "Gano Public",
    description:
      "Base pública de conocimiento para invitados y afiliados de Gano Sim.",
    language: "es",
    accessScope: GANO_KNOWLEDGE_ACCESS_SCOPES.PUBLIC,
    assistantIds: Object.freeze([ASSISTANT_ID]),
    folders: PUBLIC_FOLDERS,
    documents: PUBLIC_DOCUMENTS,
  } satisfies GanoKnowledgeBaseDefinition);

export const GANO_AFFILIATE_KNOWLEDGE_BASE =
  Object.freeze({
    id: GANO_KNOWLEDGE_BASE_IDS.AFFILIATE,
    tenantId: TENANT_ID,
    name: "Gano Affiliate",
    description:
      "Base privada para contenido empresarial autorizado destinado a afiliados.",
    language: "es",
    accessScope: GANO_KNOWLEDGE_ACCESS_SCOPES.AFFILIATE,
    assistantIds: Object.freeze([ASSISTANT_ID]),
    folders: AFFILIATE_FOLDERS,
    documents: Object.freeze(
      [],
    ) as readonly GanoKnowledgeDocumentDefinition[],
  } satisfies GanoKnowledgeBaseDefinition);

export const GANO_KNOWLEDGE_BASES =
  Object.freeze([
    GANO_PUBLIC_KNOWLEDGE_BASE,
    GANO_AFFILIATE_KNOWLEDGE_BASE,
  ]);

export function getGanoKnowledgeBaseDefinition(
  baseId: string,
): GanoKnowledgeBaseDefinition | undefined {
  return GANO_KNOWLEDGE_BASES.find(
    (base) => base.id === baseId,
  );
}

export function getGanoKnowledgeDocumentDefinition(
  documentId: string,
): GanoKnowledgeDocumentDefinition | undefined {
  for (const base of GANO_KNOWLEDGE_BASES) {
    const document = base.documents.find(
      (item) => item.id === documentId,
    );

    if (document !== undefined) {
      return document;
    }
  }

  return undefined;
}

export function listGanoKnowledgeDocumentsByScope(
  accessScope: GanoKnowledgeAccessScope,
): readonly GanoKnowledgeDocumentDefinition[] {
  return Object.freeze(
    GANO_KNOWLEDGE_BASES.flatMap(
      (base) => base.documents,
    ).filter(
      (document) =>
        document.accessScope ===
        accessScope,
    ),
  );
}