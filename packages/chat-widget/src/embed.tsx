import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantWidget } from "./AssistantWidget.js";
import type { AssistantWidgetConfig } from "./universal.types.js";
export interface AssistantWidgetInstance {
  destroy(): void;
  update(config: AssistantWidgetConfig): void;
}
export function createAssistantWidget(
  container: Element,
  config: AssistantWidgetConfig,
): AssistantWidgetInstance {
  const root = createRoot(container);
  let current = config;
  const render = (): void =>
    root.render(createElement(AssistantWidget, { config: current }));
  render();
  return Object.freeze({
    destroy: () => root.unmount(),
    update: (next: AssistantWidgetConfig) => {
      current = next;
      render();
    },
  });
}
const OBSERVED = Object.freeze([
  "assistant-id",
  "tenant-id",
  "api-url",
  "assistant-name",
  "theme",
  "position",
  "locale",
  "primary-color",
  "welcome-message",
]);
export function defineAssistantWidgetElement(
  tagName = "enterprise-assistant",
  registry: CustomElementRegistry = customElements,
): void {
  if (registry.get(tagName) !== undefined) return;
  class EnterpriseAssistantElement extends HTMLElement {
    public static get observedAttributes(): readonly string[] {
      return OBSERVED;
    }
    private root: Root | undefined;
    public connectedCallback(): void {
      this.renderWidget();
    }
    public disconnectedCallback(): void {
      this.root?.unmount();
      this.root = undefined;
    }
    public attributeChangedCallback(): void {
      if (this.isConnected) this.renderWidget();
    }
    private renderWidget(): void {
      const assistantId = this.getAttribute("assistant-id")?.trim();
      const apiUrl = this.getAttribute("api-url")?.trim();
      if (
        assistantId === undefined ||
        assistantId.length === 0 ||
        apiUrl === undefined ||
        apiUrl.length === 0
      ) {
        this.textContent = "assistant-id y api-url son obligatorios.";
        return;
      }
      if (this.root === undefined) {
        const shadow = this.shadowRoot ?? this.attachShadow({ mode: "open" });
        const mount = document.createElement("div");
        shadow.replaceChildren(mount);
        this.root = createRoot(mount);
      }
      const config: AssistantWidgetConfig = {
        assistantId,
        apiUrl,
        ...(this.getAttribute("tenant-id") !== null
          ? { tenantId: this.getAttribute("tenant-id") ?? undefined }
          : {}),
        ...(this.getAttribute("assistant-name") !== null
          ? { assistantName: this.getAttribute("assistant-name") ?? undefined }
          : {}),
        theme: this.readTheme(),
        position: this.readPosition(),
        locale: this.getAttribute("locale") ?? "es",
        primaryColor: this.getAttribute("primary-color") ?? undefined,
        welcomeMessage: this.getAttribute("welcome-message") ?? undefined,
      };
      this.root.render(createElement(AssistantWidget, { config }));
    }
    private readTheme(): "light" | "dark" | "system" | "custom" {
      const value = this.getAttribute("theme");
      return value === "light" || value === "dark" || value === "custom"
        ? value
        : "system";
    }
    private readPosition():
      "bottom-right" | "bottom-left" | "top-right" | "top-left" {
      const value = this.getAttribute("position");
      return value === "bottom-left" ||
        value === "top-right" ||
        value === "top-left"
        ? value
        : "bottom-right";
    }
  }
  registry.define(tagName, EnterpriseAssistantElement);
}
