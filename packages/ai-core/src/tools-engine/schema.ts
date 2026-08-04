import type { AIUnknownRecord } from "../types.js";
import type { ToolArgumentSchema } from "./types.js";
import type { ToolValidationIssue } from "./errors.js";
function kind(value: unknown): string {
  return Array.isArray(value)
    ? "array"
    : value === null
      ? "null"
      : typeof value;
}
export function validateToolArguments(
  value: unknown,
  schema: ToolArgumentSchema,
  path = "$",
): readonly ToolValidationIssue[] {
  const issues: ToolValidationIssue[] = [];
  const actual = kind(value);
  const valid =
    schema.type === "integer"
      ? typeof value === "number" && Number.isInteger(value)
      : schema.type === "array"
        ? Array.isArray(value)
        : schema.type === "object"
          ? typeof value === "object" && value !== null && !Array.isArray(value)
          : actual === schema.type;
  if (!valid)
    return Object.freeze([
      {
        path,
        code: "type",
        message: "Tipo de argumento inválido.",
        expected: schema.type,
        received: actual,
      },
    ]);
  if (schema.enum !== undefined && !schema.enum.some((item) => item === value))
    issues.push({
      path,
      code: "enum",
      message: "Valor fuera del enum permitido.",
    });
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum)
      issues.push({
        path,
        code: "minimum",
        message: "Valor inferior al mínimo.",
        expected: String(schema.minimum),
      });
    if (schema.maximum !== undefined && value > schema.maximum)
      issues.push({
        path,
        code: "maximum",
        message: "Valor superior al máximo.",
        expected: String(schema.maximum),
      });
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      issues.push({
        path,
        code: "minLength",
        message: "Texto demasiado corto.",
      });
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      issues.push({
        path,
        code: "maxLength",
        message: "Texto demasiado largo.",
      });
    if (
      schema.pattern !== undefined &&
      !new RegExp(schema.pattern, "u").test(value)
    )
      issues.push({
        path,
        code: "pattern",
        message: "El texto no cumple el patrón.",
      });
  }
  if (Array.isArray(value) && schema.items !== undefined)
    value.forEach((item, index) =>
      issues.push(
        ...validateToolArguments(
          item,
          schema.items ?? { type: "string" },
          `${path}[${index}]`,
        ),
      ),
    );
  if (schema.type === "object") {
    const object = value as AIUnknownRecord;
    for (const required of schema.required ?? [])
      if (!(required in object))
        issues.push({
          path: `${path}.${required}`,
          code: "required",
          message: "Propiedad obligatoria ausente.",
        });
    for (const [key, item] of Object.entries(object)) {
      const property = schema.properties?.[key];
      if (property === undefined) {
        if (schema.additionalProperties === false)
          issues.push({
            path: `${path}.${key}`,
            code: "additionalProperties",
            message: "Propiedad no permitida.",
          });
      } else
        issues.push(...validateToolArguments(item, property, `${path}.${key}`));
    }
  }
  return Object.freeze(issues);
}
