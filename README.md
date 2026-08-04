# GANO_BOT

## Enterprise Administration (Hito 11)

La demo local abre en `/admin` y extiende Assistant Studio con administración multiempresa, RBAC, usuarios, invitaciones, conocimiento, operaciones, uso, costos estimados, métricas, auditoría, políticas y estado del sistema. Funciona offline mediante adaptadores en memoria explícitamente no productivos. Los asistentes continúan editándose en Assistant Studio; el panel no reimplementa IA, RAG, memoria, ingesta ni tools.

La API administrativa vive bajo `/v1/admin/*` y depende de `EnterpriseAdminService`. Autenticación, persistencia y salud externa siguen siendo simuladas en desarrollo; no se almacenan credenciales, contraseñas ni contenido privado completo.
