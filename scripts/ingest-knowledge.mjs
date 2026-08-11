import {
  createHash,
} from "node:crypto";

import {
  readdir,
  readFile,
  stat,
} from "node:fs/promises";

import {
  extname,
  join,
  resolve,
} from "node:path";

import {
  fileURLToPath,
} from "node:url";

import {
  assistantId,
  getGanoHostedRuntime,
  knowledgePrincipal,
  tenantId,
} from "./gano-hosted-runtime.mjs";

/*
 * =========================================================
 * GANO BOT — KNOWLEDGE INCREMENTAL INGESTION
 * =========================================================
 *
 * Sincroniza knowledge/*.md con Firestore.
 *
 * Estados posibles:
 *
 * CREATE
 *   El documento todavía no existe.
 *
 * UPDATE
 *   Existe, pero su SHA-256 cambió.
 *
 * UNCHANGED
 *   Existe y su SHA-256 es idéntico.
 *
 * SKIP
 *   Archivo vacío.
 *
 * ERROR
 *   Falló la ingesta.
 *
 * El SHA-256 propio se persiste en:
 *
 * document.metadata.sourceSha256
 *
 * Esto evita depender del algoritmo interno utilizado
 * por BrowserBytesDocumentProcessor para document.checksum.
 */

/*
 * =========================================================
 * RUTAS
 * =========================================================
 */

const currentFile =
  fileURLToPath(
    import.meta.url,
  );

const projectRoot =
  resolve(
    currentFile,
    "..",
    "..",
  );

const knowledgeDirectory =
  join(
    projectRoot,
    "knowledge",
  );

/*
 * =========================================================
 * CONFIGURACIÓN
 * =========================================================
 */

const DEFAULT_LANGUAGE =
  "es";

const MIME_TYPE =
  "text/markdown";

const SUPPORTED_EXTENSIONS =
  new Set([
    ".md",
    ".markdown",
  ]);

const GLOBAL_TAGS =
  Object.freeze([
    "public",
    "gano-knowledge",
    "gano-sim",
    "gano-itouch",
  ]);

/*
 * =========================================================
 * CATÁLOGO
 * =========================================================
 */

const KNOWLEDGE_DOCUMENTS =
  Object.freeze({
    "00_empresa.md": {
      title:
        "Gano iTouch - Empresa",

      tags: [
        "empresa",
        "informacion-general",
      ],
    },

    "01_historia.md": {
      title:
        "Gano iTouch - Historia",

      tags: [
        "historia",
        "empresa",
      ],
    },

    "02_fundador.md": {
      title:
        "Gano iTouch - Fundador",

      tags: [
        "fundador",
        "historia",
      ],
    },

    "03_ganoderma.md": {
      title:
        "Gano iTouch - Ganoderma",

      tags: [
        "ganoderma",
        "ganoderma-lucidum",
        "bienestar",
      ],
    },

    "04_productos.md": {
      title:
        "Gano iTouch - Productos",

      tags: [
        "productos",
        "catalogo",
      ],
    },

    "05_plan_compensacion.md": {
      title:
        "Gano iTouch - Plan de Compensación",

      tags: [
        "plan-compensacion",
        "compensacion",
        "negocio",
      ],
    },

    "06_rangos.md": {
      title:
        "Gano iTouch - Rangos",

      tags: [
        "rangos",
        "calificacion",
      ],
    },

    "07_pv_cv_gcv.md": {
      title:
        "Gano iTouch - PV, CV y GCV",

      tags: [
        "pv",
        "cv",
        "gcv",
        "volumen",
      ],
    },

    "08_binario.md": {
      title:
        "Gano iTouch - Bono Binario",

      tags: [
        "binario",
        "bono-binario",
        "compensacion",
      ],
    },

    "09_gen5.md": {
      title:
        "Gano iTouch - GEN5",

      tags: [
        "gen5",
        "inicio-rapido",
        "compensacion",
      ],
    },

    "10_regalias.md": {
      title:
        "Gano iTouch - Regalías",

      tags: [
        "regalias",
        "compensacion",
      ],
    },

    "11_centro_bienestar.md": {
      title:
        "Gano iTouch - Centro de Bienestar",

      tags: [
        "centro-bienestar",
        "bienestar",
      ],
    },

    "12_preguntas_frecuentes.md": {
      title:
        "Gano iTouch - Preguntas Frecuentes",

      tags: [
        "faq",
        "preguntas-frecuentes",
      ],
    },

    "13_legalidad.md": {
      title:
        "Gano iTouch - Legalidad",

      tags: [
        "legalidad",
        "legal",
      ],
    },

    "14_objeciones.md": {
      title:
        "Gano iTouch - Manejo de Objeciones",

      tags: [
        "objeciones",
        "ventas",
        "formacion",
      ],
    },

    "15_tutoriales.md": {
      title:
        "Gano iTouch - Tutoriales",

      tags: [
        "tutoriales",
        "formacion",
      ],
    },

    "16_paquetes.md": {
      title:
        "Gano iTouch - Paquetes",

      tags: [
        "paquetes",
        "ci",
        "esp",
      ],
    },

    "17_patologias.md": {
      title:
        "Gano iTouch - Patologías y Bienestar",

      tags: [
        "patologias",
        "bienestar",
        "salud",
      ],
    },

    "18_testimonios.md": {
      title:
        "Gano iTouch - Testimonios",

      tags: [
        "testimonios",
        "bienestar",
      ],
    },

    "19_misiones.md": {
      title:
        "Gano Sim - Misiones",

      tags: [
        "misiones",
        "progreso",
      ],
    },

    "20_glosario.md": {
      title:
        "Gano iTouch - Glosario",

      tags: [
        "glosario",
        "conceptos",
      ],
    },

    "21_politicas.md": {
      title:
        "Gano iTouch - Políticas",

      tags: [
        "politicas",
        "normas",
        "legal",
      ],
    },

    "22_ciclos.md": {
      title:
        "Gano iTouch - Ciclos",

      tags: [
        "ciclos",
        "calificacion",
        "compensacion",
      ],
    },

    "23_calificacion.md": {
      title:
        "Gano iTouch - Calificación",

      tags: [
        "calificacion",
        "rangos",
        "actividad",
      ],
    },

    "24_firebase_schema.md": {
      title:
        "Gano Sim - Esquema Firebase",

      tags: [
        "firebase",
        "firestore",
        "schema",
      ],
    },

    "25_api_prompts.md": {
      title:
        "Gano Bot - API y Prompts",

      tags: [
        "api",
        "prompts",
        "gano-bot",
      ],
    },
  });

/*
 * =========================================================
 * NORMALIZACIÓN
 * =========================================================
 */

function normalizeFileName(
  value,
) {
  return String(
    value ?? "",
  )
    .trim()
    .toLowerCase();
}

function fallbackTitle(
  fileName,
) {
  return fileName
    .replace(
      /\.(md|markdown)$/i,
      "",
    )
    .replace(
      /^\d+[_-]?/,
      "",
    )
    .replace(
      /[_-]+/g,
      " ",
    )
    .replace(
      /\s+/g,
      " ",
    )
    .trim()
    .replace(
      /\b\w/g,
      (character) =>
        character.toUpperCase(),
    );
}

function configurationFor(
  fileName,
) {
  return (
    KNOWLEDGE_DOCUMENTS[
      fileName
    ] ?? {
      title:
        fallbackTitle(
          fileName,
        ),

      tags: [
        "custom",
      ],
    }
  );
}

function tagsFor(
  configuration,
) {
  return Object.freeze([
    ...new Set([
      ...GLOBAL_TAGS,
      ...(
        configuration.tags ??
        []
      ),
    ]),
  ]);
}

/*
 * =========================================================
 * SHA-256
 * =========================================================
 */

function sha256(
  buffer,
) {
  return createHash(
    "sha256",
  )
    .update(
      buffer,
    )
    .digest(
      "hex",
    );
}

function persistedSourceSha256(
  document,
) {
  const value =
    document?.metadata
      ?.sourceSha256;

  return typeof value ===
    "string"
    ? value.trim()
        .toLowerCase()
    : null;
}

/*
 * =========================================================
 * ARCHIVOS
 * =========================================================
 */

async function listKnowledgeFiles() {
  const entries =
    await readdir(
      knowledgeDirectory,
      {
        withFileTypes:
          true,
      },
    );

  return entries
    .filter(
      (entry) =>
        entry.isFile(),
    )
    .map(
      (entry) =>
        entry.name,
    )
    .filter(
      (fileName) =>
        SUPPORTED_EXTENSIONS.has(
          extname(
            fileName,
          ).toLowerCase(),
        ),
    )
    .sort(
      (
        left,
        right,
      ) =>
        left.localeCompare(
          right,
          "es",
          {
            numeric:
              true,
          },
        ),
    );
}

function createBrowserFile(
  fileName,
  buffer,
) {
  return Object.freeze({
    name:
      fileName,

    type:
      MIME_TYPE,

    size:
      buffer.byteLength,

    async arrayBuffer() {
      /*
       * Generamos una copia para entregar un ArrayBuffer
       * que represente exactamente los bytes del archivo.
       */

      const copy =
        Buffer.from(
          buffer,
        );

      return copy.buffer.slice(
        copy.byteOffset,
        copy.byteOffset +
          copy.byteLength,
      );
    },
  });
}

function findExistingDocument(
  documents,
  fileName,
) {
  const normalized =
    normalizeFileName(
      fileName,
    );

  return documents.find(
    (document) =>
      normalizeFileName(
        document.originalFileName,
      ) ===
      normalized,
  );
}

/*
 * =========================================================
 * PERSISTIR SHA-256
 * =========================================================
 *
 * KnowledgeManagerService.ingest() guarda el ManagedDocument.
 *
 * Después añadimos sourceSha256 a metadata y volvemos a
 * persistir el mismo documento.
 *
 * No modificamos document.checksum porque pertenece al
 * processor.
 */

async function persistSourceSha256({
  runtime,
  document,
  sourceSha256,
  fileName,
}) {
  const updated =
    Object.freeze({
      ...document,

      metadata:
        Object.freeze({
          ...(
            document.metadata ??
            {}
          ),

          sourceSha256,

          sourceFileName:
            fileName,

          sourceHashAlgorithm:
            "sha256",
        }),
    });

  await runtime
    .knowledgeRepository
    .saveDocument(
      updated,
    );

  return updated;
}

/*
 * =========================================================
 * MAIN
 * =========================================================
 */

async function main() {
  console.log("");
  console.log(
    "==============================================",
  );
  console.log(
    " GANO BOT — KNOWLEDGE INCREMENTAL SYNC",
  );
  console.log(
    "==============================================",
  );
  console.log("");

  console.log(
    `Tenant: ${tenantId}`,
  );

  console.log(
    `Assistant: ${assistantId}`,
  );

  console.log(
    `Knowledge directory: ${knowledgeDirectory}`,
  );

  console.log("");

  /*
   * Utilizamos exactamente el mismo runtime
   * persistente utilizado por producción.
   */

  const runtime =
    await getGanoHostedRuntime();

  const base =
    runtime.knowledgeBase;

  console.log(
    `Knowledge Base: ${base.name}`,
  );

  console.log(
    `Knowledge Base ID: ${base.knowledgeBaseId}`,
  );

  console.log("");

  /*
   * Snapshot inicial de documentos persistidos.
   */

  const existingDocuments =
    [
      ...(
        await runtime
          .knowledgeRepository
          .listDocuments(
            tenantId,
            base.knowledgeBaseId,
          )
      ),
    ];

  const fileNames =
    await listKnowledgeFiles();

  console.log(
    `Archivos Markdown encontrados: ${fileNames.length}`,
  );

  console.log("");

  const summary = {
    discovered:
      fileNames.length,

    created:
      0,

    updated:
      0,

    unchanged:
      0,

    skippedEmpty:
      0,

    failed:
      0,

    totalChunks:
      0,
  };

  for (
    const fileName
    of fileNames
  ) {
    const absolutePath =
      join(
        knowledgeDirectory,
        fileName,
      );

    try {
      const fileStats =
        await stat(
          absolutePath,
        );

      if (
        fileStats.size ===
        0
      ) {
        summary.skippedEmpty +=
          1;

        console.log(
          `[SKIP] ${fileName} — vacío`,
        );

        continue;
      }

      /*
       * Leemos una sola vez los bytes originales.
       *
       * El mismo Buffer sirve para:
       *
       * - comprobar contenido;
       * - calcular SHA-256;
       * - enviar al processor.
       */

      const buffer =
        await readFile(
          absolutePath,
        );

      const text =
        buffer.toString(
          "utf8",
        );

      if (
        text.trim().length ===
        0
      ) {
        summary.skippedEmpty +=
          1;

        console.log(
          `[SKIP] ${fileName} — sin contenido útil`,
        );

        continue;
      }

      const localSha256 =
        sha256(
          buffer,
        );

      const existing =
        findExistingDocument(
          existingDocuments,
          fileName,
        );

      /*
       * =====================================================
       * UNCHANGED
       * =====================================================
       */

      if (existing) {
        const remoteSha256 =
          persistedSourceSha256(
            existing,
          );

        if (
          remoteSha256 ===
          localSha256
        ) {
          summary.unchanged +=
            1;

          console.log(
            `[UNCHANGED] ${fileName}`,
          );

          console.log(
            `            Version: ${existing.version}`,
          );

          console.log(
            `            SHA-256: ${localSha256.slice(0, 16)}…`,
          );

          console.log("");

          continue;
        }
      }

      const configuration =
        configurationFor(
          fileName,
        );

      const file =
        createBrowserFile(
          fileName,
          buffer,
        );

      const upload =
        Object.freeze({
          file,

          title:
            configuration.title,

          language:
            DEFAULT_LANGUAGE,

          tags:
            tagsFor(
              configuration,
            ),

          ...(
            existing
              ? {
                  replaceDocumentId:
                    existing.documentId,
                }
              : {}
          ),
        });

      /*
       * =====================================================
       * CREATE / UPDATE
       * =====================================================
       */

      console.log(
        existing
          ? `[UPDATE] ${fileName}`
          : `[CREATE] ${fileName}`,
      );

      if (
        existing &&
        !persistedSourceSha256(
          existing,
        )
      ) {
        console.log(
          "         Hash anterior: no disponible (documento legado)",
        );
      }

      console.log(
        `         SHA-256: ${localSha256}`,
      );

      const result =
        await runtime
          .knowledgeManager
          .ingest(
            knowledgePrincipal,
            base.knowledgeBaseId,
            assistantId,
            upload,
          );

      /*
       * Guardamos nuestro SHA-256 sin alterar el checksum
       * administrado por el processor.
       */

      const persistedDocument =
        await persistSourceSha256({
          runtime,
          document:
            result.document,
          sourceSha256:
            localSha256,
          fileName,
        });

      summary.totalChunks +=
        result.chunks.length;

      if (existing) {
        summary.updated +=
          1;

        const index =
          existingDocuments
            .findIndex(
              (document) =>
                document.documentId ===
                existing.documentId,
            );

        if (
          index >=
          0
        ) {
          existingDocuments[
            index
          ] =
            persistedDocument;
        }
      } else {
        summary.created +=
          1;

        existingDocuments.push(
          persistedDocument,
        );
      }

      console.log(
        `         Document ID: ${persistedDocument.documentId}`,
      );

      console.log(
        `         Version: ${persistedDocument.version}`,
      );

      console.log(
        `         Chunks: ${result.chunks.length}`,
      );

      console.log(
        `         Status: ${persistedDocument.status}`,
      );

      console.log("");
    } catch (error) {
      summary.failed +=
        1;

      console.error(
        `[ERROR] ${fileName}`,
      );

      console.error(
        error instanceof Error
          ? (
              error.stack ??
              error.message
            )
          : error,
      );

      console.log("");
    }
  }

  /*
   * =========================================================
   * VERIFICACIÓN FINAL DESDE FIRESTORE
   * =========================================================
   */

  const finalDocuments =
    await runtime
      .knowledgeRepository
      .listDocuments(
        tenantId,
        base.knowledgeBaseId,
      );

  const finalBases =
    await runtime
      .knowledgeRepository
      .listBases(
        tenantId,
      );

  const finalBase =
    finalBases.find(
      (item) =>
        item.knowledgeBaseId ===
        base.knowledgeBaseId,
    );

  console.log("");
  console.log(
    "==============================================",
  );
  console.log(
    " RESUMEN DE SINCRONIZACIÓN",
  );
  console.log(
    "==============================================",
  );

  console.log(
    `Archivos encontrados   : ${summary.discovered}`,
  );

  console.log(
    `Documentos creados     : ${summary.created}`,
  );

  console.log(
    `Documentos actualizados: ${summary.updated}`,
  );

  console.log(
    `Sin cambios            : ${summary.unchanged}`,
  );

  console.log(
    `Archivos vacíos        : ${summary.skippedEmpty}`,
  );

  console.log(
    `Errores                : ${summary.failed}`,
  );

  console.log(
    `Chunks procesados      : ${summary.totalChunks}`,
  );

  console.log("");

  console.log(
    `Documentos en Firestore: ${finalDocuments.length}`,
  );

  console.log(
    `Chunks en Knowledge Base: ${finalBase?.chunkCount ?? "N/D"}`,
  );

  console.log(
    `Tamaño total: ${finalBase?.totalSizeBytes ?? "N/D"} bytes`,
  );

  console.log(
    `Estado de la base: ${finalBase?.status ?? "N/D"}`,
  );

  console.log("");

  if (
    summary.failed >
    0
  ) {
    console.error(
      "La sincronización terminó con errores.",
    );

    process.exitCode =
      1;

    return;
  }

  console.log(
    "Knowledge Base sincronizada correctamente.",
  );
}

/*
 * =========================================================
 * EJECUCIÓN
 * =========================================================
 */

main().catch(
  (error) => {
    console.error("");
    console.error(
      "[GANO_BOT] Error fatal durante la sincronización.",
    );

    console.error(
      error instanceof Error
        ? (
            error.stack ??
            error.message
          )
        : error,
    );

    process.exitCode =
      1;
  },
);