import { BackendApiError } from "../errors.js";
import type { BusinessAuditInput, BusinessAuditReport, AuditAction, AuditFindingStatus } from "./contracts.js";
import { blockerRuleIds, evaluateRules } from "./rules.js";

const PRIORITY = Object.freeze({ CRITICAL:"P0", HIGH:"P1", MEDIUM:"P2", LOW:"P3", INFO:"P3" } as const);

export class GanoBotAuditor {
  public audit(input: BusinessAuditInput, now = new Date().toISOString()): BusinessAuditReport {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.tenantId))
      throw new BackendApiError("BAD_REQUEST", "tenantId inválido.", 400);
    if (!input.businessName.trim())
      throw new BackendApiError("BAD_REQUEST", "businessName es obligatorio.", 400);

    const findings = evaluateRules(input);
    const blockerIds = blockerRuleIds();
    const blockers = findings.filter(f => blockerIds.has(f.id) && f.status !== "PASS").map(f => f.id);
    const unknowns = findings.filter(f => f.status === "UNKNOWN").map(f => f.id);
    const actions: AuditAction[] = findings
      .filter(f => f.status !== "PASS")
      .map(f => Object.freeze({
        id:`action.${f.id}`,
        area:f.area,
        priority:PRIORITY[f.severity],
        title:f.remediation ?? `Verificar ${f.title}`,
        reason:f.detail,
        dependsOn:Object.freeze([]),
      }))
      .sort((a,b) => ["P0","P1","P2","P3"].indexOf(a.priority) - ["P0","P1","P2","P3"].indexOf(b.priority));

    const counts: Record<AuditFindingStatus, number> = { PASS:0, GAP:0, RISK:0, UNKNOWN:0 };
    for (const finding of findings) counts[finding.status] += 1;
    const ready = blockers.length === 0;
    const summary = ready
      ? `${input.businessName} no presenta bloqueadores en las capacidades auditadas para un piloto controlado.`
      : `${input.businessName} presenta ${blockers.length} bloqueador(es) y ${unknowns.length} verificación(es) pendiente(s) antes de un piloto controlado.`;

    return Object.freeze({
      tenantId:input.tenantId,
      businessName:input.businessName.trim(),
      ...(input.assistantId ? { assistantId:input.assistantId } : {}),
      generatedAt:now,
      findings,
      actions:Object.freeze(actions),
      counts:Object.freeze(counts),
      readyForControlledPilot:ready,
      blockers:Object.freeze(blockers),
      unknowns:Object.freeze(unknowns),
      summary,
    });
  }
}
