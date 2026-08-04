GANO_BOT — Manual Maestro para Agentes de Programación

Versión: 2.0.0Estado: Contrato operativo principal del repositorioAudiencia: Codex, Claude Code, Cursor, Blackbox AI, Aider, OpenHands, Cline, Roo Code, Windsurf, Gemini CLI y desarrolladores humanosIdioma oficial: EspañolÚltima actualización: 2026-08-04

1. Propósito

AGENTS.md define cómo debe comprenderse, modificarse, validarse y extenderse el repositorio GANO_BOT.

No es un README ni una descripción comercial. Es el contrato operativo que debe leer cualquier agente antes de modificar código.

Las instrucciones específicas del usuario tienen prioridad, pero toda excepción debe explicarse, limitarse al alcance autorizado y documentarse en el informe final.

2. Visión del producto

GANO_BOT no es únicamente un chatbot para Gano Sim Premium. Gano Sim Premium y Gano iTouch constituyen el primer caso de uso.

El objetivo es construir una plataforma reutilizable de asistentes de IA:

especializados;

multiempresa;

multiasistente;

embebibles;

configurables;

desacoplados del conocimiento;

capaces de trabajar con conocimiento privado;

capaces de responder con precisión y trazabilidad;

reutilizables sin modificar el núcleo.

El mismo motor debe poder utilizarse en Gano iTouch, MG Salud y Belleza, soporte técnico, atención al cliente, RRHH, ventas, educación, documentación empresarial y futuros proyectos.

Lo que cambia entre asistentes es:

configuración;

identidad y branding;

prompt del sistema;

proveedores y modelos;

fuentes de conocimiento;

herramientas;

permisos;

memoria;

políticas;

configuración del widget.

3. Principio fundamental

El motor no debe contener conocimiento empresarial específico.

El núcleo solo debe conocer contratos, interfaces, pipelines, políticas generales, adaptadores, validadores, registros, eventos, errores y configuración.

El conocimiento debe añadirse externamente mediante PDF, DOCX, TXT, Markdown, HTML, JSON, CSV, Excel, Firestore, PostgreSQL, Supabase, MySQL, SQLite, MongoDB, APIs, sitios web, Google Drive, Notion, SharePoint, sistemas internos, almacenes vectoriales y conectores personalizados.

No se deben introducir productos, rangos, bonos, reglas de negocio ni datos de Gano iTouch dentro de ai-core.

4. Resultado funcional esperado

El sistema final debe:

recibir una consulta desde el widget o la API;

identificar tenant y asistente;

autenticar y validar permisos;

cargar configuración;

recuperar conversación;

detectar intención;

seleccionar fuentes autorizadas;

recuperar información relevante;

generar o utilizar embeddings;

filtrar por tenant, asistente, base y permisos;

reordenar resultados;

construir contexto limitado por tokens;

seleccionar proveedor LLM;

aplicar fallback;

generar respuesta fundamentada;

validar la respuesta;

construir citas;

indicar insuficiencia de información;

guardar conversación y memoria autorizada;

registrar métricas, errores y consumo;

responder por JSON o streaming.

5. Conducta contra alucinaciones

Cuando un asistente use conocimiento privado:

no debe inventar;

no debe rellenar vacíos con conocimiento general sin autorización;

no debe presentar inferencias como hechos;

no debe atribuir una afirmación a una fuente que no la contiene;

debe distinguir hechos recuperados, inferencias y conocimiento general;

debe conservar trazabilidad;

debe poder responder: “No encuentro información suficiente en las fuentes de conocimiento disponibles.”

Las citas deben conservar, cuando exista: tenantId, assistantId, knowledgeBaseId, documentId, título, tipo, página, sección, fragmento, ubicación, score, origen, versión y metadata permitida.

6. Arquitectura objetivo

Shared Contracts

AI Core

Chat Providers

Embedding Providers

Provider Registry

Provider Fallback

Conversation Engine

Prompt Builder

Intent Detection

Context Builder

Response Validation

Token Budgeting

Knowledge Platform

Document Ingestion

Document Loaders

Chunking

Vector Storage

Retrieval

Ranking y Reranking

RAG

Citations

Memory

Tools

Plugins

Multi-tenancy

Authentication

Authorization

API Backend

Administration

Embeddable Widget

Observability

Testing

Documentation

7. Arquitectura del monorepo

GANO_BOT/
├── apps/
│   ├── web/
│   ├── functions/
│   └── ingestion/
├── packages/
│   ├── shared/
│   ├── ai-core/
│   ├── business-engine-adapter/
│   └── chat-widget/
├── docs/
├── firebase/
├── scripts/
├── tests/
├── AGENTS.md
├── README.md
├── package.json
├── package-lock.json
├── tsconfig.json
└── tsconfig.base.json

No incluir en ZIPs o entregas:

node_modules/
dist/
coverage/
.vite/
.firebase/
.cache/
*.tsbuildinfo
.env
.env.local

8. Responsabilidad de workspaces

packages/shared

Contratos compartidos, tipos primitivos y utilidades puras. No depende de React, Firebase, proveedores ni lógica empresarial.

packages/ai-core

Contratos de IA, proveedores, chat, embeddings, memoria, contexto, prompts, intención, validación, conversación, RAG, citas, tools y runtime. No depende directamente de React, Zustand, Firebase, Firestore, una base de datos concreta ni conocimiento de negocio.

packages/business-engine-adapter

Adapta motores de negocio y los expone mediante contratos o herramientas. No introduce dependencias inversas desde ai-core.

packages/chat-widget

Widget embebible, UI conversacional, streaming, citas, accesibilidad y personalización. No contiene conocimiento empresarial.

apps/web

Panel administrativo para asistentes, conocimiento, documentos, conversaciones, branding, proveedores, tools, usuarios y métricas.

apps/functions

API backend, autenticación, autorización, credenciales, conversaciones, knowledge bases, ingesta, streaming y métricas. Las claves nunca llegan al frontend.

apps/ingestion

Carga documentos, extrae texto, normaliza, crea chunks, genera embeddings, almacena, versiona y evita duplicados.

9. Modelo multiempresa

Toda operación sensible debe transportar o resolver:

tenantId;

assistantId;

userId o actorId;

requestId;

correlationId.

Debe existir aislamiento entre tenants, asistentes, conversaciones, mensajes, bases, documentos, chunks, memoria, herramientas, credenciales y métricas.

Nunca debe existir recuperación sin filtro de tenant, memoria compartida accidentalmente, acceso cruzado, documentos de otro asistente, herramientas no autorizadas o credenciales visibles en cliente.

10. Configuración de asistentes

La plataforma debe poder declarar identidad, descripción, prompt, idioma, mensajes de bienvenida, preguntas sugeridas, modelo principal, fallback, parámetros, proveedores, embeddings, conocimiento, tools, memoria, citas, grounding, permisos, branding y widget.

Antes de crear tipos nuevos, el agente debe buscar contratos existentes para evitar duplicados.

11. Prioridad actual

Auditar el repositorio real.

Completar la capa chat.

Consolidar el runtime de asistentes.

Completar Knowledge Platform.

Completar ingesta.

Completar RAG y citas.

Completar memoria.

Completar tools y plugins.

Completar backend.

Completar widget.

Completar administración.

Seguridad, observabilidad, pruebas y documentación.

12. Reglas para agentes

Todo agente debe:

leer este archivo;

inspeccionar el repositorio;

leer contratos públicos;

leer implementaciones de referencia;

ejecutar compilación inicial;

registrar errores existentes;

crear un plan;

trabajar por hitos;

modificar solo lo necesario;

compilar después de cada hito;

corregir todos los errores;

documentar decisiones;

entregar informe final.

Debe detenerse ante cambios destructivos, credenciales, contratos incompatibles, migraciones, decisiones irreversibles o activación de servicios de pago.

13. Primera acción obligatoria

Verificar entorno:

node -v
npm -v
git --version

Si faltan dependencias y el usuario autorizó preparar el equipo:

npm install

Después:

npx tsc -b --clean
npx tsc -b --force --pretty false
npm run build

Registrar comando, código de salida, errores, archivos, líneas, causa y workspace.

14. TypeScript y calidad

Obligatorio:

strict: true;

noImplicitAny;

strictNullChecks;

noUncheckedIndexedAccess;

noImplicitOverride;

noUnusedLocals;

noUnusedParameters;

noImplicitReturns;

verbatimModuleSyntax;

import type para tipos.

Prohibido:

any;

as any;

@ts-ignore;

@ts-expect-error;

@ts-nocheck;

non-null assertions sin justificación;

TODO, FIXME, HACK;

pseudocódigo;

funciones vacías presentadas como completas;

mocks presentados como producción;

código muerto;

silenciar errores;

relajar TypeScript para evitar corregir tipos.

15. Inmutabilidad

Usar interfaces readonly, arrays readonly, configuraciones y descriptores congelados, respuestas normalizadas congeladas e inputs no mutados. Se permiten Map y Set internos encapsulados.

16. Convenciones de nombres

Tipos e interfaces: PascalCase.

Configuraciones: sufijo Config.

Configuraciones resueltas: prefijo Resolved.

Errores: sufijo Error.

Proveedores: {Provider}ChatProvider.

Factorías: create{Provider}ChatProvider.

Funciones: normalize, create, validate, convert, resolve, read, map.

Constantes: UPPER_SNAKE_CASE.

Archivos: seguir la convención real del directorio.

17. Errores

Los errores deben tener clase específica, código estable, cause, contexto permitido y diferenciación entre cancelación, timeout, autenticación, rate limit, validación y respuesta inválida.

No deben filtrar secretos. Los errores externos deben normalizarse antes de salir de la capa del proveedor.

18. REST

Todos los proveedores deben usar fetch, AbortController, timeout, señal externa, headers explícitos, lectura con response.text() y posterior JSON.parse, errores normalizados y fetchImplementation inyectable.

No usar SDKs oficiales, Axios ni clientes innecesarios salvo autorización explícita.

19. AIMetadata

Debe respetar su definición real. No admite objetos anidados ni arrays de objetos.

Las estructuras complejas deben serializarse:

const metadata = {
  toolCalls: JSON.stringify(toolCalls),
};

La restauración debe validar el string, ejecutar JSON.parse, comprobar forma e ignorar entradas inválidas.

20. Proveedores de chat

Cada proveedor debe extender BaseAIChatProvider, resolver configuración, crear descriptor, declarar capacidades, convertir mensajes y tools, construir request REST, manejar timeout/abort, normalizar errores, usage, finish reason y tool calls, preservar raw y exponer factoría.

Gemini

Debe manejar systemInstruction, roles user/model, contents, parts, functionCall, functionResponse, functionDeclarations, generationConfig, JSON mode, usageMetadata, promptFeedback, bloqueos y candidatos sin texto.

Fallback

Debe recibir proveedores ordenados, evitar fallback tras cancelación, distinguir errores recuperables, registrar fallos y lanzar error compuesto si todos fallan.

Registry

Debe registrar, reemplazar con autorización, habilitar, deshabilitar, listar, obtener, requerir y definir proveedor predeterminado.

21. Knowledge Platform

Debe desacoplarse mediante contratos equivalentes a KnowledgeSource, KnowledgeConnector, DocumentLoader, LoadedDocument, DocumentParser, ChunkingStrategy, KnowledgeChunk, KnowledgeRepository, VectorStore, Retriever, Reranker, CitationBuilder y KnowledgeIngestionPipeline.

Los nombres pueden variar si ya existen equivalentes.

22. Ingesta

Debe conservar tenant, asistente, base, documento, nombre, tipo, origen, checksum, versión, fecha, estado, metadata y permisos.

Debe procurar idempotencia, deduplicación, reintentos, reprocesamiento, estados claros, errores trazables, chunks deterministas y preservación de títulos/secciones.

23. RAG

El pipeline debe normalizar pregunta, detectar intención, construir consulta, recuperar, filtrar, deduplicar, reordenar, aplicar score mínimo, construir contexto, respetar presupuesto, generar, citar y validar grounding.

Modos mínimos:

conocimiento privado estricto;

conocimiento privado preferido;

conocimiento general permitido.

24. Memoria

Debe contemplar turno actual, historial reciente, resumen, largo plazo, preferencias, expiración, límites, eliminación, consentimiento y aislamiento multiempresa.

La persistencia depende de un contrato inyectable. El adaptador en memoria debe marcarse como desarrollo.

25. Tools y plugins

Una tool debe declarar id, nombre, descripción, esquema, permisos, timeout, handler y metadata.

Debe existir registro, validación de argumentos, ejecución segura, timeout, abort, auditoría y resultado normalizado.

Solo se ejecutan tools autorizadas. Los documentos recuperados son datos, no instrucciones.

26. Backend

Debe resolver autenticación, autorización, credenciales, conversaciones, mensajes, asistentes, knowledge bases, documentos, ingesta, tools, streaming, health y métricas.

Las claves nunca deben exponerse al frontend.

27. Widget embebible

Debe ser pequeño cerrado, flotante, atractivo, accesible, responsive, configurable, reutilizable e independiente del dashboard.

Estados mínimos:

cerrado;

minimizado;

bienvenida;

conversación;

escribiendo;

error;

sin conexión;

fuentes;

historial;

pantalla completa.

Configuración mínima: assistantId, tenant o mecanismo seguro, apiUrl, autenticación, posición, tema, colores, logo, nombre, idioma, preguntas sugeridas, modo compacto, citas, streaming y feedback.

28. Seguridad

Considerar autenticación, autorización, aislamiento, roles, permisos, uploads, tamaños, tipos, sanitización, prompt injection, instrucciones maliciosas en documentos, rate limiting, credenciales, auditoría, retención y borrado.

Los documentos nunca reemplazan el prompt del sistema.

29. Observabilidad

Registrar request, correlation, tenant, assistant, proveedor, modelo, latencia, tokens, coste estimado, retrieval count, scores, fallback, errores, tools y estado de ingesta.

No registrar secretos ni contenido sensible completo por defecto.

30. Pruebas

No llamar APIs reales. Usar fetchImplementation, fixtures pequeñas, resultados deterministas, adaptadores en memoria y estado aislado.

Prioridad: validadores, normalizadores, OpenAI, Gemini, fallback, registry, chunking, multi-tenant, retrieval, citas, grounding estricto, memoria, tools, widget y API.

31. Compilación

Después de cada hito:

npx tsc -b packages/ai-core --force --pretty false

Cuando cambien contratos o varios workspaces:

npm run build

También, si existen:

npm run typecheck
npm run lint
npm run test

No declarar un hito terminado si TypeScript o build fallan, existen exports rotos, quedan funciones vacías o el flujo principal no es ejecutable.

32. Dependencias

Antes de añadir una dependencia: comprobar si ya existe, justificar necesidad, verificar mantenimiento y tipos, minimizar peso, evitar SDKs pesados, actualizar lockfile y documentar.

No actualizar dependencias masivamente sin autorización.

33. Modificaciones

No hacer sin autorización:

renombrar carpetas;

mover módulos;

eliminar archivos;

cambiar contratos públicos;

romper compatibilidad;

modificar tsconfig para silenciar errores;

cambiar workspaces;

borrar lockfile;

refactorizar todo;

migrar bases;

activar servicios de pago.

Sí se permite dentro del alcance: crear archivos, completar implementaciones, añadir exports, corregir errores, añadir pruebas, actualizar documentación y añadir dependencias justificadas.

34. Flujo por hito

inspeccionar;

describir estado;

listar archivos;

proponer plan;

implementar;

compilar;

probar;

corregir;

recompilar;

entregar informe.

El informe debe incluir archivos creados/modificados, decisiones, errores corregidos, comandos, resultados, riesgos y siguiente hito.

35. Roadmap

Hito 1 — Chat

Gemini, fallback, registry, barrels y build limpio.

Hito 2 — Runtime

Conversation engine, providers, prompts, contexto, intención, memoria, validación y factoría.

Hito 3 — Knowledge Platform

Contratos, loaders, repositorio, vector store, retrieval y citas.

Hito 4 — Ingesta

TXT, Markdown, JSON, CSV, HTML y preparación/implementación de PDF, DOCX y Excel.

Hito 5 — RAG

Retrieval, ranking, presupuesto, grounding, citas y modos estrictos.

Hito 6 — Memoria

Corto plazo, resumen, largo plazo, persistencia y aislamiento.

Hito 7 — Tools y Plugins

Registry, permisos, ejecución y auditoría.

Hito 8 — Backend

API, auth, configuración, knowledge, chat y streaming.

Hito 9 — Widget

UI, estados, personalización, citas e integración.

Hito 10 — Administración

Asistentes, conocimiento, documentos, tools, conversaciones y métricas.

Hito 11 — Seguridad y Observabilidad

Políticas, aislamiento, logs, métricas y auditoría.

Hito 12 — Pruebas y Documentación

Cobertura, instalación, integración, despliegue y ejemplos.

36. Criterios finales

El proyecto está preparado cuando instala, compila, construye y prueba correctamente; soporta OpenAI/Gemini, registry/fallback, runtime reusable, RAG, ingesta, aislamiento, citas, modo privado estricto, memoria, tools, backend, widget, personalización y documentación; y permite crear un segundo asistente sin modificar ai-core.

37. Instrucción final

No te limites a explicar cuando el usuario autorice implementación. Debes inspeccionar, planificar, editar, compilar, probar, corregir y documentar.

No declares una fase terminada si solo creaste interfaces. No presentes adaptadores en memoria como producción. No presentes pseudocódigo como implementación. No introduzcas conocimiento específico dentro del núcleo.

GANO_BOT es un motor de asistentes de IA especializados, multiempresa y embebibles, cuyo diferencial es permitir añadir conocimiento privado y responder con precisión, trazabilidad y control sobre él.