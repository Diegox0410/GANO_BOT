import type {
  Firestore,
  Query,
} from "firebase-admin/firestore";

import type {
  KnowledgeChunk,
} from "@gano-bot/ai-core/knowledge";

import type {
  KnowledgeManagerDocumentProcessor,
  ManagedDocument,
  ManagedDocumentStatus,
  ManagedFileUpload,
  ManagedIngestionResult,
} from "@gano-bot/ai-core/knowledge-manager";

/**
 * Procesador base utilizado para:
 *
 * - leer archivos;
 * - parsearlos;
 * - dividirlos en chunks;
 * - generar ManagedDocument;
 *
 * Normalmente será BrowserBytesDocumentProcessor.
 */
export interface PersistentKnowledgeDocumentProcessorDelegate
  extends KnowledgeManagerDocumentProcessor {}

const CHUNKS_COLLECTION =
  "ganoKnowledge_chunks";

/**
 * Firestore admite hasta 500 operaciones por batch.
 *
 * Dejamos margen para evitar acercarnos innecesariamente
 * al límite del servicio.
 */
const FIRESTORE_BATCH_SIZE =
  400;

interface StoredKnowledgeChunk {
  readonly tenantId: string;
  readonly assistantId: string;
  readonly knowledgeBaseId: string;
  readonly documentId: string;
  readonly version: string;

  readonly chunkId: string;
  readonly chunkIndex: number;

  readonly content: string;

  readonly tokenCount?: number;

  readonly startOffset: number;
  readonly endOffset: number;

  readonly page?: number;
  readonly section?: string;
  readonly heading?: string;

  readonly language: string;
  readonly checksum: string;

  readonly metadata: KnowledgeChunk["metadata"];

  readonly persistedAt: string;
}

function createChunkDocumentId(
  chunk: KnowledgeChunk,
): string {
  const {
    tenantId,
    documentId,
    version,
  } = chunk.metadata;

  return [
    tenantId,
    documentId,
    version,
    chunk.id,
  ]
    .map(
      (value) =>
        encodeURIComponent(
          String(value),
        ),
    )
    .join("__");
}

function freezeChunks(
  chunks:
    readonly KnowledgeChunk[],
): readonly KnowledgeChunk[] {
  return Object.freeze(
    chunks.map(
      (chunk) =>
        Object.freeze({
          ...chunk,

          metadata:
            Object.freeze({
              ...chunk.metadata,

              metadata:
                Object.freeze({
                  ...chunk.metadata
                    .metadata,
                }),
            }),
        }),
    ),
  );
}

function chunkToFirestoreRecord(
  chunk: KnowledgeChunk,
  persistedAt: string,
): StoredKnowledgeChunk {
  const record: StoredKnowledgeChunk = {
    tenantId:
      chunk.metadata.tenantId,

    assistantId:
      chunk.metadata.assistantId,

    knowledgeBaseId:
      chunk.metadata
        .knowledgeBaseId,

    documentId:
      chunk.metadata.documentId,

    version:
      String(
        chunk.metadata.version,
      ),

    chunkId:
      chunk.id,

    chunkIndex:
      chunk.metadata.chunkIndex,

    content:
      chunk.content,

    startOffset:
      chunk.metadata.startOffset,

    endOffset:
      chunk.metadata.endOffset,

    language:
      chunk.metadata.language,

    checksum:
      chunk.metadata.checksum,

    metadata:
      chunk.metadata,

    persistedAt,
  };

  return Object.freeze({
    ...record,

    ...(
      chunk.tokenCount ===
      undefined
        ? {}
        : {
            tokenCount:
              chunk.tokenCount,
          }
    ),

    ...(
      chunk.metadata.page ===
      undefined
        ? {}
        : {
            page:
              chunk.metadata.page,
          }
    ),

    ...(
      chunk.metadata.section ===
      undefined
        ? {}
        : {
            section:
              chunk.metadata
                .section,
          }
    ),

    ...(
      chunk.metadata.heading ===
      undefined
        ? {}
        : {
            heading:
              chunk.metadata
                .heading,
          }
    ),
  });
}

function firestoreRecordToChunk(
  record:
    StoredKnowledgeChunk,
): KnowledgeChunk {
  const chunk: KnowledgeChunk = {
    id:
      record.chunkId,

    content:
      record.content,

    metadata:
      Object.freeze({
        ...record.metadata,

        metadata:
          Object.freeze({
            ...record.metadata
              .metadata,
          }),
      }),
  };

  return Object.freeze({
    ...chunk,

    ...(
      record.tokenCount ===
      undefined
        ? {}
        : {
            tokenCount:
              record.tokenCount,
          }
    ),
  });
}

function splitIntoBatches<T>(
  values: readonly T[],
  size: number,
): readonly (
  readonly T[]
)[] {
  const result:
    T[][] = [];

  for (
    let index = 0;
    index < values.length;
    index += size
  ) {
    result.push(
      values.slice(
        index,
        index + size,
      ),
    );
  }

  return Object.freeze(
    result.map(
      (batch) =>
        Object.freeze(batch),
    ),
  );
}

/**
 * KnowledgeManagerDocumentProcessor persistente.
 *
 * Responsabilidades:
 *
 * 1. Delegar procesamiento real del archivo.
 * 2. Guardar chunks generados en Firestore.
 * 3. Recuperar chunks desde Firestore después de un
 *    cold start o reinicio de Vercel.
 *
 * El archivo original todavía NO se persiste aquí.
 * Esa responsabilidad se agregará posteriormente
 * mediante Firebase Storage.
 */
export class FirestoreKnowledgeDocumentProcessor
  implements KnowledgeManagerDocumentProcessor
{
  public constructor(
    private readonly firestore:
      Firestore,

    private readonly delegate:
      PersistentKnowledgeDocumentProcessorDelegate,

    private readonly now:
      () => string =
        () =>
          new Date()
            .toISOString(),
  ) {}

  private collection() {
    return this.firestore.collection(
      CHUNKS_COLLECTION,
    );
  }

  private queryForDocument(
    document:
      ManagedDocument,
  ): Query {
    return this.collection()
      .where(
        "tenantId",
        "==",
        document.tenantId,
      )
      .where(
        "assistantId",
        "==",
        document.assistantId,
      )
      .where(
        "knowledgeBaseId",
        "==",
        document.knowledgeBaseId,
      )
      .where(
        "documentId",
        "==",
        document.documentId,
      )
      .where(
        "version",
        "==",
        String(
          document.version,
        ),
      );
  }

  private async deletePersistedChunks(
    document:
      ManagedDocument,
  ): Promise<void> {
    const snapshot =
      await this
        .queryForDocument(
          document,
        )
        .get();

    if (snapshot.empty) {
      return;
    }

    const references =
      snapshot.docs.map(
        (entry) =>
          entry.ref,
      );

    const batches =
      splitIntoBatches(
        references,
        FIRESTORE_BATCH_SIZE,
      );

    for (
      const referencesBatch
      of batches
    ) {
      const batch =
        this.firestore.batch();

      for (
        const reference
        of referencesBatch
      ) {
        batch.delete(
          reference,
        );
      }

      await batch.commit();
    }
  }

  private async persistChunks(
    chunks:
      readonly KnowledgeChunk[],
  ): Promise<void> {
    if (
      chunks.length === 0
    ) {
      return;
    }

    const persistedAt =
      this.now();

    const batches =
      splitIntoBatches(
        chunks,
        FIRESTORE_BATCH_SIZE,
      );

    for (
      const chunkBatch
      of batches
    ) {
      const batch =
        this.firestore.batch();

      for (
        const chunk
        of chunkBatch
      ) {
        const reference =
          this.collection()
            .doc(
              createChunkDocumentId(
                chunk,
              ),
            );

        const record =
          chunkToFirestoreRecord(
            chunk,
            persistedAt,
          );

        batch.set(
          reference,
          record,
        );
      }

      await batch.commit();
    }
  }

  private async readPersistedChunks(
    document:
      ManagedDocument,
  ): Promise<
    readonly KnowledgeChunk[]
  > {
    const snapshot =
      await this
        .queryForDocument(
          document,
        )
        .get();

    if (snapshot.empty) {
      return Object.freeze(
        [],
      );
    }

    const records =
      snapshot.docs.map(
        (entry) =>
          entry.data() as
            StoredKnowledgeChunk,
      );

    records.sort(
      (
        left,
        right,
      ) =>
        left.chunkIndex -
        right.chunkIndex,
    );

    return freezeChunks(
      records.map(
        firestoreRecordToChunk,
      ),
    );
  }

  public async process(
    input: {
      readonly tenantId:
        string;

      readonly assistantId:
        string;

      readonly knowledgeBaseId:
        string;

      readonly documentId:
        string;

      readonly version:
        number;

      readonly upload:
        ManagedFileUpload;

      readonly actorId:
        string;

      readonly signal?:
        AbortSignal;

      readonly onProgress?: (
        status:
          ManagedDocumentStatus,

        completed:
          number,
      ) =>
        void |
        Promise<void>;
    },
  ): Promise<
    ManagedIngestionResult
  > {
    const result =
      await this.delegate
        .process(
          input,
        );

    /**
     * Eliminamos únicamente chunks de la misma
     * versión antes de volver a escribirlos.
     *
     * Las versiones históricas permanecen
     * disponibles.
     */
    await this
      .deletePersistedChunks(
        result.document,
      );

    await this.persistChunks(
      result.chunks,
    );

    return Object.freeze({
      ...result,

      chunks:
        freezeChunks(
          result.chunks,
        ),
    });
  }

  public async reprocess(
    document:
      ManagedDocument,

    actorId:
      string,

    signal?:
      AbortSignal,

    onProgress?: (
      status:
        ManagedDocumentStatus,

      completed:
        number,
    ) =>
      void |
      Promise<void>,
  ): Promise<
    ManagedIngestionResult
  > {
    /**
     * BrowserBytesDocumentProcessor puede reprocesar
     * mientras conserve los bytes originales en memoria.
     *
     * La persistencia del archivo original mediante
     * Firebase Storage se implementará después.
     */
    const result =
      await this.delegate
        .reprocess(
          document,
          actorId,
          signal,
          onProgress,
        );

    await this
      .deletePersistedChunks(
        result.document,
      );

    await this.persistChunks(
      result.chunks,
    );

    return Object.freeze({
      ...result,

      chunks:
        freezeChunks(
          result.chunks,
        ),
    });
  }

  public async reindex(
    document:
      ManagedDocument,

    signal?:
      AbortSignal,
  ): Promise<
    readonly KnowledgeChunk[]
  > {
    if (
      signal?.aborted ===
      true
    ) {
      throw new Error(
        "Operación cancelada.",
      );
    }

    /**
     * Primero Firestore.
     *
     * Esto permite reindexar incluso después de que
     * la instancia serverless original haya muerto.
     */
    const persisted =
      await this
        .readPersistedChunks(
          document,
        );

    if (
      persisted.length > 0
    ) {
      return persisted;
    }

    /**
     * Fallback de compatibilidad para documentos
     * procesados antes de activar la persistencia.
     */
    const delegated =
      await this.delegate
        .reindex(
          document,
          signal,
        );

    if (
      delegated.length >
      0
    ) {
      await this.persistChunks(
        delegated,
      );
    }

    return freezeChunks(
      delegated,
    );
  }

  public async getChunks(
    document:
      ManagedDocument,
  ): Promise<
    readonly KnowledgeChunk[]
  > {
    /**
     * Firestore es la fuente primaria.
     */
    const persisted =
      await this
        .readPersistedChunks(
          document,
        );

    if (
      persisted.length > 0
    ) {
      return persisted;
    }

    /**
     * Fallback temporal para compatibilidad con
     * chunks que aún estén en memoria.
     */
    const delegated =
      await this.delegate
        .getChunks(
          document,
        );

    if (
      delegated.length >
      0
    ) {
      await this.persistChunks(
        delegated,
      );
    }

    return freezeChunks(
      delegated,
    );
  }
}