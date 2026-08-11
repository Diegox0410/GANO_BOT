import { useMemo } from "react";

import { EnterpriseAdminApp } from "../features/admin/EnterpriseAdminApp";
import { InMemoryEnterpriseAdminService } from "../features/admin/enterpriseAdminService";
import type {
  EnterprisePrincipal,
  EnterpriseRole,
} from "../features/admin/enterpriseAdmin.types";

import { KnowledgeManagerApp } from "../features/knowledge-manager/KnowledgeManagerApp";

import { StudioApp } from "../features/studio/StudioApp";
import { createEmptyAssistant } from "../features/studio/domain";
import type {
  StudioAssistant,
  StudioPermission,
  StudioPrincipal,
} from "../features/studio/domain";
import { InMemoryAssistantStudioService } from "../features/studio/service";

/**
 * =========================================================
 * GANO_BOT — APPLICATION ROOT
 * =========================================================
 *
 * El producto queda dividido en dos experiencias:
 *
 * 1. GANO_BOT Studio
 *    Aplicación principal orientada al cliente.
 *
 * 2. Platform Admin
 *    Consola técnica reservada para administración interna.
 *
 * El Knowledge Manager técnico permanece dentro de /admin.
 *
 * IMPORTANTE:
 *
 * Durante este primer Sprint mantenemos el servicio Studio
 * en memoria porque el adaptador BackendAssistantStudioService
 * actual todavía no implementa las mutaciones:
 *
 * - crear;
 * - editar;
 * - duplicar;
 * - publicar;
 * - eliminar asistentes.
 *
 * NO vamos a fingir que esas operaciones están persistidas.
 *
 * En el siguiente Sprint conectaremos esas operaciones al
 * Backend real.
 * =========================================================
 */

/**
 * =========================================================
 * PRINCIPAL DEL STUDIO
 * =========================================================
 */

const PRINCIPAL: StudioPrincipal = Object.freeze({
  actorId: "developer-user",

  tenantId: "development-tenant",

  permissions: Object.freeze<StudioPermission[]>([
    "assistants:read",
    "assistants:write",
    "assistants:publish",

    "knowledge:read",
    "knowledge:write",

    "tools:read",
    "tools:configure",

    "metrics:read",
  ]),
});

/**
 * =========================================================
 * PRINCIPAL DEL PLATFORM ADMIN
 * =========================================================
 */

const ENTERPRISE_PRINCIPAL: EnterprisePrincipal =
  Object.freeze({
    ...PRINCIPAL,

    roles:
      Object.freeze<EnterpriseRole[]>([
        "platform-admin",
      ]),
  });

/**
 * =========================================================
 * ASISTENTE TEMPORAL DEL STUDIO
 * =========================================================
 *
 * Este fixture desaparecerá cuando conectemos el Studio
 * completo al Backend.
 *
 * Por ahora permite mantener operativas las pantallas de
 * edición actuales mientras reconstruimos la experiencia
 * visual.
 */

function createStudioFixture(): StudioAssistant {
  const base =
    createEmptyAssistant(
      PRINCIPAL.tenantId,
      PRINCIPAL.actorId,
      "support-assistant",
      "2026-08-04T12:00:00.000Z",
    );

  return Object.freeze({
    ...base,

    status:
      "ready",

    identity:
      Object.freeze({
        ...base.identity,

        name:
          "Asistente de soporte",

        description:
          "Asistente empresarial configurable con conocimiento privado autorizado.",

        purpose:
          "Resolver preguntas utilizando el conocimiento asignado al asistente.",

        suggestedQuestions:
          Object.freeze([
            "¿Qué información puedes consultar?",
            "Muéstrame una respuesta con fuentes.",
          ]),
      }),

    model:
      Object.freeze({
        ...base.model,

        primaryProviderId:
          "deterministic",

        model:
          "offline-test-model",

        embeddingProviderId:
          "deterministic",

        embeddingModel:
          "offline-embedding",
      }),

    rag:
      Object.freeze({
        ...base.rag,

        enabled:
          true,

        knowledgeBaseIds:
          Object.freeze([
            "kb-handbook",
          ]),

        groundingMode:
          "private-strict",
      }),

    widget:
      Object.freeze({
        ...base.widget,

        assistantName:
          "Asistente de soporte",

        suggestedQuestions:
          Object.freeze([
            "¿Qué información puedes consultar?",
            "Muéstrame una respuesta con fuentes.",
          ]),
      }),
  });
}

/**
 * =========================================================
 * ROUTING
 * =========================================================
 */

function isKnowledgeManagerRoute(
  pathname: string,
): boolean {
  return pathname.startsWith(
    "/admin/knowledge-manager",
  );
}

function isPlatformAdminRoute(
  pathname: string,
): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/")
  );
}

/**
 * Compatibilidad temporal con la antigua entrada:
 *
 * /studio
 *
 * El producto final utiliza "/" como entrada principal.
 */

function normalizeLegacyStudioRoute(
  pathname: string,
): void {
  if (pathname !== "/studio") {
    return;
  }

  history.replaceState(
    {},
    "",
    "/",
  );
}

/**
 * =========================================================
 * APP
 * =========================================================
 */

export function App(): React.JSX.Element {
  /**
   * =======================================================
   * STUDIO SERVICE
   * =======================================================
   *
   * Temporal durante Sprint Studio 1.
   *
   * En Sprint Studio 2 será reemplazado por un adaptador
   * Backend completamente persistente.
   */

  const studioService =
    useMemo(
      () =>
        new InMemoryAssistantStudioService(
          PRINCIPAL,

          Object.freeze([
            createStudioFixture(),
          ]),
        ),

      [],
    );

  /**
   * =======================================================
   * PLATFORM ADMIN SERVICE
   * =======================================================
   *
   * La consola administrativa actual se conserva.
   *
   * Posteriormente sustituiremos sus métricas deterministas
   * por métricas reales provenientes del Backend.
   */

  const adminService =
    useMemo(
      () =>
        new InMemoryEnterpriseAdminService(
          ENTERPRISE_PRINCIPAL,
        ),

      [],
    );

  const pathname =
    location.pathname;

  /**
   * =======================================================
   * KNOWLEDGE MANAGER TÉCNICO
   * =======================================================
   *
   * IMPORTANTE:
   *
   * Este componente ya dispone de su propio
   * BackendKnowledgeManagerClient.
   *
   * No lo reemplazamos por datos simulados.
   */

  if (
    isKnowledgeManagerRoute(
      pathname,
    )
  ) {
    return (
      <KnowledgeManagerApp />
    );
  }

  /**
   * =======================================================
   * PLATFORM ADMIN
   * =======================================================
   *
   * A partir de ahora "/" YA NO abre Enterprise Admin.
   *
   * La consola técnica queda exclusivamente bajo:
   *
   * /admin
   */

  if (
    isPlatformAdminRoute(
      pathname,
    )
  ) {
    return (
      <EnterpriseAdminApp
        service={
          adminService
        }
      />
    );
  }

  /**
   * =======================================================
   * LEGACY STUDIO ROUTE
   * =======================================================
   */

  normalizeLegacyStudioRoute(
    pathname,
  );

  /**
   * =======================================================
   * GANO_BOT STUDIO
   * =======================================================
   *
   * Todo lo que no sea /admin pertenece ahora al producto.
   *
   * StudioApp ya administra actualmente:
   *
   * /
   * /dashboard
   * /assistants
   * /assistants/new
   * /assistants/:assistantId
   * /assistants/:assistantId/:section
   */

  return (
    <StudioApp
      service={
        studioService
      }
    />
  );
}