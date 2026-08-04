/**
 * @package @gano-bot/ai-core
 * @file responseValidator.ts
 * @version 0.2.0
 *
 * Validador central de respuestas para GANO_BOT.
 *
 * Responsabilidades:
 * - Verificar que una respuesta tenga contenido válido.
 * - Aplicar límites mínimos y máximos de longitud.
 * - Detectar términos prohibidos.
 * - Validar citas cuando sean obligatorias.
 * - Sanitizar contenido potencialmente inseguro.
 * - Detectar afirmaciones médicas y financieras de alto riesgo.
 * - Detectar exposición accidental de instrucciones internas.
 * - Ejecutar reglas de validación personalizadas.
 * - Producir advertencias y errores estructurados.
 *
 * Este módulo:
 * - No genera respuestas.
 * - No llama a modelos de lenguaje.
 * - No depende de React, Firebase ni Firestore.
 * - No modifica la respuesta original del proveedor.
 */

import type {
  AICitation,
  AIContext,
  AIIdentifier,
  AIIntentDetection,
  AILLMResponse,
  AIMetadata,
  AIMessageContentType,
  AIResponseValidationRequest,
  AIResponseValidationResult,
  AIResponseValidationRules,
  AIResponseValidator,
  AIValidationIssue,
  AIValidationSeverity,
} from "./types.js";

import {
  EMPTY_AI_METADATA,
} from "./types.js";

/* ============================================================================
 * TIPOS PÚBLICOS
 * ========================================================================== */

export type ResponseValidationRuleCategory =
  | "content"
  | "length"
  | "citation"
  | "safety"
  | "privacy"
  | "medical"
  | "financial"
  | "internal"
  | "format"
  | "custom";

export interface ResponseValidationRuleContext {
  readonly response: AILLMResponse;
  readonly originalContent: string;
  readonly currentContent: string;
  readonly context?: AIContext;
  readonly intent?: AIIntentDetection;
  readonly citations: readonly AICitation[];
  readonly rules: AIResponseValidationRules;
}

export interface ResponseValidationRuleResult {
  readonly issues?: readonly AIValidationIssue[];
  readonly sanitizedContent?: string;
  readonly citations?: readonly AICitation[];
  readonly metadata?: AIMetadata;
}

export interface ResponseValidationRule {
  readonly id: AIIdentifier;
  readonly category: ResponseValidationRuleCategory;
  readonly description?: string;
  readonly priority?: number;
  readonly enabled?: boolean;

  validate(
    context: ResponseValidationRuleContext,
  ): Promise<ResponseValidationRuleResult> | ResponseValidationRuleResult;
}

export interface ResponseValidatorConfig {
  /**
   * Reglas predeterminadas aplicadas a todas las respuestas.
   */
  readonly defaultRules?: AIResponseValidationRules;

  /**
   * Reglas personalizadas adicionales.
   */
  readonly customRules?: readonly ResponseValidationRule[];

  /**
   * Sustituye reglas personalizadas registradas con el mismo ID.
   */
  readonly replaceRulesWithSameId?: boolean;

  /**
   * Elimina etiquetas HTML potencialmente peligrosas.
   */
  readonly sanitizeHtml?: boolean;

  /**
   * Elimina bloques que aparenten revelar prompts internos.
   */
  readonly sanitizeInternalInstructions?: boolean;

  /**
   * Detecta afirmaciones médicas absolutas.
   */
  readonly detectMedicalClaims?: boolean;

  /**
   * Detecta promesas financieras absolutas.
   */
  readonly detectFinancialClaims?: boolean;

  /**
   * Detecta posibles datos sensibles.
   */
  readonly detectSensitiveData?: boolean;

  /**
   * Rechaza contenido compuesto únicamente por espacios.
   */
  readonly rejectWhitespaceOnly?: boolean;

  /**
   * Conserva únicamente citas únicas.
   */
  readonly deduplicateCitations?: boolean;

  /**
   * Elimina citas sin datos mínimos válidos.
   */
  readonly removeInvalidCitations?: boolean;

  /**
   * Severidad usada cuando faltan citas obligatorias.
   */
  readonly missingCitationSeverity?: AIValidationSeverity;

  /**
   * Severidad usada ante términos prohibidos.
   */
  readonly forbiddenTermSeverity?: AIValidationSeverity;

  /**
   * Función personalizada para normalizar texto.
   */
  readonly normalizeContent?: (
    content: string,
  ) => string;
}

export interface CreateValidationIssueInput {
  readonly code: string;
  readonly message: string;
  readonly severity: AIValidationSeverity;
  readonly path?: string;
  readonly metadata?: AIMetadata;
}

export interface ResponseValidationStatistics {
  readonly originalLength: number;
  readonly sanitizedLength: number;
  readonly issueCount: number;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly informationCount: number;
  readonly originalCitationCount: number;
  readonly finalCitationCount: number;
  readonly customRuleCount: number;
}

/* ============================================================================
 * CONSTANTES
 * ========================================================================== */

export const RESPONSE_VALIDATOR_VERSION =
  1 as const;

export const DEFAULT_RESPONSE_MINIMUM_LENGTH =
  1;

export const DEFAULT_RESPONSE_MAXIMUM_LENGTH =
  20_000;

export const DEFAULT_MISSING_CITATION_SEVERITY:
  AIValidationSeverity = "error";

export const DEFAULT_FORBIDDEN_TERM_SEVERITY:
  AIValidationSeverity = "error";

export const DEFAULT_RESPONSE_VALIDATION_RULES =
  Object.freeze({
    requireContent: true,
    requireCitations: false,
    minimumLength:
      DEFAULT_RESPONSE_MINIMUM_LENGTH,
    maximumLength:
      DEFAULT_RESPONSE_MAXIMUM_LENGTH,
    allowedContentTypes:
      Object.freeze([
        "text",
        "markdown",
        "json",
      ] satisfies AIMessageContentType[]),
    forbiddenTerms:
      Object.freeze(
        [] as string[],
      ),
  }) satisfies AIResponseValidationRules;

const VALID_CONTENT_TYPES:
  readonly AIMessageContentType[] =
  Object.freeze([
    "text",
    "markdown",
    "json",
  ]);

const INTERNAL_INSTRUCTION_PATTERNS:
  ReadonlyArray<RegExp> = Object.freeze([
    /(?:system\s+prompt|prompt\s+del\s+sistema)\s*:/gi,
    /(?:developer\s+message|mensaje\s+del\s+desarrollador)\s*:/gi,
    /(?:instrucciones\s+internas|internal\s+instructions)\s*:/gi,
    /(?:cadena\s+de\s+pensamiento|chain\s+of\s+thought)\s*:/gi,
    /(?:razonamiento\s+oculto|hidden\s+reasoning)\s*:/gi,
  ]);

const MEDICAL_ABSOLUTE_CLAIM_PATTERNS:
  ReadonlyArray<RegExp> = Object.freeze([
    /\b(?:cura|curara|curará|elimina|eliminara|eliminará)\b.{0,60}\b(?:cancer|cáncer|diabetes|tumor|enfermedad|patologia|patología)\b/gi,
    /\b(?:garantiza|garantizado|garantizada)\b.{0,60}\b(?:salud|curacion|curación|recuperacion|recuperación)\b/gi,
    /\b(?:reemplaza|sustituye)\b.{0,60}\b(?:medicamento|tratamiento|medico|médico|doctor)\b/gi,
    /\b(?:no necesitas|no requiere)\b.{0,40}\b(?:medico|médico|doctor|tratamiento)\b/gi,
  ]);

const FINANCIAL_ABSOLUTE_CLAIM_PATTERNS:
  ReadonlyArray<RegExp> = Object.freeze([
    /\b(?:ganaras|ganarás|recibiras|recibirás|obtendras|obtendrás)\b.{0,50}\b(?:seguro|garantizado|garantizada)\b/gi,
    /\b(?:ingreso|ganancia|comision|comisión)\b.{0,50}\b(?:garantizado|garantizada|seguro|segura)\b/gi,
    /\b(?:sin riesgo|riesgo cero)\b/gi,
    /\b(?:te haras|te harás)\b.{0,30}\b(?:rico|rica|millonario|millonaria)\b/gi,
  ]);

const SENSITIVE_DATA_PATTERNS:
  ReadonlyArray<{
    readonly code: string;
    readonly pattern: RegExp;
    readonly description: string;
  }> = Object.freeze([
    {
      code: "POSSIBLE_CREDIT_CARD",
      pattern:
        /\b(?:\d[ -]*?){13,19}\b/g,
      description:
        "La respuesta puede contener un número de tarjeta.",
    },
    {
      code: "POSSIBLE_PASSWORD",
      pattern:
        /\b(?:password|contraseña|clave)\s*[:=]\s*\S+/gi,
      description:
        "La respuesta puede exponer una contraseña o clave.",
    },
    {
      code: "POSSIBLE_API_KEY",
      pattern:
        /\b(?:api[_ -]?key|secret[_ -]?key|token)\s*[:=]\s*[A-Za-z0-9_\-]{16,}\b/gi,
      description:
        "La respuesta puede exponer una credencial técnica.",
    },
  ]);

/* ============================================================================
 * UTILIDADES INTERNAS
 * ========================================================================== */

function normalizeText(
  content: string,
): string {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeNonNegativeInteger(
  value: number | undefined,
  fallback: number,
): number {
  if (
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return fallback;
  }

  return Math.max(
    0,
    Math.floor(value),
  );
}

function freezeMetadata(
  metadata?: AIMetadata,
): AIMetadata {
  if (metadata === undefined) {
    return EMPTY_AI_METADATA;
  }

  return Object.freeze({
    ...metadata,
  });
}

function freezeCitation(
  citation: AICitation,
): AICitation {
  const frozen: AICitation = {
    id: citation.id,
    type: citation.type,
    title: citation.title,
    sourceId: citation.sourceId,
    ...(citation.uri !== undefined
      ? {
          uri: citation.uri,
        }
      : {}),
    ...(citation.excerpt !== undefined
      ? {
          excerpt: citation.excerpt,
        }
      : {}),
    ...(citation.location !== undefined
      ? {
          location:
            Object.freeze({
              ...citation.location,
            }),
        }
      : {}),
    ...(citation.score !== undefined
      ? {
          score: citation.score,
        }
      : {}),
    ...(citation.metadata !== undefined
      ? {
          metadata:
            freezeMetadata(
              citation.metadata,
            ),
        }
      : {}),
  };

  return Object.freeze(frozen);
}

function freezeCitations(
  citations: readonly AICitation[],
): readonly AICitation[] {
  return Object.freeze(
    citations.map(freezeCitation),
  );
}

function freezeValidationIssue(
  issue: AIValidationIssue,
): AIValidationIssue {
  const frozen: AIValidationIssue = {
    code: issue.code,
    message: issue.message,
    severity: issue.severity,
    ...(issue.path !== undefined
      ? {
          path: issue.path,
        }
      : {}),
    ...(issue.metadata !== undefined
      ? {
          metadata:
            freezeMetadata(
              issue.metadata,
            ),
        }
      : {}),
  };

  return Object.freeze(frozen);
}

function freezeValidationIssues(
  issues: readonly AIValidationIssue[],
): readonly AIValidationIssue[] {
  return Object.freeze(
    issues.map(
      freezeValidationIssue,
    ),
  );
}

function mergeValidationRules(
  base: AIResponseValidationRules,
  incoming:
    AIResponseValidationRules | undefined,
): AIResponseValidationRules {
  const allowedContentTypes =
    incoming?.allowedContentTypes ??
    base.allowedContentTypes;

  const forbiddenTerms =
    Object.freeze([
      ...new Set([
        ...(base.forbiddenTerms ?? []),
        ...(incoming?.forbiddenTerms ??
          []),
      ]),
    ]);

  return Object.freeze({
    requireContent:
      incoming?.requireContent ??
      base.requireContent ??
      true,
    requireCitations:
      incoming?.requireCitations ??
      base.requireCitations ??
      false,
    minimumLength:
      incoming?.minimumLength ??
      base.minimumLength ??
      DEFAULT_RESPONSE_MINIMUM_LENGTH,
    maximumLength:
      incoming?.maximumLength ??
      base.maximumLength ??
      DEFAULT_RESPONSE_MAXIMUM_LENGTH,
    ...(allowedContentTypes !==
    undefined
      ? {
          allowedContentTypes:
            Object.freeze([
              ...allowedContentTypes,
            ]),
        }
      : {}),
    forbiddenTerms,
  });
}

function sanitizeDangerousHtml(
  content: string,
): string {
  return content
    .replace(
      /<script\b[^>]*>[\s\S]*?<\/script>/gi,
      "",
    )
    .replace(
      /<style\b[^>]*>[\s\S]*?<\/style>/gi,
      "",
    )
    .replace(
      /<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi,
      "",
    )
    .replace(
      /<object\b[^>]*>[\s\S]*?<\/object>/gi,
      "",
    )
    .replace(
      /<embed\b[^>]*\/?>/gi,
      "",
    )
    .replace(
      /\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
      "",
    )
    .replace(
      /\s(?:href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\1/gi,
      "",
    );
}

function redactInternalInstructions(
  content: string,
): {
  readonly content: string;
  readonly detected: boolean;
} {
  let sanitized =
    content;

  let detected =
    false;

  for (
    const pattern of
    INTERNAL_INSTRUCTION_PATTERNS
  ) {
    const expression =
      new RegExp(
        pattern.source,
        pattern.flags,
      );

    if (expression.test(sanitized)) {
      detected = true;

      sanitized =
        sanitized.replace(
          expression,
          "[Instrucción interna omitida]:",
        );
    }
  }

  return {
    content: sanitized,
    detected,
  };
}

function redactSensitiveData(
  content: string,
): {
  readonly content: string;
  readonly issues: readonly AIValidationIssue[];
} {
  let sanitized =
    content;

  const issues:
    AIValidationIssue[] = [];

  for (
    const definition of
    SENSITIVE_DATA_PATTERNS
  ) {
    const expression =
      new RegExp(
        definition.pattern.source,
        definition.pattern.flags,
      );

    if (!expression.test(sanitized)) {
      continue;
    }

    issues.push(
      createValidationIssue({
        code: definition.code,
        message:
          definition.description,
        severity: "error",
        path: "response.content",
      }),
    );

    const replacementExpression =
      new RegExp(
        definition.pattern.source,
        definition.pattern.flags,
      );

    sanitized =
      sanitized.replace(
        replacementExpression,
        "[DATO SENSIBLE OMITIDO]",
      );
  }

  return {
    content: sanitized,
    issues:
      freezeValidationIssues(
        issues,
      ),
  };
}

function detectPatterns(
  content: string,
  patterns: readonly RegExp[],
): boolean {
  return patterns.some(
    (pattern) => {
      const expression =
        new RegExp(
          pattern.source,
          pattern.flags,
        );

      return expression.test(
        content,
      );
    },
  );
}

function isValidCitation(
  citation: AICitation,
): boolean {
  return (
    citation.id.trim().length > 0 &&
    citation.sourceId.trim().length >
      0 &&
    citation.title.trim().length >
      0
  );
}

function deduplicateCitations(
  citations: readonly AICitation[],
): readonly AICitation[] {
  const unique =
    new Map<
      string,
      AICitation
    >();

  for (const citation of citations) {
    const key =
      `${citation.type}:${citation.sourceId}:${citation.id}`;

    if (!unique.has(key)) {
      unique.set(
        key,
        citation,
      );
    }
  }

  return freezeCitations([
    ...unique.values(),
  ]);
}

function sortCustomRules(
  rules:
    readonly ResponseValidationRule[],
): readonly ResponseValidationRule[] {
  return Object.freeze(
    [...rules].sort(
      (
        left,
        right,
      ) => {
        const priorityDifference =
          (right.priority ?? 0) -
          (left.priority ?? 0);

        if (
          priorityDifference !== 0
        ) {
          return priorityDifference;
        }

        return left.id.localeCompare(
          right.id,
        );
      },
    ),
  );
}

function countIssuesBySeverity(
  issues: readonly AIValidationIssue[],
  severity: AIValidationSeverity,
): number {
  return issues.filter(
    (issue) =>
      issue.severity === severity,
  ).length;
}

function containsForbiddenTerm(
  content: string,
  term: string,
): boolean {
  const normalizedTerm =
    term.trim();

  if (
    normalizedTerm.length === 0
  ) {
    return false;
  }

  return content
    .toLocaleLowerCase()
    .includes(
      normalizedTerm.toLocaleLowerCase(),
    );
}

function removeForbiddenTerm(
  content: string,
  term: string,
): string {
  const normalizedTerm =
    term.trim();

  if (
    normalizedTerm.length === 0
  ) {
    return content;
  }

  const escaped =
    normalizedTerm.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );

  return content.replace(
    new RegExp(
      escaped,
      "gi",
    ),
    "[CONTENIDO OMITIDO]",
  );
}

/* ============================================================================
 * CREACIÓN DE INCIDENCIAS
 * ========================================================================== */

export function createValidationIssue(
  input: CreateValidationIssueInput,
): AIValidationIssue {
  const code =
    input.code.trim();

  const message =
    input.message.trim();

  if (code.length === 0) {
    throw new Error(
      "Una incidencia de validación necesita un código.",
    );
  }

  if (message.length === 0) {
    throw new Error(
      "Una incidencia de validación necesita un mensaje.",
    );
  }

  return freezeValidationIssue({
    code,
    message,
    severity:
      input.severity,
    ...(input.path !== undefined
      ? {
          path:
            input.path,
        }
      : {}),
    ...(input.metadata !== undefined
      ? {
          metadata:
            input.metadata,
        }
      : {}),
  });
}

/* ============================================================================
 * VALIDADOR PRINCIPAL
 * ========================================================================== */

export class DefaultResponseValidator
  implements AIResponseValidator
{
  private readonly defaultRules:
    AIResponseValidationRules;

  private readonly customRules:
    readonly ResponseValidationRule[];

  private readonly sanitizeHtml:
    boolean;

  private readonly sanitizeInternalInstructions:
    boolean;

  private readonly detectMedicalClaims:
    boolean;

  private readonly detectFinancialClaims:
    boolean;

  private readonly detectSensitiveData:
    boolean;

  private readonly rejectWhitespaceOnly:
    boolean;

  private readonly shouldDeduplicateCitations:
    boolean;

  private readonly removeInvalidCitations:
    boolean;

  private readonly missingCitationSeverity:
    AIValidationSeverity;

  private readonly forbiddenTermSeverity:
    AIValidationSeverity;

  private readonly normalizeContent:
    (
      content: string,
    ) => string;

  public constructor(
    config: ResponseValidatorConfig = {},
  ) {
    this.defaultRules =
      mergeValidationRules(
        DEFAULT_RESPONSE_VALIDATION_RULES,
        config.defaultRules,
      );

    this.customRules =
      this.mergeCustomRules(
        config.customRules ?? [],
        config.replaceRulesWithSameId ??
          true,
      );

    this.sanitizeHtml =
      config.sanitizeHtml ??
      true;

    this.sanitizeInternalInstructions =
      config.sanitizeInternalInstructions ??
      true;

    this.detectMedicalClaims =
      config.detectMedicalClaims ??
      true;

    this.detectFinancialClaims =
      config.detectFinancialClaims ??
      true;

    this.detectSensitiveData =
      config.detectSensitiveData ??
      true;

    this.rejectWhitespaceOnly =
      config.rejectWhitespaceOnly ??
      true;

    this.shouldDeduplicateCitations =
      config.deduplicateCitations ??
      true;

    this.removeInvalidCitations =
      config.removeInvalidCitations ??
      true;

    this.missingCitationSeverity =
      config.missingCitationSeverity ??
      DEFAULT_MISSING_CITATION_SEVERITY;

    this.forbiddenTermSeverity =
      config.forbiddenTermSeverity ??
      DEFAULT_FORBIDDEN_TERM_SEVERITY;

    this.normalizeContent =
      config.normalizeContent ??
      normalizeText;
  }

  public async validate(
    request: AIResponseValidationRequest,
  ): Promise<AIResponseValidationResult> {
    const rules =
      mergeValidationRules(
        this.defaultRules,
        request.rules,
      );

    const originalContent =
      request.response.content;

    let sanitizedContent =
      this.normalizeContent(
        originalContent,
      );

    const issues:
      AIValidationIssue[] = [];

    let citations =
      freezeCitations(
        request.citations ?? [],
      );

    if (this.sanitizeHtml) {
      const sanitizedHtml =
        sanitizeDangerousHtml(
          sanitizedContent,
        );

      if (
        sanitizedHtml !==
        sanitizedContent
      ) {
        issues.push(
          createValidationIssue({
            code:
              "UNSAFE_HTML_REMOVED",
            message:
              "Se eliminó contenido HTML potencialmente inseguro.",
            severity: "warning",
            path:
              "response.content",
          }),
        );

        sanitizedContent =
          sanitizedHtml;
      }
    }

    if (
      this.sanitizeInternalInstructions
    ) {
      const internalResult =
        redactInternalInstructions(
          sanitizedContent,
        );

      if (internalResult.detected) {
        issues.push(
          createValidationIssue({
            code:
              "INTERNAL_INSTRUCTIONS_DETECTED",
            message:
              "La respuesta parecía exponer instrucciones internas del sistema.",
            severity: "error",
            path:
              "response.content",
          }),
        );

        sanitizedContent =
          internalResult.content;
      }
    }

    if (this.detectSensitiveData) {
      const sensitiveResult =
        redactSensitiveData(
          sanitizedContent,
        );

      sanitizedContent =
        sensitiveResult.content;

      issues.push(
        ...sensitiveResult.issues,
      );
    }

    this.validateContentPresence(
      sanitizedContent,
      rules,
      issues,
    );

    this.validateContentLength(
      sanitizedContent,
      rules,
      issues,
    );

    this.validateContentType(
      request.response,
      rules,
      issues,
    );

    sanitizedContent =
      this.validateForbiddenTerms(
        sanitizedContent,
        rules,
        issues,
      );

    if (
      this.detectMedicalClaims &&
      detectPatterns(
        sanitizedContent,
        MEDICAL_ABSOLUTE_CLAIM_PATTERNS,
      )
    ) {
      issues.push(
        createValidationIssue({
          code:
            "UNSAFE_MEDICAL_CLAIM",
          message:
            "La respuesta contiene una afirmación médica absoluta o no prudente.",
          severity: "error",
          path:
            "response.content",
          metadata: {
            intent:
              request.intent
                ?.primary.name ??
              "unknown",
          },
        }),
      );
    }

    if (
      this.detectFinancialClaims &&
      detectPatterns(
        sanitizedContent,
        FINANCIAL_ABSOLUTE_CLAIM_PATTERNS,
      )
    ) {
      issues.push(
        createValidationIssue({
          code:
            "UNSAFE_FINANCIAL_CLAIM",
          message:
            "La respuesta contiene una promesa financiera o de ingresos no permitida.",
          severity: "error",
          path:
            "response.content",
          metadata: {
            intent:
              request.intent
                ?.primary.name ??
              "unknown",
          },
        }),
      );
    }

    if (
      this.removeInvalidCitations
    ) {
      const validCitations =
        citations.filter(
          isValidCitation,
        );

      const removedCount =
        citations.length -
        validCitations.length;

      if (removedCount > 0) {
        issues.push(
          createValidationIssue({
            code:
              "INVALID_CITATIONS_REMOVED",
            message:
              `${removedCount} cita o citas inválidas fueron eliminadas.`,
            severity: "warning",
            path:
              "response.citations",
          }),
        );
      }

      citations =
        freezeCitations(
          validCitations,
        );
    }

    if (
      this.shouldDeduplicateCitations
    ) {
      const originalCount =
        citations.length;

      citations =
        deduplicateCitations(
          citations,
        );

      const duplicateCount =
        originalCount -
        citations.length;

      if (duplicateCount > 0) {
        issues.push(
          createValidationIssue({
            code:
              "DUPLICATE_CITATIONS_REMOVED",
            message:
              `${duplicateCount} cita o citas duplicadas fueron eliminadas.`,
            severity: "info",
            path:
              "response.citations",
          }),
        );
      }
    }

    this.validateCitations(
      citations,
      rules,
      issues,
    );

    for (
      const customRule of
      this.customRules
    ) {
      if (
        customRule.enabled ===
        false
      ) {
        continue;
      }

      try {
        const result =
          await customRule.validate({
            response:
              request.response,
            originalContent,
            currentContent:
              sanitizedContent,
            ...(request.context !==
            undefined
              ? {
                  context:
                    request.context,
                }
              : {}),
            ...(request.intent !==
            undefined
              ? {
                  intent:
                    request.intent,
                }
              : {}),
            citations,
            rules,
          });

        if (
          result.issues !== undefined
        ) {
          issues.push(
            ...result.issues.map(
              freezeValidationIssue,
            ),
          );
        }

        if (
          result.sanitizedContent !==
          undefined
        ) {
          sanitizedContent =
            this.normalizeContent(
              result.sanitizedContent,
            );
        }

        if (
          result.citations !== undefined
        ) {
          citations =
            this.shouldDeduplicateCitations
              ? deduplicateCitations(
                  result.citations,
                )
              : freezeCitations(
                  result.citations,
                );
        }
      } catch (error) {
        issues.push(
          createValidationIssue({
            code:
              "CUSTOM_RULE_FAILED",
            message:
              `La regla personalizada "${customRule.id}" no pudo ejecutarse: ${
                error instanceof Error
                  ? error.message
                  : "Error desconocido."
              }`,
            severity: "error",
            path:
              "validator.customRules",
            metadata: {
              ruleId:
                customRule.id,
              category:
                customRule.category,
            },
          }),
        );
      }
    }

    sanitizedContent =
      this.normalizeContent(
        sanitizedContent,
      );

    /*
     * Se vuelven a verificar presencia y longitud después de que
     * las reglas personalizadas hayan transformado el contenido.
     */
    this.validateFinalContent(
      sanitizedContent,
      rules,
      issues,
    );

    const uniqueIssues =
      this.deduplicateIssues(
        issues,
      );

    const valid =
      !uniqueIssues.some(
        (issue) =>
          issue.severity ===
          "error",
      );

    const statistics:
      ResponseValidationStatistics =
      Object.freeze({
        originalLength:
          originalContent.length,
        sanitizedLength:
          sanitizedContent.length,
        issueCount:
          uniqueIssues.length,
        errorCount:
          countIssuesBySeverity(
            uniqueIssues,
            "error",
          ),
        warningCount:
          countIssuesBySeverity(
            uniqueIssues,
            "warning",
          ),
        informationCount:
          countIssuesBySeverity(
            uniqueIssues,
            "info",
          ),
        originalCitationCount:
          request.citations?.length ??
          0,
        finalCitationCount:
          citations.length,
        customRuleCount:
          this.customRules.length,
      });

    return Object.freeze({
      valid,
      issues:
        freezeValidationIssues(
          uniqueIssues,
        ),
      sanitizedContent,
      citations,
      metadata:
        Object.freeze({
          validator:
            "DefaultResponseValidator",
          validatorVersion:
            RESPONSE_VALIDATOR_VERSION,
          originalLength:
            statistics.originalLength,
          sanitizedLength:
            statistics.sanitizedLength,
          issueCount:
            statistics.issueCount,
          errorCount:
            statistics.errorCount,
          warningCount:
            statistics.warningCount,
          informationCount:
            statistics.informationCount,
          originalCitationCount:
            statistics.originalCitationCount,
          finalCitationCount:
            statistics.finalCitationCount,
          customRuleCount:
            statistics.customRuleCount,
        }),
    });
  }

  private validateContentPresence(
    content: string,
    rules: AIResponseValidationRules,
    issues: AIValidationIssue[],
  ): void {
    if (
      rules.requireContent !== true
    ) {
      return;
    }

    if (
      content.length === 0 ||
      (
        this.rejectWhitespaceOnly &&
        content.trim().length === 0
      )
    ) {
      issues.push(
        createValidationIssue({
          code:
            "EMPTY_RESPONSE",
          message:
            "La respuesta no contiene texto utilizable.",
          severity: "error",
          path:
            "response.content",
        }),
      );
    }
  }

  private validateContentLength(
    content: string,
    rules: AIResponseValidationRules,
    issues: AIValidationIssue[],
  ): void {
    const minimumLength =
      normalizeNonNegativeInteger(
        rules.minimumLength,
        DEFAULT_RESPONSE_MINIMUM_LENGTH,
      );

    const maximumLength =
      normalizeNonNegativeInteger(
        rules.maximumLength,
        DEFAULT_RESPONSE_MAXIMUM_LENGTH,
      );

    if (
      content.length <
      minimumLength
    ) {
      issues.push(
        createValidationIssue({
          code:
            "RESPONSE_TOO_SHORT",
          message:
            `La respuesta tiene ${content.length} caracteres y el mínimo requerido es ${minimumLength}.`,
          severity: "error",
          path:
            "response.content",
          metadata: {
            actualLength:
              content.length,
            minimumLength,
          },
        }),
      );
    }

    if (
      maximumLength > 0 &&
      content.length >
        maximumLength
    ) {
      issues.push(
        createValidationIssue({
          code:
            "RESPONSE_TOO_LONG",
          message:
            `La respuesta tiene ${content.length} caracteres y supera el máximo permitido de ${maximumLength}.`,
          severity: "error",
          path:
            "response.content",
          metadata: {
            actualLength:
              content.length,
            maximumLength,
          },
        }),
      );
    }
  }

  private validateContentType(
    response: AILLMResponse,
    rules: AIResponseValidationRules,
    issues: AIValidationIssue[],
  ): void {
    const contentType =
      response.message.contentType;

    const allowedContentTypes =
      rules.allowedContentTypes ??
      VALID_CONTENT_TYPES;

    if (
      !allowedContentTypes.includes(
        contentType,
      )
    ) {
      issues.push(
        createValidationIssue({
          code:
            "UNSUPPORTED_CONTENT_TYPE",
          message:
            `El tipo de contenido "${contentType}" no está permitido.`,
          severity: "error",
          path:
            "response.message.contentType",
          metadata: {
            contentType,
          },
        }),
      );
    }

    if (
      contentType === "json" &&
      response.content.trim().length >
        0
    ) {
      try {
        JSON.parse(
          response.content,
        );
      } catch {
        issues.push(
          createValidationIssue({
            code:
              "INVALID_JSON_RESPONSE",
            message:
              "La respuesta fue declarada como JSON, pero su contenido no es JSON válido.",
            severity: "error",
            path:
              "response.content",
          }),
        );
      }
    }
  }

  private validateForbiddenTerms(
    content: string,
    rules: AIResponseValidationRules,
    issues: AIValidationIssue[],
  ): string {
    let sanitized =
      content;

    for (
      const term of
      rules.forbiddenTerms ?? []
    ) {
      if (
        !containsForbiddenTerm(
          sanitized,
          term,
        )
      ) {
        continue;
      }

      issues.push(
        createValidationIssue({
          code:
            "FORBIDDEN_TERM_DETECTED",
          message:
            `La respuesta contiene un término prohibido: "${term}".`,
          severity:
            this.forbiddenTermSeverity,
          path:
            "response.content",
          metadata: {
            forbiddenTerm:
              term,
          },
        }),
      );

      sanitized =
        removeForbiddenTerm(
          sanitized,
          term,
        );
    }

    return sanitized;
  }

  private validateCitations(
    citations: readonly AICitation[],
    rules: AIResponseValidationRules,
    issues: AIValidationIssue[],
  ): void {
    if (
      rules.requireCitations !==
      true
    ) {
      return;
    }

    if (citations.length === 0) {
      issues.push(
        createValidationIssue({
          code:
            "MISSING_REQUIRED_CITATIONS",
          message:
            "La respuesta requiere citas, pero no contiene ninguna cita válida.",
          severity:
            this.missingCitationSeverity,
          path:
            "response.citations",
        }),
      );
    }
  }

  private validateFinalContent(
    content: string,
    rules: AIResponseValidationRules,
    issues: AIValidationIssue[],
  ): void {
    if (
      rules.requireContent === true &&
      content.trim().length === 0
    ) {
      issues.push(
        createValidationIssue({
          code:
            "EMPTY_SANITIZED_RESPONSE",
          message:
            "La respuesta quedó vacía después del proceso de sanitización.",
          severity: "error",
          path:
            "response.content",
        }),
      );
    }

    const maximumLength =
      normalizeNonNegativeInteger(
        rules.maximumLength,
        DEFAULT_RESPONSE_MAXIMUM_LENGTH,
      );

    if (
      maximumLength > 0 &&
      content.length >
        maximumLength
    ) {
      issues.push(
        createValidationIssue({
          code:
            "SANITIZED_RESPONSE_TOO_LONG",
          message:
            "La respuesta continúa superando el límite después de la validación.",
          severity: "error",
          path:
            "response.content",
        }),
      );
    }
  }

  private mergeCustomRules(
    customRules:
      readonly ResponseValidationRule[],
    replaceRulesWithSameId:
      boolean,
  ): readonly ResponseValidationRule[] {
    if (!replaceRulesWithSameId) {
      return sortCustomRules(
        customRules,
      );
    }

    const rules =
      new Map<
        AIIdentifier,
        ResponseValidationRule
      >();

    for (
      const rule of
      customRules
    ) {
      rules.set(
        rule.id,
        rule,
      );
    }

    return sortCustomRules([
      ...rules.values(),
    ]);
  }

  private deduplicateIssues(
    issues:
      readonly AIValidationIssue[],
  ): readonly AIValidationIssue[] {
    const unique =
      new Map<
        string,
        AIValidationIssue
      >();

    for (const issue of issues) {
      const key =
        `${issue.code}:${issue.severity}:${issue.path ?? ""}:${issue.message}`;

      if (!unique.has(key)) {
        unique.set(
          key,
          issue,
        );
      }
    }

    return Object.freeze([
      ...unique.values(),
    ]);
  }
}

/* ============================================================================
 * VALIDADOR FUNCIONAL
 * ========================================================================== */

export type FunctionalResponseValidatorHandler =
  (
    request: AIResponseValidationRequest,
  ) => Promise<AIResponseValidationResult>;

export class FunctionalResponseValidator
  implements AIResponseValidator
{
  private readonly handler:
    FunctionalResponseValidatorHandler;

  public constructor(
    handler:
      FunctionalResponseValidatorHandler,
  ) {
    this.handler = handler;
  }

  public async validate(
    request: AIResponseValidationRequest,
  ): Promise<AIResponseValidationResult> {
    const result =
      await this.handler(request);

    return Object.freeze({
      valid:
        result.valid,
      issues:
        freezeValidationIssues(
          result.issues,
        ),
      sanitizedContent:
        result.sanitizedContent,
      citations:
        freezeCitations(
          result.citations,
        ),
      ...(result.metadata !== undefined
        ? {
            metadata:
              freezeMetadata(
                result.metadata,
              ),
          }
        : {}),
    });
  }
}

/* ============================================================================
 * REGLAS PERSONALIZADAS FUNCIONALES
 * ========================================================================== */

export type FunctionalValidationRuleHandler =
  (
    context: ResponseValidationRuleContext,
  ) =>
    | Promise<ResponseValidationRuleResult>
    | ResponseValidationRuleResult;

export interface FunctionalValidationRuleConfig {
  readonly id: AIIdentifier;
  readonly category?: ResponseValidationRuleCategory;
  readonly description?: string;
  readonly priority?: number;
  readonly enabled?: boolean;
  readonly handler: FunctionalValidationRuleHandler;
}

export class FunctionalValidationRule
  implements ResponseValidationRule
{
  public readonly id:
    AIIdentifier;

  public readonly category:
    ResponseValidationRuleCategory;

  public readonly description?:
    string;

  public readonly priority?:
    number;

  public readonly enabled?:
    boolean;

  private readonly handler:
    FunctionalValidationRuleHandler;

  public constructor(
    config:
      FunctionalValidationRuleConfig,
  ) {
    const id =
      config.id.trim();

    if (id.length === 0) {
      throw new Error(
        "Una regla de validación necesita un identificador.",
      );
    }

    this.id = id;

    this.category =
      config.category ??
      "custom";

    this.handler =
      config.handler;

    if (
      config.description !==
      undefined
    ) {
      this.description =
        config.description;
    }

    if (
      config.priority !==
      undefined
    ) {
      this.priority =
        config.priority;
    }

    if (
      config.enabled !== undefined
    ) {
      this.enabled =
        config.enabled;
    }
  }

  public validate(
    context:
      ResponseValidationRuleContext,
  ):
    | Promise<ResponseValidationRuleResult>
    | ResponseValidationRuleResult {
    return this.handler(context);
  }
}

/* ============================================================================
 * UTILIDADES PÚBLICAS
 * ========================================================================== */

export function hasValidationErrors(
  result: AIResponseValidationResult,
): boolean {
  return result.issues.some(
    (issue) =>
      issue.severity ===
      "error",
  );
}

export function hasValidationWarnings(
  result: AIResponseValidationResult,
): boolean {
  return result.issues.some(
    (issue) =>
      issue.severity ===
      "warning",
  );
}

export function findValidationIssues(
  result: AIResponseValidationResult,
  severity?: AIValidationSeverity,
): readonly AIValidationIssue[] {
  if (severity === undefined) {
    return freezeValidationIssues(
      result.issues,
    );
  }

  return freezeValidationIssues(
    result.issues.filter(
      (issue) =>
        issue.severity ===
        severity,
    ),
  );
}

export function getValidationIssue(
  result: AIResponseValidationResult,
  code: string,
): AIValidationIssue | null {
  return (
    result.issues.find(
      (issue) =>
        issue.code === code,
    ) ?? null
  );
}

/**
 * Valida una respuesta mediante una única llamada funcional.
 */
export async function validateResponse(
  request: AIResponseValidationRequest,
  config: ResponseValidatorConfig = {},
): Promise<AIResponseValidationResult> {
  const validator =
    new DefaultResponseValidator(
      config,
    );

  return validator.validate(
    request,
  );
}

/* ============================================================================
 * FACTORÍAS PÚBLICAS
 * ========================================================================== */

export function createDefaultResponseValidator(
  config: ResponseValidatorConfig = {},
): DefaultResponseValidator {
  return new DefaultResponseValidator(
    config,
  );
}

export function createFunctionalResponseValidator(
  handler:
    FunctionalResponseValidatorHandler,
): FunctionalResponseValidator {
  return new FunctionalResponseValidator(
    handler,
  );
}

export function createFunctionalValidationRule(
  config:
    FunctionalValidationRuleConfig,
): FunctionalValidationRule {
  return new FunctionalValidationRule(
    config,
  );
}