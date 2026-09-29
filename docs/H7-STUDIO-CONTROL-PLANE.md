# H7 — GanoBot Studio Control Plane

## Objetivo
Convertir Assistant Studio en un control plane versionado y persistible para administrar asistentes por tenant sin convertir Studio en autoridad comercial.

## Garantías
- Aislamiento estricto por tenant.
- Draft y publicación son operaciones separadas.
- El runtime consume exclusivamente una versión publicada.
- Studio configura allowlists de tools; no ejecuta ni concede permisos de backend.
- FirestoreStudioRepository permite persistencia server-side.
- El resolver produce una configuración mínima para runtime: prompt, locale, RAG, memoria y tools.
- Chopify continúa siendo source of truth de catálogo, stock, pedidos y pagos.
- PaymentProof no se convierte en Payment por configuración de Studio.

## Flujo
Studio UI -> draft -> validate -> publish -> published snapshot -> StudioRuntimeConfigurationResolver -> GanoBot Runtime.

## Integración posterior
La capa HTTP del BackendApplication debe exponer las mutaciones de Studio con RBAC antes de habilitar edición remota desde el navegador. Este H7 deja el control plane, persistencia Firestore, publicación y resolver de runtime listos y testeados, sin abrir endpoints inseguros.
