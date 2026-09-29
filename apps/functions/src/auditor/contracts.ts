export type AuditArea =
  | "BRAND"
  | "CATALOG"
  | "CHANNELS"
  | "CUSTOMER_SERVICE"
  | "KNOWLEDGE"
  | "POLICIES"
  | "CRM"
  | "ECOMMERCE"
  | "PAYMENTS"
  | "FULFILLMENT"
  | "AUTOMATION"
  | "INTEGRATIONS"
  | "SECURITY"
  | "GANOBOT";

export type AuditSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type AuditFindingStatus = "PASS" | "GAP" | "RISK" | "UNKNOWN";
export type AuditEvidenceSource = "DECLARED" | "OBSERVED" | "SYSTEM";

export interface AuditEvidence {
  readonly source: AuditEvidenceSource;
  readonly key: string;
  readonly value: string | number | boolean | null;
}

export interface BusinessAuditInput {
  readonly tenantId: string;
  readonly businessName: string;
  readonly assistantId?: string;
  readonly capabilities: Readonly<Record<string, boolean | string | number | null | undefined>>;
  readonly evidence?: readonly AuditEvidence[];
}

export interface AuditFinding {
  readonly id: string;
  readonly area: AuditArea;
  readonly status: AuditFindingStatus;
  readonly severity: AuditSeverity;
  readonly title: string;
  readonly detail: string;
  readonly evidenceKeys: readonly string[];
  readonly remediation?: string;
}

export interface AuditAction {
  readonly id: string;
  readonly area: AuditArea;
  readonly priority: "P0" | "P1" | "P2" | "P3";
  readonly title: string;
  readonly reason: string;
  readonly dependsOn: readonly string[];
}

export interface BusinessAuditReport {
  readonly tenantId: string;
  readonly businessName: string;
  readonly assistantId?: string;
  readonly generatedAt: string;
  readonly findings: readonly AuditFinding[];
  readonly actions: readonly AuditAction[];
  readonly counts: Readonly<Record<AuditFindingStatus, number>>;
  readonly readyForControlledPilot: boolean;
  readonly blockers: readonly string[];
  readonly unknowns: readonly string[];
  readonly summary: string;
}
