
import type {
  GanoBotContext,
  Identifier,
  ISODateString,
} from "@gano-bot/shared";

export const BUSINESS_ENGINE_ADAPTER_VERSION =
  "0.1.0" as const;

/* =========================================================
 * TIPOS GENERALES
 * ======================================================= */

export type BusinessEngineName =
  | "qualification"
  | "rank"
  | "binary"
  | "gen5"
  | "personal-rebate"
  | "bonus"
  | "diagnostic"
  | "opportunity"
  | "recommendation"
  | "copilot";

export type BusinessEngineStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "unavailable";

export type BusinessSeverity =
  | "info"
  | "success"
  | "warning"
  | "critical";

export type BusinessPriority =
  | "low"
  | "medium"
  | "high"
  | "urgent";

export type BinaryLeg =
  | "left"
  | "right";

export type QualificationStatus =
  | "qualified"
  | "not-qualified"
  | "partially-qualified"
  | "unknown";

export type TrendDirection =
  | "up"
  | "down"
  | "stable"
  | "unknown";

export interface BusinessEngineMetadata {
  requestId?: Identifier;
  userId?: Identifier;
  cycleId?: Identifier;

  startedAt?: ISODateString;
  completedAt?: ISODateString;

  durationMs?: number;
  engineVersion?: string;

  context?: GanoBotContext;

  data?: Record<string, unknown>;
}

export interface BusinessEngineRequest {
  userId: Identifier;

  cycleId?: Identifier;
  context?: GanoBotContext;

  metadata?: Record<string, unknown>;
}

export interface BusinessEngineResponse {
  engine: BusinessEngineName;
  status: BusinessEngineStatus;

  metadata?: BusinessEngineMetadata;
}

/* =========================================================
 * MODELO COMERCIAL COMPARTIDO
 * ======================================================= */

export interface VolumeSnapshot {
  personalVolume: number;
  commissionableVolume?: number;

  leftGroupVolume: number;
  rightGroupVolume: number;

  leftBankVolume?: number;
  rightBankVolume?: number;

  totalGroupVolume?: number;
}

export interface DistributorSnapshot {
  userId: Identifier;

  displayName?: string;

  currentRank?: string;
  highestRank?: string;

  packageCode?: string;

  isActive: boolean;
  isQualified?: boolean;

  sponsorId?: Identifier;
  placementParentId?: Identifier;
  placementLeg?: BinaryLeg;

  volume: VolumeSnapshot;

  directAffiliates?: number;
  activeDirectAffiliates?: number;

  enrollmentDate?: ISODateString;

  metadata?: Record<string, unknown>;
}

export interface BusinessRequirement {
  id: Identifier;
  label: string;

  requiredValue: number | string | boolean;
  currentValue: number | string | boolean;

  completed: boolean;

  progress?: number;
  description?: string;

  metadata?: Record<string, unknown>;
}

export interface BusinessAlert {
  id: Identifier;
  title: string;
  message: string;

  severity: BusinessSeverity;
  priority?: BusinessPriority;

  code?: string;
  actionLabel?: string;

  metadata?: Record<string, unknown>;
}

/* =========================================================
 * MOTOR DE CALIFICACIÓN
 * ======================================================= */

export interface QualificationEngineInput
  extends BusinessEngineRequest {
  distributor: DistributorSnapshot;

  requiredPersonalVolume?: number;
  requiredLeftVolume?: number;
  requiredRightVolume?: number;

  requiresActiveStatus?: boolean;

  rules?: Record<string, unknown>;
}

export interface QualificationEngineResult
  extends BusinessEngineResponse {
  engine: "qualification";

  qualificationStatus: QualificationStatus;
  qualified: boolean;

  score?: number;

  requirements: BusinessRequirement[];
  alerts: BusinessAlert[];

  missingRequirements?: BusinessRequirement[];
}

export interface QualificationEngine {
  evaluate(
    input: QualificationEngineInput,
  ): Promise<QualificationEngineResult>;
}

/* =========================================================
 * MOTOR DE RANGOS
 * ======================================================= */

export interface RankDefinition {
  code: string;
  name: string;

  order: number;

  requiredPersonalVolume?: number;
  requiredLeftGroupVolume?: number;
  requiredRightGroupVolume?: number;

  requiredActiveDirects?: number;
  requiredQualifiedLegs?: number;

  metadata?: Record<string, unknown>;
}

export interface RankEngineInput
  extends BusinessEngineRequest {
  distributor: DistributorSnapshot;

  ranks: RankDefinition[];

  targetRankCode?: string;

  rules?: Record<string, unknown>;
}

export interface RankProgress {
  currentRankCode?: string;
  currentRankName?: string;

  nextRankCode?: string;
  nextRankName?: string;

  targetRankCode?: string;
  targetRankName?: string;

  progress: number;

  requirements: BusinessRequirement[];
  missingRequirements: BusinessRequirement[];
}

export interface RankEngineResult
  extends BusinessEngineResponse {
  engine: "rank";

  achievedRankCode?: string;
  achievedRankName?: string;

  previousRankCode?: string;

  promoted: boolean;

  progress: RankProgress;
  alerts: BusinessAlert[];
}

export interface RankEngine {
  evaluate(
    input: RankEngineInput,
  ): Promise<RankEngineResult>;
}

/* =========================================================
 * MOTOR BINARIO
 * ======================================================= */

export interface BinaryEngineInput
  extends BusinessEngineRequest {
  distributor: DistributorSnapshot;

  percentage: number;

  maximumPayout?: number;

  carryForwardEnabled?: boolean;
  resetBanksWhenInactive?: boolean;

  rules?: Record<string, unknown>;
}

export interface BinaryLegSummary {
  leg: BinaryLeg;

  cycleVolume: number;
  bankBefore: number;
  availableVolume: number;

  consumedVolume: number;
  bankAfter: number;
}

export interface BinaryEngineResult
  extends BusinessEngineResponse {
  engine: "binary";

  qualified: boolean;

  weakLeg: BinaryLeg | null;
  strongLeg: BinaryLeg | null;

  payableVolume: number;
  percentage: number;

  grossAmount: number;
  cappedAmount?: number;
  payableAmount: number;

  left: BinaryLegSummary;
  right: BinaryLegSummary;

  alerts: BusinessAlert[];
}

export interface BinaryEngine {
  calculate(
    input: BinaryEngineInput,
  ): Promise<BinaryEngineResult>;
}

/* =========================================================
 * MOTOR GEN5
 * ======================================================= */

export interface GenerationMember {
  userId: Identifier;

  generation: 1 | 2 | 3 | 4 | 5;

  sponsorId?: Identifier;

  packageCode?: string;

  isActive?: boolean;
  isQualified?: boolean;

  enrollmentDate?: ISODateString;

  metadata?: Record<string, unknown>;
}

export interface GenerationRate {
  generation: 1 | 2 | 3 | 4 | 5;

  amount: number;

  packageCode?: string;

  metadata?: Record<string, unknown>;
}

export interface Gen5EngineInput
  extends BusinessEngineRequest {
  distributor: DistributorSnapshot;

  members: GenerationMember[];
  rates: GenerationRate[];

  requiresActiveStatus?: boolean;

  rules?: Record<string, unknown>;
}

export interface Gen5GenerationSummary {
  generation: 1 | 2 | 3 | 4 | 5;

  members: number;
  qualifiedMembers: number;

  rate: number;
  amount: number;
}

export interface Gen5EngineResult
  extends BusinessEngineResponse {
  engine: "gen5";

  qualified: boolean;

  totalMembers: number;
  totalQualifiedMembers: number;

  generations: Gen5GenerationSummary[];

  grossAmount: number;
  payableAmount: number;

  alerts: BusinessAlert[];
}

export interface Gen5Engine {
  calculate(
    input: Gen5EngineInput,
  ): Promise<Gen5EngineResult>;
}

/* =========================================================
 * MOTOR DE REBAJA PERSONAL
 * ======================================================= */

export interface PersonalRebateTier {
  id: Identifier;
  name: string;

  minimumVolume: number;
  maximumVolume?: number;

  percentage: number;

  metadata?: Record<string, unknown>;
}

export interface PersonalRebateEngineInput
  extends BusinessEngineRequest {
  distributor: DistributorSnapshot;

  purchaseAmount?: number;
  personalVolume: number;

  tiers: PersonalRebateTier[];

  requiresActiveStatus?: boolean;

  rules?: Record<string, unknown>;
}

export interface PersonalRebateEngineResult
  extends BusinessEngineResponse {
  engine: "personal-rebate";

  qualified: boolean;

  appliedTier?: PersonalRebateTier;

  baseAmount: number;
  percentage: number;

  grossAmount: number;
  payableAmount: number;

  alerts: BusinessAlert[];
}

export interface PersonalRebateEngine {
  calculate(
    input: PersonalRebateEngineInput,
  ): Promise<PersonalRebateEngineResult>;
}

/* =========================================================
 * MOTOR GENERAL DE BONOS
 * ======================================================= */

export interface BonusComponent {
  id: Identifier;
  code: string;
  name: string;

  qualified: boolean;

  amount: number;

  description?: string;

  metadata?: Record<string, unknown>;
}

export interface BonusEngineInput
  extends BusinessEngineRequest {
  distributor: DistributorSnapshot;

  components?: BonusComponent[];

  binaryResult?: BinaryEngineResult;
  gen5Result?: Gen5EngineResult;
  personalRebateResult?: PersonalRebateEngineResult;

  deductions?: number;

  rules?: Record<string, unknown>;
}

export interface BonusEngineResult
  extends BusinessEngineResponse {
  engine: "bonus";

  components: BonusComponent[];

  grossAmount: number;
  deductions: number;
  netAmount: number;

  alerts: BusinessAlert[];
}

export interface BonusEngine {
  calculate(
    input: BonusEngineInput,
  ): Promise<BonusEngineResult>;
}

/* =========================================================
 * MOTOR DE DIAGNÓSTICO
 * ======================================================= */

export interface DiagnosticMetric {
  id: Identifier;
  name: string;

  value: number | string | boolean;
  expectedValue?: number | string | boolean;

  status:
    | "healthy"
    | "attention"
    | "critical"
    | "unknown";

  trend?: TrendDirection;

  description?: string;

  metadata?: Record<string, unknown>;
}

export interface DiagnosticFinding {
  id: Identifier;
  title: string;
  description: string;

  severity: BusinessSeverity;
  priority: BusinessPriority;

  category?: string;

  evidence?: string[];
  suggestedAction?: string;

  metadata?: Record<string, unknown>;
}

export interface DiagnosticEngineInput
  extends BusinessEngineRequest {
  distributor: DistributorSnapshot;

  qualification?: QualificationEngineResult;
  rank?: RankEngineResult;
  binary?: BinaryEngineResult;
  gen5?: Gen5EngineResult;
  bonus?: BonusEngineResult;

  history?: Record<string, unknown>[];

  rules?: Record<string, unknown>;
}

export interface DiagnosticEngineResult
  extends BusinessEngineResponse {
  engine: "diagnostic";

  healthScore: number;

  metrics: DiagnosticMetric[];
  findings: DiagnosticFinding[];
  alerts: BusinessAlert[];
}

export interface DiagnosticEngine {
  analyze(
    input: DiagnosticEngineInput,
  ): Promise<DiagnosticEngineResult>;
}

/* =========================================================
 * MOTOR DE OPORTUNIDADES
 * ======================================================= */

export interface BusinessOpportunity {
  id: Identifier;
  title: string;
  description: string;

  category:
    | "rank"
    | "binary"
    | "activation"
    | "sponsorship"
    | "volume"
    | "retention"
    | "education"
    | "other";

  priority: BusinessPriority;

  estimatedImpact?: number;
  estimatedEffort?: number;

  action?: string;
  deadline?: ISODateString;

  metadata?: Record<string, unknown>;
}

export interface OpportunityEngineInput
  extends BusinessEngineRequest {
  distributor: DistributorSnapshot;

  diagnostic?: DiagnosticEngineResult;
  qualification?: QualificationEngineResult;
  rank?: RankEngineResult;
  binary?: BinaryEngineResult;

  rules?: Record<string, unknown>;
}

export interface OpportunityEngineResult
  extends BusinessEngineResponse {
  engine: "opportunity";

  opportunities: BusinessOpportunity[];

  primaryOpportunity?: BusinessOpportunity;

  alerts: BusinessAlert[];
}

export interface OpportunityEngine {
  identify(
    input: OpportunityEngineInput,
  ): Promise<OpportunityEngineResult>;
}

/* =========================================================
 * MOTOR DE RECOMENDACIONES
 * ======================================================= */

export interface BusinessRecommendation {
  id: Identifier;
  title: string;
  description: string;

  priority: BusinessPriority;

  category?: string;

  reason?: string;
  expectedOutcome?: string;

  actionSteps?: string[];

  relatedOpportunityId?: Identifier;
  deadline?: ISODateString;

  metadata?: Record<string, unknown>;
}

export interface RecommendationEngineInput
  extends BusinessEngineRequest {
  distributor: DistributorSnapshot;

  diagnostic?: DiagnosticEngineResult;
  opportunities?: OpportunityEngineResult;
  rank?: RankEngineResult;

  maximumRecommendations?: number;

  rules?: Record<string, unknown>;
}

export interface RecommendationEngineResult
  extends BusinessEngineResponse {
  engine: "recommendation";

  recommendations: BusinessRecommendation[];

  primaryRecommendation?: BusinessRecommendation;

  alerts: BusinessAlert[];
}

export interface RecommendationEngine {
  generate(
    input: RecommendationEngineInput,
  ): Promise<RecommendationEngineResult>;
}

/* =========================================================
 * MOTOR COPILOTO
 * ======================================================= */

export interface CopilotEngineInput
  extends BusinessEngineRequest {
  distributor: DistributorSnapshot;

  query?: string;

  diagnostic?: DiagnosticEngineResult;
  opportunities?: OpportunityEngineResult;
  recommendations?: RecommendationEngineResult;

  businessData?: Record<string, unknown>;

  rules?: Record<string, unknown>;
}

export interface CopilotInsight {
  id: Identifier;
  title: string;
  message: string;

  priority: BusinessPriority;
  severity?: BusinessSeverity;

  action?: string;

  metadata?: Record<string, unknown>;
}

export interface CopilotEngineResult
  extends BusinessEngineResponse {
  engine: "copilot";

  summary: string;

  insights: CopilotInsight[];

  suggestedQuestions?: string[];
  suggestedActions?: string[];

  alerts: BusinessAlert[];
}

export interface CopilotEngine {
  generate(
    input: CopilotEngineInput,
  ): Promise<CopilotEngineResult>;
}

/* =========================================================
 * REGISTRO DE MOTORES
 * ======================================================= */

export interface BusinessEngineRegistry {
  qualification?: QualificationEngine;
  rank?: RankEngine;
  binary?: BinaryEngine;
  gen5?: Gen5Engine;
  personalRebate?: PersonalRebateEngine;
  bonus?: BonusEngine;
  diagnostic?: DiagnosticEngine;
  opportunity?: OpportunityEngine;
  recommendation?: RecommendationEngine;
  copilot?: CopilotEngine;
}

export type RegisteredBusinessEngine =
  | QualificationEngine
  | RankEngine
  | BinaryEngine
  | Gen5Engine
  | PersonalRebateEngine
  | BonusEngine
  | DiagnosticEngine
  | OpportunityEngine
  | RecommendationEngine
  | CopilotEngine;

const businessEngineRegistry: BusinessEngineRegistry = {};

/**
 * Registra uno o varios motores de negocio.
 */
export function registerBusinessEngines(
  engines: BusinessEngineRegistry,
): BusinessEngineRegistry {
  if (engines.qualification !== undefined) {
    businessEngineRegistry.qualification =
      engines.qualification;
  }

  if (engines.rank !== undefined) {
    businessEngineRegistry.rank =
      engines.rank;
  }

  if (engines.binary !== undefined) {
    businessEngineRegistry.binary =
      engines.binary;
  }

  if (engines.gen5 !== undefined) {
    businessEngineRegistry.gen5 =
      engines.gen5;
  }

  if (engines.personalRebate !== undefined) {
    businessEngineRegistry.personalRebate =
      engines.personalRebate;
  }

  if (engines.bonus !== undefined) {
    businessEngineRegistry.bonus =
      engines.bonus;
  }

  if (engines.diagnostic !== undefined) {
    businessEngineRegistry.diagnostic =
      engines.diagnostic;
  }

  if (engines.opportunity !== undefined) {
    businessEngineRegistry.opportunity =
      engines.opportunity;
  }

  if (engines.recommendation !== undefined) {
    businessEngineRegistry.recommendation =
      engines.recommendation;
  }

  if (engines.copilot !== undefined) {
    businessEngineRegistry.copilot =
      engines.copilot;
  }

  return getBusinessEngineRegistry();
}

/**
 * Devuelve una copia del registro actual.
 */
export function getBusinessEngineRegistry():
  BusinessEngineRegistry {
  return {
    ...businessEngineRegistry,
  };
}

/**
 * Elimina todos los motores registrados.
 *
 * Resulta útil para pruebas y reinicializaciones.
 */
export function clearBusinessEngineRegistry(): void {
  delete businessEngineRegistry.qualification;
  delete businessEngineRegistry.rank;
  delete businessEngineRegistry.binary;
  delete businessEngineRegistry.gen5;
  delete businessEngineRegistry.personalRebate;
  delete businessEngineRegistry.bonus;
  delete businessEngineRegistry.diagnostic;
  delete businessEngineRegistry.opportunity;
  delete businessEngineRegistry.recommendation;
  delete businessEngineRegistry.copilot;
}

/**
 * Comprueba si un motor concreto está registrado.
 */
export function hasBusinessEngine(
  engineName: BusinessEngineName,
): boolean {
  switch (engineName) {
    case "qualification":
      return (
        businessEngineRegistry.qualification !==
        undefined
      );

    case "rank":
      return (
        businessEngineRegistry.rank !== undefined
      );

    case "binary":
      return (
        businessEngineRegistry.binary !== undefined
      );

    case "gen5":
      return (
        businessEngineRegistry.gen5 !== undefined
      );

    case "personal-rebate":
      return (
        businessEngineRegistry.personalRebate !==
        undefined
      );

    case "bonus":
      return (
        businessEngineRegistry.bonus !== undefined
      );

    case "diagnostic":
      return (
        businessEngineRegistry.diagnostic !==
        undefined
      );

    case "opportunity":
      return (
        businessEngineRegistry.opportunity !==
        undefined
      );

    case "recommendation":
      return (
        businessEngineRegistry.recommendation !==
        undefined
      );

    case "copilot":
      return (
        businessEngineRegistry.copilot !==
        undefined
      );

    default:
      return assertUnreachableEngine(engineName);
  }
}

/* =========================================================
 * OBTENCIÓN SEGURA DE MOTORES
 * ======================================================= */

export function requireQualificationEngine():
  QualificationEngine {
  const engine =
    businessEngineRegistry.qualification;

  if (engine === undefined) {
    throw new BusinessEngineNotRegisteredError(
      "qualification",
    );
  }

  return engine;
}

export function requireRankEngine(): RankEngine {
  const engine = businessEngineRegistry.rank;

  if (engine === undefined) {
    throw new BusinessEngineNotRegisteredError(
      "rank",
    );
  }

  return engine;
}

export function requireBinaryEngine():
  BinaryEngine {
  const engine = businessEngineRegistry.binary;

  if (engine === undefined) {
    throw new BusinessEngineNotRegisteredError(
      "binary",
    );
  }

  return engine;
}

export function requireGen5Engine(): Gen5Engine {
  const engine = businessEngineRegistry.gen5;

  if (engine === undefined) {
    throw new BusinessEngineNotRegisteredError(
      "gen5",
    );
  }

  return engine;
}

export function requirePersonalRebateEngine():
  PersonalRebateEngine {
  const engine =
    businessEngineRegistry.personalRebate;

  if (engine === undefined) {
    throw new BusinessEngineNotRegisteredError(
      "personal-rebate",
    );
  }

  return engine;
}

export function requireBonusEngine(): BonusEngine {
  const engine = businessEngineRegistry.bonus;

  if (engine === undefined) {
    throw new BusinessEngineNotRegisteredError(
      "bonus",
    );
  }

  return engine;
}

export function requireDiagnosticEngine():
  DiagnosticEngine {
  const engine =
    businessEngineRegistry.diagnostic;

  if (engine === undefined) {
    throw new BusinessEngineNotRegisteredError(
      "diagnostic",
    );
  }

  return engine;
}

export function requireOpportunityEngine():
  OpportunityEngine {
  const engine =
    businessEngineRegistry.opportunity;

  if (engine === undefined) {
    throw new BusinessEngineNotRegisteredError(
      "opportunity",
    );
  }

  return engine;
}

export function requireRecommendationEngine():
  RecommendationEngine {
  const engine =
    businessEngineRegistry.recommendation;

  if (engine === undefined) {
    throw new BusinessEngineNotRegisteredError(
      "recommendation",
    );
  }

  return engine;
}

export function requireCopilotEngine():
  CopilotEngine {
  const engine = businessEngineRegistry.copilot;

  if (engine === undefined) {
    throw new BusinessEngineNotRegisteredError(
      "copilot",
    );
  }

  return engine;
}

/* =========================================================
 * ERRORES
 * ======================================================= */

export type BusinessEngineErrorCode =
  | "BUSINESS_ENGINE_ERROR"
  | "BUSINESS_ENGINE_NOT_REGISTERED"
  | "BUSINESS_ENGINE_EXECUTION_FAILED"
  | "INVALID_BUSINESS_ENGINE_INPUT";

export class BusinessEngineError extends Error {
  public readonly code: BusinessEngineErrorCode =
    "BUSINESS_ENGINE_ERROR";

  public constructor(
    message: string,
    public readonly engineName?: BusinessEngineName,
    public override readonly cause?: unknown,
  ) {
    super(message, {
      cause,
    });

    this.name = "BusinessEngineError";
  }
}

export class BusinessEngineNotRegisteredError
  extends BusinessEngineError {
  public override readonly code =
    "BUSINESS_ENGINE_NOT_REGISTERED";

  public constructor(
    engineName: BusinessEngineName,
  ) {
    super(
      `El motor de negocio "${engineName}" no está registrado.`,
      engineName,
    );

    this.name =
      "BusinessEngineNotRegisteredError";
  }
}

export class BusinessEngineExecutionError
  extends BusinessEngineError {
  public override readonly code =
    "BUSINESS_ENGINE_EXECUTION_FAILED";

  public constructor(
    engineName: BusinessEngineName,
    cause?: unknown,
  ) {
    super(
      `El motor de negocio "${engineName}" no pudo completar la operación.`,
      engineName,
      cause,
    );

    this.name =
      "BusinessEngineExecutionError";
  }
}

export class InvalidBusinessEngineInputError
  extends BusinessEngineError {
  public override readonly code =
    "INVALID_BUSINESS_ENGINE_INPUT";

  public constructor(
    engineName: BusinessEngineName,
    message: string,
    cause?: unknown,
  ) {
    super(
      message,
      engineName,
      cause,
    );

    this.name =
      "InvalidBusinessEngineInputError";
  }
}

/* =========================================================
 * EJECUCIÓN SEGURA
 * ======================================================= */

export async function executeQualificationEngine(
  input: QualificationEngineInput,
): Promise<QualificationEngineResult> {
  try {
    return await requireQualificationEngine()
      .evaluate(input);
  } catch (error) {
    if (error instanceof BusinessEngineError) {
      throw error;
    }

    throw new BusinessEngineExecutionError(
      "qualification",
      error,
    );
  }
}

export async function executeRankEngine(
  input: RankEngineInput,
): Promise<RankEngineResult> {
  try {
    return await requireRankEngine()
      .evaluate(input);
  } catch (error) {
    if (error instanceof BusinessEngineError) {
      throw error;
    }

    throw new BusinessEngineExecutionError(
      "rank",
      error,
    );
  }
}

export async function executeBinaryEngine(
  input: BinaryEngineInput,
): Promise<BinaryEngineResult> {
  try {
    return await requireBinaryEngine()
      .calculate(input);
  } catch (error) {
    if (error instanceof BusinessEngineError) {
      throw error;
    }

    throw new BusinessEngineExecutionError(
      "binary",
      error,
    );
  }
}

export async function executeGen5Engine(
  input: Gen5EngineInput,
): Promise<Gen5EngineResult> {
  try {
    return await requireGen5Engine()
      .calculate(input);
  } catch (error) {
    if (error instanceof BusinessEngineError) {
      throw error;
    }

    throw new BusinessEngineExecutionError(
      "gen5",
      error,
    );
  }
}

export async function executePersonalRebateEngine(
  input: PersonalRebateEngineInput,
): Promise<PersonalRebateEngineResult> {
  try {
    return await requirePersonalRebateEngine()
      .calculate(input);
  } catch (error) {
    if (error instanceof BusinessEngineError) {
      throw error;
    }

    throw new BusinessEngineExecutionError(
      "personal-rebate",
      error,
    );
  }
}

export async function executeBonusEngine(
  input: BonusEngineInput,
): Promise<BonusEngineResult> {
  try {
    return await requireBonusEngine()
      .calculate(input);
  } catch (error) {
    if (error instanceof BusinessEngineError) {
      throw error;
    }

    throw new BusinessEngineExecutionError(
      "bonus",
      error,
    );
  }
}

export async function executeDiagnosticEngine(
  input: DiagnosticEngineInput,
): Promise<DiagnosticEngineResult> {
  try {
    return await requireDiagnosticEngine()
      .analyze(input);
  } catch (error) {
    if (error instanceof BusinessEngineError) {
      throw error;
    }

    throw new BusinessEngineExecutionError(
      "diagnostic",
      error,
    );
  }
}

export async function executeOpportunityEngine(
  input: OpportunityEngineInput,
): Promise<OpportunityEngineResult> {
  try {
    return await requireOpportunityEngine()
      .identify(input);
  } catch (error) {
    if (error instanceof BusinessEngineError) {
      throw error;
    }

    throw new BusinessEngineExecutionError(
      "opportunity",
      error,
    );
  }
}

export async function executeRecommendationEngine(
  input: RecommendationEngineInput,
): Promise<RecommendationEngineResult> {
  try {
    return await requireRecommendationEngine()
      .generate(input);
  } catch (error) {
    if (error instanceof BusinessEngineError) {
      throw error;
    }

    throw new BusinessEngineExecutionError(
      "recommendation",
      error,
    );
  }
}

export async function executeCopilotEngine(
  input: CopilotEngineInput,
): Promise<CopilotEngineResult> {
  try {
    return await requireCopilotEngine()
      .generate(input);
  } catch (error) {
    if (error instanceof BusinessEngineError) {
      throw error;
    }

    throw new BusinessEngineExecutionError(
      "copilot",
      error,
    );
  }
}

/* =========================================================
 * UTILIDADES
 * ======================================================= */

/**
 * Normaliza un valor numérico para impedir NaN,
 * Infinity y números negativos inesperados.
 */
export function normalizeBusinessNumber(
  value: number | null | undefined,
  fallback = 0,
): number {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return fallback;
  }

  return Math.max(0, value);
}

/**
 * Normaliza un porcentaje expresado de 0 a 100.
 */
export function normalizePercentage(
  value: number | null | undefined,
  fallback = 0,
): number {
  const normalized =
    normalizeBusinessNumber(
      value,
      fallback,
    );

  return Math.min(100, normalized);
}

/**
 * Convierte un porcentaje de 0 a 100 a su
 * representación decimal.
 */
export function percentageToDecimal(
  percentage: number,
): number {
  return normalizePercentage(percentage) / 100;
}

/**
 * Redondea un valor monetario a dos decimales.
 */
export function roundBusinessAmount(
  value: number,
): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(
    (value + Number.EPSILON) * 100,
  ) / 100;
}

/**
 * Calcula la pierna débil mediante los volúmenes
 * disponibles de cada lado.
 */
export function determineWeakLeg(
  leftVolume: number,
  rightVolume: number,
): BinaryLeg | null {
  const normalizedLeft =
    normalizeBusinessNumber(leftVolume);

  const normalizedRight =
    normalizeBusinessNumber(rightVolume);

  if (normalizedLeft === normalizedRight) {
    return null;
  }

  return normalizedLeft < normalizedRight
    ? "left"
    : "right";
}

/**
 * Calcula la pierna fuerte mediante los volúmenes
 * disponibles de cada lado.
 */
export function determineStrongLeg(
  leftVolume: number,
  rightVolume: number,
): BinaryLeg | null {
  const weakLeg = determineWeakLeg(
    leftVolume,
    rightVolume,
  );

  if (weakLeg === null) {
    return null;
  }

  return weakLeg === "left"
    ? "right"
    : "left";
}

/**
 * Calcula un progreso de 0 a 100.
 */
export function calculateProgress(
  currentValue: number,
  requiredValue: number,
): number {
  const current =
    normalizeBusinessNumber(currentValue);

  const required =
    normalizeBusinessNumber(requiredValue);

  if (required <= 0) {
    return 100;
  }

  return Math.min(
    100,
    Math.max(
      0,
      roundBusinessAmount(
        (current / required) * 100,
      ),
    ),
  );
}

/**
 * Valida los datos mínimos de un distribuidor.
 */
export function validateDistributorSnapshot(
  distributor: DistributorSnapshot,
): void {
  if (distributor.userId.trim().length === 0) {
    throw new InvalidBusinessEngineInputError(
      "qualification",
      "El distribuidor debe contener un identificador válido.",
    );
  }

  const numericValues = [
    distributor.volume.personalVolume,
    distributor.volume.leftGroupVolume,
    distributor.volume.rightGroupVolume,
  ];

  const hasInvalidVolume = numericValues.some(
    (value) => !Number.isFinite(value),
  );

  if (hasInvalidVolume) {
    throw new InvalidBusinessEngineInputError(
      "qualification",
      "Los volúmenes del distribuidor deben ser valores numéricos finitos.",
    );
  }
}

/**
 * Construye una alerta con propiedades opcionales
 * compatibles con exactOptionalPropertyTypes.
 */
export function createBusinessAlert(
  input: {
    id: Identifier;
    title: string;
    message: string;
    severity: BusinessSeverity;
    priority?: BusinessPriority;
    code?: string;
    actionLabel?: string;
    metadata?: Record<string, unknown>;
  },
): BusinessAlert {
  const alert: BusinessAlert = {
    id: input.id,
    title: input.title,
    message: input.message,
    severity: input.severity,
  };

  if (input.priority !== undefined) {
    alert.priority = input.priority;
  }

  if (input.code !== undefined) {
    alert.code = input.code;
  }

  if (input.actionLabel !== undefined) {
    alert.actionLabel = input.actionLabel;
  }

  if (input.metadata !== undefined) {
    alert.metadata = input.metadata;
  }

  return alert;
}

function assertUnreachableEngine(
  value: never,
): never {
  throw new Error(
    `Motor de negocio no contemplado: ${String(value)}`,
  );
}

/* =========================================================
 * REEXPORTACIÓN DE TIPOS COMPARTIDOS
 * ======================================================= */

export type {
  GanoBotContext,
  Identifier,
  ISODateString,
} from "@gano-bot/shared";