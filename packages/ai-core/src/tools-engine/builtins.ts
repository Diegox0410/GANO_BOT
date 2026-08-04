import type { AIUnknownRecord } from "../types.js";
import type { ToolDefinition, ToolDescriptor, ToolHandler } from "./types.js";
function builtin(
  id: string,
  name: string,
  description: string,
  inputSchema: ToolDescriptor["inputSchema"],
  handler: ToolHandler,
): ToolDefinition {
  return Object.freeze({
    descriptor: Object.freeze({
      id,
      name,
      description,
      version: "1.0.0",
      category:
        id === "calculator"
          ? "calculation"
          : id === "current-time" || id === "uuid"
            ? "system"
            : id === "json-inspect"
              ? "data"
              : "text",
      riskLevel: "safe",
      inputSchema,
      requiredPermissions: Object.freeze([]),
      confirmationPolicy: "never",
      timeoutMs: 2_000,
      enabled: true,
      tags: Object.freeze(["offline", "development"]),
    }),
    handler,
  });
}
function values(args: AIUnknownRecord): readonly number[] {
  const value = args.values;
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === "number")
    : [];
}
export function createCalculatorTool(): ToolDefinition {
  return builtin(
    "calculator",
    "calculator",
    "Deterministic arithmetic calculator.",
    {
      type: "object",
      required: ["operation", "values"],
      additionalProperties: false,
      properties: {
        operation: {
          type: "string",
          enum: [
            "sum",
            "subtract",
            "multiply",
            "divide",
            "percentage",
            "minimum",
            "maximum",
            "average",
          ],
        },
        values: { type: "array", items: { type: "number" } },
      },
    },
    {
      async execute(args) {
        const operation = args.operation;
        const input = values(args);
        if (input.length === 0)
          throw new Error("At least one value is required.");
        let result: number;
        switch (operation) {
          case "sum":
            result = input.reduce((total, value) => total + value, 0);
            break;
          case "subtract":
            result = input
              .slice(1)
              .reduce((total, value) => total - value, input[0] ?? 0);
            break;
          case "multiply":
            result = input.reduce((total, value) => total * value, 1);
            break;
          case "divide":
            result = input.slice(1).reduce((total, value) => {
              if (value === 0) throw new Error("Division by zero.");
              return total / value;
            }, input[0] ?? 0);
            break;
          case "percentage":
            result = ((input[0] ?? 0) * (input[1] ?? 0)) / 100;
            break;
          case "minimum":
            result = Math.min(...input);
            break;
          case "maximum":
            result = Math.max(...input);
            break;
          case "average":
            result =
              input.reduce((total, value) => total + value, 0) / input.length;
            break;
          default:
            throw new Error("Unsupported operation.");
        }
        return Object.freeze({ result });
      },
    },
  );
}
export function createCurrentTimeTool(
  clock: () => Date = () => new Date(),
): ToolDefinition {
  return builtin(
    "current-time",
    "current-time",
    "Returns deterministic clock time.",
    {
      type: "object",
      properties: { timezone: { type: "string", maxLength: 100 } },
      additionalProperties: false,
    },
    {
      async execute(args) {
        const timezone =
          typeof args.timezone === "string" ? args.timezone : "UTC";
        return Object.freeze({
          iso: clock().toISOString(),
          timezone,
          formatted: new Intl.DateTimeFormat("en-CA", {
            timeZone: timezone,
            dateStyle: "full",
            timeStyle: "long",
          }).format(clock()),
        });
      },
    },
  );
}
export function createUuidTool(
  generate: () => string = () => crypto.randomUUID(),
): ToolDefinition {
  return builtin(
    "uuid",
    "uuid",
    "Generates an identifier.",
    { type: "object", additionalProperties: false },
    {
      async execute() {
        return Object.freeze({ uuid: generate() });
      },
    },
  );
}
export function createEchoTool(): ToolDefinition {
  return builtin(
    "echo",
    "echo",
    "Returns normalized text.",
    {
      type: "object",
      required: ["text"],
      properties: { text: { type: "string", maxLength: 10_000 } },
      additionalProperties: false,
    },
    {
      async execute(args) {
        return Object.freeze({
          text: String(args.text).replace(/\s+/g, " ").trim(),
        });
      },
    },
  );
}
export function createTextTransformTool(): ToolDefinition {
  return builtin(
    "text-transform",
    "text-transform",
    "Transforms text deterministically.",
    {
      type: "object",
      required: ["operation", "text"],
      properties: {
        operation: {
          type: "string",
          enum: [
            "uppercase",
            "lowercase",
            "trim",
            "word-count",
            "character-count",
          ],
        },
        text: { type: "string", maxLength: 100_000 },
      },
      additionalProperties: false,
    },
    {
      async execute(args) {
        const text = String(args.text);
        switch (args.operation) {
          case "uppercase":
            return { text: text.toUpperCase() };
          case "lowercase":
            return { text: text.toLowerCase() };
          case "trim":
            return { text: text.trim() };
          case "word-count":
            return {
              count:
                text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length,
            };
          case "character-count":
            return { count: text.length };
          default:
            throw new Error("Unsupported transform.");
        }
      },
    },
  );
}
function inspect(value: unknown, depth = 0): unknown {
  if (depth > 10) return "[maximum-depth]";
  if (Array.isArray(value))
    return Object.freeze({
      type: "array",
      length: value.length,
      items: value.slice(0, 20).map((item) => inspect(item, depth + 1)),
    });
  if (typeof value === "object" && value !== null)
    return Object.freeze({
      type: "object",
      keys: Object.keys(value).slice(0, 100),
      properties: Object.fromEntries(
        Object.entries(value)
          .slice(0, 100)
          .map(([key, item]) => [key, inspect(item, depth + 1)]),
      ),
    });
  return Object.freeze({ type: value === null ? "null" : typeof value });
}
export function createJsonInspectTool(): ToolDefinition {
  return builtin(
    "json-inspect",
    "json-inspect",
    "Safely summarizes JSON.",
    {
      type: "object",
      required: ["json"],
      properties: { json: { type: "string", maxLength: 100_000 } },
      additionalProperties: false,
    },
    {
      async execute(args) {
        return inspect(JSON.parse(String(args.json)));
      },
    },
  );
}
export function createMarkdownSummaryTool(): ToolDefinition {
  return builtin(
    "markdown-summary",
    "markdown-summary",
    "Summarizes Markdown structure without an LLM.",
    {
      type: "object",
      required: ["markdown"],
      properties: { markdown: { type: "string", maxLength: 100_000 } },
      additionalProperties: false,
    },
    {
      async execute(args) {
        const markdown = String(args.markdown);
        const headings = [...markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)].map(
          (match) =>
            Object.freeze({
              level: match[1]?.length ?? 1,
              title: match[2]?.trim() ?? "",
            }),
        );
        const listItems = (markdown.match(/^\s*(?:[-*+] |\d+\. )/gm) ?? [])
          .length;
        return Object.freeze({
          headings: Object.freeze(headings),
          sectionCount: headings.length,
          listItemCount: listItems,
          characterCount: markdown.length,
        });
      },
    },
  );
}
export function createOfflineBuiltinTools(
  config: {
    readonly clock?: () => Date;
    readonly generateUuid?: () => string;
  } = {},
): readonly ToolDefinition[] {
  return Object.freeze([
    createCalculatorTool(),
    createCurrentTimeTool(config.clock),
    createUuidTool(config.generateUuid),
    createEchoTool(),
    createTextTransformTool(),
    createJsonInspectTool(),
    createMarkdownSummaryTool(),
  ]);
}
