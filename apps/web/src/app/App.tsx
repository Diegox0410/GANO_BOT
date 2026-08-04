import { useMemo } from "react";
import { StudioApp } from "../features/studio/StudioApp";
import { createEmptyAssistant } from "../features/studio/domain";
import { InMemoryAssistantStudioService } from "../features/studio/service";
import type {
  StudioAssistant,
  StudioPermission,
  StudioPrincipal,
} from "../features/studio/domain";
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
  const service = useMemo(
    () =>
      new InMemoryAssistantStudioService(PRINCIPAL, Object.freeze([fixture()])),
    [],
  );
  return <StudioApp service={service} />;
}
