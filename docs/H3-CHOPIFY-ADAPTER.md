# H3 — Chopify HTTP Adapter

`ChopifyHttpAdapter` implementa `CommercePort` sin introducir conocimiento de Chopify en AI Core.

- HTTPS obligatorio.
- Token bearer exclusivamente server-side.
- Tenant derivado de `CommerceRequestContext` y enviado en `X-Chopify-Tenant-Id`; nunca en el body controlable por el modelo.
- Propaga request ID, correlation ID e idempotency key.
- Timeout y cancelación con `AbortController`.
- El adapter no aprueba pagos ni modifica inventario por fuera de las operaciones del puerto.

Variables server-side:
- `CHOPIFY_COMMERCE_BASE_URL`
- `CHOPIFY_COMMERCE_API_TOKEN`
- `CHOPIFY_COMMERCE_TIMEOUT_MS` opcional.

El mismo `CHOPIFY_COMMERCE_API_TOKEN` debe configurarse en el backend de Chopify y GanoBot. Nunca usar prefijo `VITE_`.
