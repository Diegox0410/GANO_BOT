import type {
  KnowledgeManagerDocumentProcessor,
  KnowledgeManagerRepository,
  ManagedDocument,
} from "@gano-bot/ai-core/knowledge-manager";

import type {
  KnowledgeChunk,
  RankingCandidate,
  RetrievalCandidateSource,
  RetrievalRequest,
} from "@gano-bot/ai-core/knowledge";

const RETRIEVABLE_DOCUMENT_STATUSES =
  new Set([
    "ready",
    "partially-ready",
  ]);

const normalizeText = (
  value: string,
): string =>
  value
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      "",
    )
    .toLowerCase()
    .replace(
      /[^a-z0-9ñü\s-]/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (
  value: string,
): readonly string[] =>
  Object.freeze(
    normalizeText(value)
      .split(" ")
      .map((token) => token.trim())
      .filter(
        (token) => token.length >= 3,
      ),
  );

const unique = (
  values: readonly string[],
): readonly string[] =>
  Object.freeze([...new Set(values)]);

function documentMatchesRequest(
  document: ManagedDocument,
  request: RetrievalRequest,
): boolean {
  const { filters } = request;

  if (
    document.tenantId !==
      filters.tenantId ||
    document.assistantId !==
      filters.assistantId ||
    document.knowledgeBaseId !==
      filters.knowledgeBaseId
  ) {
    return false;
  }

  if (
    !RETRIEVABLE_DOCUMENT_STATUSES.has(
      document.status,
    )
  ) {
    return false;
  }

  if (
    filters.documentIds !== undefined &&
    !filters.documentIds.includes(
      document.documentId,
    )
  ) {
    return false;
  }

  if (
    filters.versions !== undefined &&
    !filters.versions.includes(
      String(document.version),
    )
  ) {
    return false;
  }

  if (
    filters.language !== undefined &&
    document.language !==
      filters.language
  ) {
    return false;
  }

  if (
    filters.tags !== undefined &&
    filters.tags.length > 0 &&
    !filters.tags.some((tag) =>
      document.tags.includes(tag),
    )
  ) {
    return false;
  }

  return true;
}

function calculateChunkScore(
  query: string,
  document: ManagedDocument,
  chunk: KnowledgeChunk,
): {
  readonly score: number;
  readonly reasons: readonly string[];
} {
  const queryTokens = unique(
    tokenize(query),
  );

  if (queryTokens.length === 0) {
    return Object.freeze({
      score: 0,
      reasons: Object.freeze([
        "query-without-indexable-terms",
      ]),
    });
  }

  const normalizedContent =
    normalizeText(chunk.content);

  const normalizedTitle =
    normalizeText(document.title);

  const normalizedTags =
    normalizeText(
      document.tags.join(" "),
    );

  let contentMatches = 0;
  let titleMatches = 0;
  let tagMatches = 0;

  for (const token of queryTokens) {
    if (
      normalizedContent.includes(token)
    ) {
      contentMatches += 1;
    }

    if (
      normalizedTitle.includes(token)
    ) {
      titleMatches += 1;
    }

    if (
      normalizedTags.includes(token)
    ) {
      tagMatches += 1;
    }
  }

  const denominator =
    queryTokens.length;

  const contentScore =
    contentMatches / denominator;

  const titleScore =
    titleMatches / denominator;

  const tagScore =
    tagMatches / denominator;

  const exactPhraseMatch =
    normalizeText(query).length >= 5 &&
    normalizedContent.includes(
      normalizeText(query),
    );

  const score = Math.min(
    1,
    contentScore * 0.7 +
      titleScore * 0.2 +
      tagScore * 0.1 +
      (exactPhraseMatch ? 0.2 : 0),
  );

  const reasons: string[] = [];

  if (contentMatches > 0) {
    reasons.push(
      `content-matches:${contentMatches}`,
    );
  }

  if (titleMatches > 0) {
    reasons.push(
      `title-matches:${titleMatches}`,
    );
  }

  if (tagMatches > 0) {
    reasons.push(
      `tag-matches:${tagMatches}`,
    );
  }

  if (exactPhraseMatch) {
    reasons.push(
      "exact-phrase-match",
    );
  }

  return Object.freeze({
    score,
    reasons: Object.freeze(reasons),
  });
}

export interface GanoKnowledgeCandidateSourceConfig {
  readonly repository:
    KnowledgeManagerRepository;

  readonly processor:
    KnowledgeManagerDocumentProcessor;
}

export class GanoKnowledgeCandidateSource
  implements RetrievalCandidateSource
{
  public constructor(
    private readonly config:
      GanoKnowledgeCandidateSourceConfig,
  ) {}

  public async retrieveCandidates(
    request: RetrievalRequest,
  ): Promise<
    readonly RankingCandidate[]
  > {
    const documents =
      await this.config.repository.listDocuments(
        request.filters.tenantId,
        request.filters.knowledgeBaseId,
      );

    const eligibleDocuments =
      documents.filter((document) =>
        documentMatchesRequest(
          document,
          request,
        ),
      );

    const candidateGroups =
      await Promise.all(
        eligibleDocuments.map(
          async (document) => {
            if (
              request.context.signal
                ?.aborted
            ) {
              return [];
            }

            const chunks =
              await this.config.processor.getChunks(
                document,
              );

            return chunks
              .map((chunk) => {
                const scoring =
                  calculateChunkScore(
                    request.query,
                    document,
                    chunk,
                  );

                return Object.freeze({
                  chunk,
                  score:
                    scoring.score,
                  reasons:
                    scoring.reasons,
                });
              })
              .filter(
                (candidate) =>
                  candidate.score > 0,
              );
          },
        ),
      );
    
    const candidates =
      candidateGroups.flat();

    console.log(
      "[Gano Knowledge] Retrieval",
      {
        query: request.query,
        documents:
          documents.length,
        eligibleDocuments:
          eligibleDocuments.length,
        candidates:
          candidates.length,
        scores:
          candidates.map(
            (candidate) => ({
              score:
                candidate.score,
              reasons:
                candidate.reasons,
              chunkId:
                candidate.chunk.id,
            }),
          ),
      },
    );

    return Object.freeze(
      candidates,
    );
  }
}

export function createGanoKnowledgeCandidateSource(
  config: GanoKnowledgeCandidateSourceConfig,
): RetrievalCandidateSource {
  return new GanoKnowledgeCandidateSource(
    config,
  );
}