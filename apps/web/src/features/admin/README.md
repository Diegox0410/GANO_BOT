# Enterprise Administration — Hito 11

El módulo amplía Assistant Studio sin contener lógica de IA. `EnterpriseAdminApp` depende de `EnterpriseAdminService`; sus adaptadores son `InMemoryEnterpriseAdminService` (demo/pruebas, no productivo) y `BackendEnterpriseAdminService` (REST con `fetch`, timeout, `AbortSignal` y token inyectable).

```text
EnterpriseAdminApp
  -> EnterpriseAdminService
     -> InMemoryEnterpriseAdminService (offline)
     -> BackendEnterpriseAdminService
        -> /v1/admin/*
           -> routeEnterpriseAdmin
              -> EnterpriseAdminService
                 -> InMemoryEnterpriseRepository (offline)

Asistentes -> Assistant Studio existente
IA/RAG/Memoria/Tools -> contratos existentes, sin reimplementación
```

Los adaptadores locales usan fixtures explícitamente deterministas. No almacenan contraseñas, credenciales o contenido privado completo; las exportaciones omiten campos sensibles. Las eliminaciones locales archivan. Los costos son estimaciones manuales no facturadas. No existen autenticación, correo, SSO, infraestructura, bases ni proveedores productivos en este hito.
