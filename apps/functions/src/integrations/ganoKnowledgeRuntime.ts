import type {
  KnowledgeManagerDocumentProcessor,
  KnowledgeManagerRepository,
} from "@gano-bot/ai-core/knowledge-manager";

import {
  createConversationKnowledgeRetrieverAdapter,
  createRetriever,
} from "@gano-bot/ai-core/knowledge";

import type {
  ConversationKnowledgeRetriever,
} from "@gano-bot/ai-core/conversationEngine";

import type {
  Retriever,
} from "@gano-bot/ai-core/knowledge";

import {
  createGanoKnowledgeCandidateSource,
} from "./ganoKnowledgeCandidateSource.js";

export interface GanoKnowledgeRuntimeScope {
  readonly tenantId: string;
  readonly assistantId: string;
  readonly knowledgeBaseId: string;
}

export interface GanoKnowledgeRuntimeConfig {
  readonly repository:
    KnowledgeManagerRepository;

  readonly processor:
    KnowledgeManagerDocumentProcessor;

  readonly scope:
    GanoKnowledgeRuntimeScope;

  /**
   * Cantidad máxima predeterminada de fragmentos
   * recuperados por consulta.
   */
  readonly defaultLimit?: number;

  /**
   * Puntuación mínima permitida.
   *
   * La fuente léxica genera puntuaciones entre 0 y 1.
   */
  readonly defaultMinimumScore?: number;
}

export interface GanoKnowledgeRuntime {
  /**
   * Retriever interno del módulo de conocimiento.
   *
   * Puede utilizarse directamente en pruebas o diagnósticos.
   */
  readonly retriever: Retriever;

  /**
   * Adaptador listo para ser inyectado en AssistantManager.
   */
  readonly conversationRetriever:
    ConversationKnowledgeRetriever;

  /**
   * Alcance fijo utilizado para mantener el aislamiento
   * multiempresa y por base de conocimiento.
   */
  readonly scope:
    Readonly<GanoKnowledgeRuntimeScope>;
}

const normalizeIdentifier = (
  value: string,
  fieldName: string,
): string => {
  const normalized = String(value ?? "")
    .trim();

  if (!normalized) {
    throw new Error(
      `${fieldName} es obligatorio para configurar el conocimiento de Gano.`,
    );
  }

  return normalized;
};

const normalizeLimit = (
  value: number | undefined,
): number => {
  if (
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return 8;
  }

  return Math.max(
    1,
    Math.min(
      20,
      Math.floor(value),
    ),
  );
};

const normalizeMinimumScore = (
  value: number | undefined,
): number => {
  if (
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return 0.15;
  }

  return Math.max(
    0,
    Math.min(1, value),
  );
};

export function createGanoKnowledgeRuntime(
  config: GanoKnowledgeRuntimeConfig,
): GanoKnowledgeRuntime {
  if (!config.repository) {
    throw new Error(
      "KnowledgeManagerRepository es obligatorio.",
    );
  }

  if (!config.processor) {
    throw new Error(
      "KnowledgeManagerDocumentProcessor es obligatorio.",
    );
  }

  const scope = Object.freeze({
    tenantId: normalizeIdentifier(
      config.scope?.tenantId,
      "tenantId",
    ),

    assistantId: normalizeIdentifier(
      config.scope?.assistantId,
      "assistantId",
    ),

    knowledgeBaseId:
      normalizeIdentifier(
        config.scope?.knowledgeBaseId,
        "knowledgeBaseId",
      ),
  });

  const source =
    createGanoKnowledgeCandidateSource({
      repository:
        config.repository,

      processor:
        config.processor,
    });

  const retriever = createRetriever({
    source,

    defaultLimit:
      normalizeLimit(
        config.defaultLimit,
      ),

    defaultMinimumScore:
      normalizeMinimumScore(
        config.defaultMinimumScore,
      ),
  });

  const conversationRetriever =
    createConversationKnowledgeRetrieverAdapter(
      retriever,
      scope,
    );

  return Object.freeze({
    retriever,
    conversationRetriever,
    scope,
  });
}

export default createGanoKnowledgeRuntime;