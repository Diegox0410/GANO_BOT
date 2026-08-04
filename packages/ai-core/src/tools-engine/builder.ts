import { ToolError } from "./errors.js";
import type { ToolDefinition, ToolDescriptor, ToolHandler } from "./types.js";
export class ToolBuilder {
  private descriptor: ToolDescriptor | undefined;
  private handler: ToolHandler | undefined;
  public withDescriptor(descriptor: ToolDescriptor): this {
    this.descriptor = descriptor;
    return this;
  }
  public withHandler(handler: ToolHandler): this {
    this.handler = handler;
    return this;
  }
  public build(): ToolDefinition {
    if (this.descriptor === undefined || this.handler === undefined)
      throw new ToolError(
        "INVALID_CONFIGURATION",
        "ToolBuilder requiere descriptor y handler.",
      );
    if (
      [
        this.descriptor.id,
        this.descriptor.name,
        this.descriptor.description,
        this.descriptor.version,
      ].some((value) => value.trim().length === 0) ||
      this.descriptor.timeoutMs <= 0
    )
      throw new ToolError(
        "INVALID_CONFIGURATION",
        "Descriptor de herramienta inválido.",
      );
    return Object.freeze({
      descriptor: Object.freeze({
        ...this.descriptor,
        requiredPermissions: Object.freeze([
          ...this.descriptor.requiredPermissions,
        ]),
        tags: Object.freeze([...this.descriptor.tags]),
      }),
      handler: this.handler,
    });
  }
}
export function createToolBuilder(): ToolBuilder {
  return new ToolBuilder();
}
