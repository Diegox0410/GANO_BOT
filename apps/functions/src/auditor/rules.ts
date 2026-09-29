import type { AuditArea, AuditFinding, AuditSeverity, BusinessAuditInput } from "./contracts.js";

interface Rule {
  readonly id: string;
  readonly area: AuditArea;
  readonly key: string;
  readonly title: string;
  readonly severity: AuditSeverity;
  readonly remediation: string;
  readonly blocker?: boolean;
}

export const AUDIT_RULES: readonly Rule[] = Object.freeze([
  { id:"brand.identity", area:"BRAND", key:"brandIdentity", title:"Identidad de marca definida", severity:"LOW", remediation:"Definir nombre, tono, propuesta y lineamientos básicos." },
  { id:"catalog.source", area:"CATALOG", key:"catalogSource", title:"Fuente de catálogo disponible", severity:"CRITICAL", remediation:"Conectar una fuente autoritativa de productos.", blocker:true },
  { id:"catalog.prices", area:"CATALOG", key:"authoritativePrices", title:"Precios autoritativos", severity:"CRITICAL", remediation:"Centralizar precios en Chopify o adapter comercial.", blocker:true },
  { id:"catalog.stock", area:"CATALOG", key:"authoritativeStock", title:"Disponibilidad autoritativa", severity:"HIGH", remediation:"Conectar inventario/availability a CommercePort.", blocker:true },
  { id:"channels.inbound", area:"CHANNELS", key:"inboundChannel", title:"Canal de entrada operativo", severity:"HIGH", remediation:"Habilitar al menos Web, WhatsApp, Instagram, Facebook u OTHER.", blocker:true },
  { id:"service.escalation", area:"CUSTOMER_SERVICE", key:"humanEscalation", title:"Escalamiento humano disponible", severity:"HIGH", remediation:"Configurar Supervisor y responsable humano.", blocker:true },
  { id:"knowledge.base", area:"KNOWLEDGE", key:"knowledgeReady", title:"Conocimiento comercial disponible", severity:"MEDIUM", remediation:"Cargar FAQ, políticas y documentación útil en Knowledge Manager." },
  { id:"policies.sales", area:"POLICIES", key:"salesPolicies", title:"Políticas de venta definidas", severity:"MEDIUM", remediation:"Documentar cambios, devoluciones, garantías, privacidad y condiciones." },
  { id:"crm.identity", area:"CRM", key:"identityResolution", title:"Resolución de identidad omnicanal", severity:"HIGH", remediation:"Habilitar resolveCustomerIdentity para el tenant.", blocker:true },
  { id:"crm.pipeline", area:"CRM", key:"opportunityPipeline", title:"Pipeline de oportunidades", severity:"MEDIUM", remediation:"Habilitar creación y seguimiento de oportunidades." },
  { id:"ecommerce.orders", area:"ECOMMERCE", key:"orderDrafts", title:"Creación controlada de pedidos", severity:"HIGH", remediation:"Habilitar createOrderDraft mediante CommercePort.", blocker:true },
  { id:"payments.proof", area:"PAYMENTS", key:"paymentProofReview", title:"Comprobantes con revisión humana", severity:"CRITICAL", remediation:"Mantener PaymentProof como pending_review hasta aprobación.", blocker:true },
  { id:"fulfillment.process", area:"FULFILLMENT", key:"fulfillmentProcess", title:"Proceso de preparación y despacho", severity:"MEDIUM", remediation:"Definir preparación, despacho, tracking y estados." },
  { id:"automation.supervisor", area:"AUTOMATION", key:"supervisor", title:"Supervisor operativo", severity:"HIGH", remediation:"Activar clasificación y excepciones para intervención humana.", blocker:true },
  { id:"integrations.chopify", area:"INTEGRATIONS", key:"chopifyGateway", title:"Gateway comercial conectado", severity:"CRITICAL", remediation:"Configurar GanoBot ↔ Chopify con autenticación server-to-server.", blocker:true },
  { id:"security.tenant", area:"SECURITY", key:"tenantIsolation", title:"Aislamiento por tenant", severity:"CRITICAL", remediation:"Garantizar tenant server-side y pruebas anti cross-tenant.", blocker:true },
  { id:"security.auth", area:"SECURITY", key:"productionAuth", title:"Autenticación productiva", severity:"CRITICAL", remediation:"Sustituir autenticación de desarrollo antes de producción.", blocker:true },
  { id:"ganobot.studio", area:"GANOBOT", key:"studioPublished", title:"Configuración Studio publicada", severity:"HIGH", remediation:"Validar y publicar una versión Studio para el asistente.", blocker:true },
]);

export function evaluateRules(input: BusinessAuditInput): readonly AuditFinding[] {
  return Object.freeze(AUDIT_RULES.map(rule => {
    const raw = input.capabilities[rule.key];
    const unknown = raw === undefined || raw === null || raw === "";
    const pass = raw === true || (typeof raw === "string" && raw.trim().length > 0) || (typeof raw === "number" && raw > 0);
    return Object.freeze({
      id: rule.id,
      area: rule.area,
      status: unknown ? "UNKNOWN" as const : pass ? "PASS" as const : "GAP" as const,
      severity: pass ? "INFO" as const : rule.severity,
      title: rule.title,
      detail: unknown
        ? `No existe evidencia suficiente para verificar "${rule.key}".`
        : pass
          ? `Capacidad "${rule.key}" verificada por la entrada de auditoría.`
          : `La capacidad "${rule.key}" no está lista.`,
      evidenceKeys: Object.freeze([rule.key]),
      ...(!pass ? { remediation: rule.remediation } : {}),
    });
  }));
}

export function blockerRuleIds(): ReadonlySet<string> {
  return new Set(AUDIT_RULES.filter(rule => rule.blocker).map(rule => rule.id));
}
