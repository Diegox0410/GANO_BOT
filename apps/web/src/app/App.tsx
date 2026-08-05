import { useMemo } from "react";
import { StudioApp } from "../features/studio/StudioApp";
import { createEmptyAssistant } from "../features/studio/domain";
import { InMemoryAssistantStudioService } from "../features/studio/service";
import type {
  StudioAssistant,
  StudioPermission,
  StudioPrincipal,
} from "../features/studio/domain";
import { EnterpriseAdminApp } from "../features/admin/EnterpriseAdminApp";
import { InMemoryEnterpriseAdminService } from "../features/admin/enterpriseAdminService";
import type { EnterprisePrincipal } from "../features/admin/enterpriseAdmin.types";
import type { EnterpriseRole } from "../features/admin/enterpriseAdmin.types";
import { KnowledgeManagerApp } from "../features/knowledge-manager/KnowledgeManagerApp";
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
const ENTERPRISE_PRINCIPAL: EnterprisePrincipal = Object.freeze({
  ...PRINCIPAL,
  roles: Object.freeze<EnterpriseRole[]>(["platform-admin"]),
});
function fixture(): StudioAssistant {
  const base = createEmptyAssistant(
    PRINCIPAL.tenantId,
    PRINCIPAL.actorId,
    "support-assistant",
    "2026-08-04T12:00:00.000Z",
  );
  return Object.freeze({
    ...base,
    status: "ready",
    identity: Object.freeze({
      ...base.identity,
      name: "Asistente de soporte",
      description:
        "Asistente empresarial genérico para demostrar el flujo del Studio.",
      purpose: "Resolver preguntas usando conocimiento privado autorizado.",
      suggestedQuestions: Object.freeze([
        "¿Qué información puedes consultar?",
        "Muéstrame una respuesta con citas",
      ]),
    }),
    model: Object.freeze({
      ...base.model,
      primaryProviderId: "deterministic",
      model: "offline-test-model",
      embeddingProviderId: "deterministic",
      embeddingModel: "offline-embedding",
    }),
    rag: Object.freeze({
      ...base.rag,
      enabled: true,
      knowledgeBaseIds: Object.freeze(["kb-handbook"]),
      groundingMode: "private-strict",
    }),
    widget: Object.freeze({
      ...base.widget,
      assistantName: "Asistente de soporte",
      suggestedQuestions: Object.freeze([
        "¿Qué información puedes consultar?",
        "Muéstrame una respuesta con citas",
      ]),
    }),
  });
}
export function App() {
  const studioService = useMemo(
    () =>
      new InMemoryAssistantStudioService(PRINCIPAL, Object.freeze([fixture()])),
    [],
  );
  const adminService = useMemo(
    () => new InMemoryEnterpriseAdminService(ENTERPRISE_PRINCIPAL),
    [],
  );
  if (location.pathname.startsWith("/admin/knowledge-manager")) return <KnowledgeManagerApp />;
  return location.pathname.startsWith("/admin") || location.pathname === "/" ? (
    <EnterpriseAdminApp service={adminService} />
  ) : (
    <StudioApp service={studioService} />
  );
}
