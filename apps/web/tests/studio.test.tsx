import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StudioApp } from "../src/features/studio/StudioApp";
import { createEmptyAssistant, importStudioAssistant, safeExportAssistant, validateStudioAssistant } from "../src/features/studio/domain";
import { BackendAssistantStudioService, InMemoryAssistantStudioService } from "../src/features/studio/service";
import { MockChatTransport } from "@gano-bot/chat-widget";
import type { StudioAssistant, StudioPermission, StudioPrincipal } from "../src/features/studio/domain";

const permissions: readonly StudioPermission[] = Object.freeze(["assistants:read","assistants:write","assistants:publish","knowledge:read","knowledge:write","tools:read","tools:configure","metrics:read"]);
const principal: StudioPrincipal = Object.freeze({ actorId: "tester", tenantId: "tenant-a", permissions });

function configured(id = "assistant-a"): StudioAssistant {
  const base = createEmptyAssistant(principal.tenantId, principal.actorId, id, "2026-08-04T12:00:00.000Z");
  return Object.freeze({ ...base, identity: Object.freeze({ ...base.identity, name: "Asistente A", description: "Descripción segura" }), model: Object.freeze({ ...base.model, primaryProviderId: "deterministic", model: "offline-model" }) });
}

describe("Assistant Studio", () => {
  beforeEach(() => { history.replaceState({}, "", "/"); });

  it("renderiza dashboard, navegación y listado offline", async () => {
    const service = new InMemoryAssistantStudioService(principal, Object.freeze([configured()]));
    render(<StudioApp service={service} />);
    expect(await screen.findByRole("heading", { name: "Crea asistentes que conocen tu negocio." })).toBeInTheDocument();
    expect(screen.getByText(/Entorno de desarrollo/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "Asistentes" }));
    expect(await screen.findByRole("heading", { name: "Asistentes" })).toBeInTheDocument();
    expect(screen.getByText("Asistente A")).toBeInTheDocument();
    expect(screen.getByText("Configuración pendiente")).toBeInTheDocument();
  });

  it("crea un asistente mediante el flujo visual y conserva borrador", async () => {
    const service = new InMemoryAssistantStudioService(principal);
    render(<StudioApp service={service} />);
    await screen.findByRole("heading", { name: "Crea asistentes que conocen tu negocio." });
    await userEvent.click(screen.getByRole("button", { name: "Crear asistente" }));
    expect(await screen.findByRole("heading", { name: "Crea tu asistente" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Nombre del asistente/), "Asistente nuevo");
    await userEvent.type(screen.getByRole("textbox", { name: /Assistant ID/ }), "assistant-new");
    await userEvent.click(screen.getByRole("button", { name: /Crear y continuar/ }));
    expect(await screen.findByRole("heading", { name: "Asistente nuevo" })).toBeInTheDocument();
    expect((await service.getAssistant("assistant-new"))?.status).toBe("draft");
    expect((await service.getAssistant("assistant-new"))?.tenantId).toBe("tenant-a");
  });

  it("valida, versiona, duplica, archiva y publica con aislamiento", async () => {
    const service = new InMemoryAssistantStudioService(principal, Object.freeze([configured()]));
    const invalid = validateStudioAssistant(createEmptyAssistant("tenant-a", "tester", "BAD ID"));
    expect(invalid.valid).toBe(false);
    expect(invalid.issues.some((item) => item.path === "id")).toBe(true);
    const saved = await service.saveAssistant(configured());
    expect(saved.version).toBe(2);
    const copy = await service.duplicateAssistant(saved.id);
    expect(copy.id).toBe("assistant-a-copy");
    expect(copy.status).toBe("draft");
    const archived = await service.archiveAssistant(copy.id);
    expect(archived.status).toBe("archived");
    const published = await service.publishAssistant(saved.id);
    expect(published.status).toBe("published");
    const other = createEmptyAssistant("tenant-b", "tester", "other-assistant");
    await expect(service.saveAssistant(other)).rejects.toThrow("otro tenant");
  });

  it("exporta sin secretos e importa únicamente esquemas compatibles", () => {
    const value = Object.freeze({ ...configured(), behavior: Object.freeze({ ...configured().behavior, systemPrompt: "PROMPT SENSIBLE" }) });
    const exported = safeExportAssistant(value);
    expect(exported).not.toContain("PROMPT SENSIBLE");
    expect(exported).toContain("[PROTECTED]");
    const imported = importStudioAssistant(exported, "tenant-a", "tester");
    expect(imported.id).toBe(value.id);
    expect(imported.identity.name).toBe(value.identity.name);
    expect(() => importStudioAssistant("{}", "tenant-a", "tester")).toThrow("compatible");
    expect(() => importStudioAssistant("<script>", "tenant-a", "tester")).toThrow("JSON válido");
  });

  it("edita identidad, detecta cambios y muestra preview del Widget", async () => {
    const service = new InMemoryAssistantStudioService(principal, Object.freeze([configured()]));
    history.replaceState({}, "", "/assistants/assistant-a/identity");
    render(<StudioApp service={service} />);
    expect(await screen.findByRole("heading", { name: "Asistente A" })).toBeInTheDocument();
    const name = screen.getByLabelText(/^Nombre\s*\*/);
    await userEvent.clear(name);
    await userEvent.type(name, "Asistente editado");
    expect(screen.getByText(/unsaved/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() => expect(screen.getByText(/saved/)).toBeInTheDocument());
    expect((await service.getAssistant("assistant-a"))?.identity.name).toBe("Asistente editado");
    const editorNavigation = screen.getByRole("navigation", { name: /Secciones del asistente/i });
    await userEvent.click(within(editorNavigation).getByRole("link", { name: "Widget" }));
    expect(await screen.findByRole("heading", { name: "Branding del Widget" })).toBeInTheDocument();
    expect(screen.getByText("Vista previa en tiempo real")).toBeInTheDocument();
  });

  it("mapea draft, publish y archive contra la API Studio tenant-scoped", async () => {
    const value = configured();
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body)) as Readonly<Record<string, unknown>>;
      expect(body?.tenantId ?? "tenant-a").toBe("tenant-a");
      const data = path.endsWith("/publish")
        ? { configuration: { ...value, status: "published" } }
        : path.endsWith("/archive")
          ? { ...value, status: "archived" }
          : value;
      return new Response(JSON.stringify({ success: true, data }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const service = new BackendAssistantStudioService({
      apiUrl: "https://api.example.test",
      principal,
      tokenProvider: async () => "signed-token",
      fetchImplementation: fetcher,
      chatTransportFactory: () => new MockChatTransport(async () => ({
        conversationId: "unused",
        message: { id: "unused", role: "assistant", content: "", timestamp: "2026-09-28T00:00:00.000Z", status: "completed" },
        citations: [],
      })),
    });
    expect((await service.saveAssistant(value)).id).toBe(value.id);
    expect((await service.publishAssistant(value.id)).status).toBe("published");
    expect((await service.archiveAssistant(value.id)).status).toBe("archived");
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      "https://api.example.test/v1/studio/assistants/assistant-a",
      "https://api.example.test/v1/studio/assistants/assistant-a/publish",
      "https://api.example.test/v1/studio/assistants/assistant-a/archive",
    ]);
  });
});
