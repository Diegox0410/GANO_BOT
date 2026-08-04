import { ToolError } from "./errors.js";
import type { ToolDefinition, ToolRegistry } from "./types.js";

function freezeTool(
  tool: ToolDefinition,
  enabled = tool.descriptor.enabled,
): ToolDefinition {
  const descriptor = Object.freeze({
    ...tool.descriptor,
    enabled,
    inputSchema: Object.freeze({ ...tool.descriptor.inputSchema }),
    ...(tool.descriptor.outputSchema !== undefined
      ? { outputSchema: Object.freeze({ ...tool.descriptor.outputSchema }) }
      : {}),
    requiredPermissions: Object.freeze([
      ...tool.descriptor.requiredPermissions,
    ]),
    tags: Object.freeze([...tool.descriptor.tags]),
    ...(tool.descriptor.metadata !== undefined
      ? { metadata: Object.freeze({ ...tool.descriptor.metadata }) }
      : {}),
  });
  return Object.freeze({ descriptor, handler: tool.handler });
}

export class DefaultToolRegistry implements ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();
  public register(tool: ToolDefinition, replace = false): void {
    const id = tool.descriptor.id.trim();
    if (id.length === 0)
      throw new ToolError("INVALID_CONFIGURATION", "Tool ID obligatorio.");
    if (this.tools.has(id) && !replace)
      throw new ToolError(
        "DUPLICATE_TOOL",
        `La herramienta "${id}" ya existe.`,
      );
    this.tools.set(id, freezeTool(tool));
  }
  public registerMany(tools: readonly ToolDefinition[], replace = false): void {
    for (const tool of tools) this.register(tool, replace);
  }
  public get(id: string): ToolDefinition | undefined {
    return this.tools.get(id.trim());
  }
  public require(id: string): ToolDefinition {
    const tool = this.get(id);
    if (tool === undefined)
      throw new ToolError(
        "TOOL_NOT_FOUND",
        `Herramienta "${id}" no registrada.`,
      );
    return tool;
  }
  public list(
    filter: Parameters<ToolRegistry["list"]>[0] = {},
  ): readonly ToolDefinition[] {
    return Object.freeze(
      [...this.tools.values()].filter(
        (tool) =>
          (filter.tenantId === undefined ||
            tool.descriptor.tenantId === undefined ||
            tool.descriptor.tenantId === filter.tenantId) &&
          (filter.assistantId === undefined ||
            tool.descriptor.assistantId === undefined ||
            tool.descriptor.assistantId === filter.assistantId) &&
          (filter.category === undefined ||
            tool.descriptor.category === filter.category) &&
          (filter.permission === undefined ||
            tool.descriptor.requiredPermissions.includes(filter.permission)),
      ),
    );
  }
  public enable(id: string): void {
    const tool = this.require(id);
    this.tools.set(id, freezeTool(tool, true));
  }
  public disable(id: string): void {
    const tool = this.require(id);
    this.tools.set(id, freezeTool(tool, false));
  }
  public unregister(id: string): boolean {
    return this.tools.delete(id.trim());
  }
}
export function createToolRegistry(): ToolRegistry {
  return new DefaultToolRegistry();
}
