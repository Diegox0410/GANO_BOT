# H4 — Commerce Runtime

H4 compone el runtime Commerce de GanoBot exclusivamente desde configuración server-side.

`createCommerceRuntimeFromEnv()` valida HTTPS, token de servidor, allowlist de tenants y el assistantId `commerce-assistant`; después construye `ChopifyHttpAdapter` y las ocho Commerce Tools tipadas de H2/H3.

Variables: `CHOPIFY_COMMERCE_BASE_URL`, `CHOPIFY_COMMERCE_API_TOKEN`, opcional `CHOPIFY_COMMERCE_TIMEOUT_MS`, opcional `GANOBOT_COMMERCE_ALLOWED_TENANTS`.

El token nunca se expone al modelo ni al navegador. El tenant de cada ToolExecutionContext sigue siendo la autoridad de alcance. La persistencia autoritativa vive en Chopify; GanoBot no replica CRM, pedidos, pagos ni inventario.
