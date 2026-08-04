import type {
  ToolConfirmationPolicy,
  ToolDescriptor,
  ToolExecutionContext,
  ToolPermissionPolicy,
} from "./types.js";
const RISKS = Object.freeze([
  "safe",
  "low",
  "medium",
  "high",
  "critical",
] as const);
export class SecureToolPermissionPolicy implements ToolPermissionPolicy {
  public async authorize(tool: ToolDescriptor, context: ToolExecutionContext) {
    if (tool.tenantId !== undefined && tool.tenantId !== context.tenantId)
      return Object.freeze({ allowed: false, reason: "tenant-denied" });
    if (
      tool.assistantId !== undefined &&
      tool.assistantId !== context.assistantId
    )
      return Object.freeze({ allowed: false, reason: "assistant-denied" });
    if (!context.allowedToolIds.includes(tool.id))
      return Object.freeze({ allowed: false, reason: "tool-not-allowlisted" });
    if (!context.allowedCategories.includes(tool.category))
      return Object.freeze({ allowed: false, reason: "category-denied" });
    if (RISKS.indexOf(tool.riskLevel) > RISKS.indexOf(context.maximumRiskLevel))
      return Object.freeze({ allowed: false, reason: "risk-denied" });
    if (
      !tool.requiredPermissions.every((permission) =>
        context.permissions.includes(permission),
      )
    )
      return Object.freeze({ allowed: false, reason: "permission-denied" });
    return Object.freeze({ allowed: true, reason: "allowed" });
  }
}
export class DefaultToolConfirmationPolicy implements ToolConfirmationPolicy {
  public async evaluate(tool: ToolDescriptor, _context: ToolExecutionContext) {
    const required =
      tool.confirmationPolicy === "always" ||
      (tool.confirmationPolicy === "risk-based" &&
        RISKS.indexOf(tool.riskLevel) >= RISKS.indexOf("high")) ||
      (tool.confirmationPolicy === "destructive-only" &&
        tool.riskLevel === "critical") ||
      tool.confirmationPolicy === "custom";
    return Object.freeze({
      required,
      reason: required
        ? `confirmation-${tool.confirmationPolicy}`
        : "not-required",
    });
  }
}
