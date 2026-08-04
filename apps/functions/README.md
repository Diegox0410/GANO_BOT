# Backend/API — Hito 8

Backend HTTP desacoplado basado en los estándares Web `Request` y `Response`. No abre puertos por sí mismo: un adaptador serverless o Node futuro puede delegar cada solicitud a `BackendApplication.handle()`.

## Flujo

```text
Request -> contexto/IDs -> autenticación -> rate limit -> autorización
        -> validación -> servicio/adaptador inyectado -> auditoría/métricas
        -> respuesta HTTP normalizada
```

`BackendChatGateway` es el puerto hacia `AssistantManager`/`RuntimeRegistry`, RAG, memoria y proveedores. `ToolServices` reutiliza directamente Tools Engine. Los catálogos de conversaciones, asistentes, conocimiento e ingesta incluidos son adaptadores volátiles exclusivos para desarrollo y pruebas; no son persistencia productiva.

## Autenticación de desarrollo

`DevelopmentAuthenticationProvider` acepta explícitamente `Bearer dev:<tenantId>:<actorId>[:tenant-admin|platform-admin]`. No verifica firmas y no debe habilitarse en producción. `AuthenticationProvider` y `TokenVerifier` permiten sustituirlo sin cambiar router, controladores ni servicios.

## Streaming

`POST /v1/chat/stream` emite SSE con eventos de etapa y un mensaje completo. No presenta esos eventos como streaming de tokens porque los proveedores actuales no exponen deltas a esta frontera.

## Ejecución offline

```powershell
npm.cmd run test --workspace=@gano-bot/functions
```

La prueba usa gateway, autenticación, almacenamiento y herramientas deterministas sin red ni credenciales.
