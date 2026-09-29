# H8 — GanoBot Auditor

## Propósito
Auditar preparación digital/comercial de un tenant sin inventar evidencia ni sustituir la autoridad de Chopify.

## Áreas
Brand, Catalog, Channels, Customer Service, Knowledge, Policies, CRM, Ecommerce, Payments, Fulfillment, Automation, Integrations, Security y GanoBot.

## Principios
- UNKNOWN no equivale a PASS.
- La ausencia de evidencia no se rellena con suposiciones.
- Los bloqueadores impiden declarar listo un piloto controlado.
- No se asigna un score cosmético: se entregan hallazgos, bloqueadores, desconocidos y acciones priorizadas P0-P3.
- Studio aporta evidencia de configuración publicada, canales, RAG y allowlist de tools.
- Datos externos como catálogo real, autenticación productiva, políticas y fulfillment deben declararse u observarse explícitamente.
- Chopify sigue siendo source of truth comercial.
- PaymentProof continúa requiriendo revisión; Auditor solo verifica la capacidad.

## Resultado
BusinessAuditReport:
- findings
- actions
- counts
- blockers
- unknowns
- readyForControlledPilot
- summary

H8 no realiza cambios automáticos sobre el negocio. Diagnostica y produce un plan accionable.
