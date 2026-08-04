# Assistant Studio — Hito 10

Assistant Studio es una capa visual para administrar configuraciones. No ejecuta IA, RAG, memoria, ingesta ni herramientas directamente.

## Arquitectura

```text
StudioApp
  -> AssistantStudioService
       -> BackendAssistantStudioService (recursos expuestos por Hito 8)
       -> InMemoryAssistantStudioService (demo/pruebas, no productivo)
  -> AssistantWidget (preview y playground del Hito 9)
```

El editor cubre identidad, comportamiento, proveedores, RAG, knowledge bases, memoria, tools, widget, pruebas y publicación. La navegación usa History API para evitar otra dependencia.

## Persistencia y publicación

El adaptador incluido es volátil y está marcado como desarrollo. Incrementa la versión al guardar y aísla datos por tenant. Publicar valida y cambia el estado local, pero no despliega infraestructura ni crea credenciales.

El Backend del Hito 8 permite leer asistentes, knowledge bases, documentos, tools y readiness. Como no expone mutaciones administrativas, `BackendAssistantStudioService` rechaza explícitamente crear, editar o publicar, en lugar de simular éxito.

## Seguridad

- No se almacenan API keys ni tokens.
- Los prompts sensibles se sustituyen por `[PROTECTED]` en exportaciones.
- Las importaciones validan JSON, versión y forma mínima; nunca ejecutan contenido.
- IDs, URLs, colores, límites y configuraciones contradictorias se validan.
- Las acciones destructivas y publicación requieren confirmación.
- El preview reutiliza `AssistantWidget`; no existe una copia local del widget.
