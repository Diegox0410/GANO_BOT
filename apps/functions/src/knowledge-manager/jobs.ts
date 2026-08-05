import type {
  KnowledgeManagerPrincipal,
  ManagedDocumentStatus,
} from "@gano-bot/ai-core/knowledge-manager";
import { KnowledgeManagerService } from "@gano-bot/ai-core/knowledge-manager";
import { BackendApiError } from "../errors.js";
export type KnowledgeManagerJobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "partially-completed"
  | "failed"
  | "cancelled";
export interface KnowledgeManagerJobError {
  readonly fileName: string;
  readonly code: string;
  readonly message: string;
}
export interface KnowledgeManagerJob {
  readonly jobId: string;
  readonly tenantId: string;
  readonly knowledgeBaseId: string;
  readonly assistantId: string;
  readonly documentIds: readonly string[];
  readonly status: KnowledgeManagerJobStatus;
  readonly progress: number;
  readonly currentStage: ManagedDocumentStatus;
  readonly processedFiles: number;
  readonly failedFiles: number;
  readonly totalFiles: number;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly durationMilliseconds?: number;
  readonly errors: readonly KnowledgeManagerJobError[];
  readonly warnings: readonly string[];
}
interface MutableJob {
  jobId: string;
  tenantId: string;
  knowledgeBaseId: string;
  assistantId: string;
  documentIds: string[];
  status: KnowledgeManagerJobStatus;
  progress: number;
  currentStage: ManagedDocumentStatus;
  processedFiles: number;
  failedFiles: number;
  totalFiles: number;
  startedAt: string;
  completedAt?: string;
  durationMilliseconds?: number;
  errors: KnowledgeManagerJobError[];
  warnings: string[];
  controller: AbortController;
  files: readonly File[];
}
function view(job: MutableJob): KnowledgeManagerJob {
  return Object.freeze({
    jobId: job.jobId,
    tenantId: job.tenantId,
    knowledgeBaseId: job.knowledgeBaseId,
    assistantId: job.assistantId,
    documentIds: Object.freeze([...job.documentIds]),
    status: job.status,
    progress: job.progress,
    currentStage: job.currentStage,
    processedFiles: job.processedFiles,
    failedFiles: job.failedFiles,
    totalFiles: job.totalFiles,
    startedAt: job.startedAt,
    ...(job.completedAt === undefined ? {} : { completedAt: job.completedAt }),
    ...(job.durationMilliseconds === undefined
      ? {}
      : { durationMilliseconds: job.durationMilliseconds }),
    errors: Object.freeze([...job.errors]),
    warnings: Object.freeze([...job.warnings]),
  });
}
export class KnowledgeManagerJobService {
  private readonly jobs = new Map<string, MutableJob>();
  private sequence = 0;
  public constructor(
    private readonly manager: KnowledgeManagerService,
    private readonly now: () => Date = () => new Date(),
  ) {}
  public list(
    principal: KnowledgeManagerPrincipal,
  ): readonly KnowledgeManagerJob[] {
    return Object.freeze(
      [...this.jobs.values()]
        .filter((job) => job.tenantId === principal.tenantId)
        .map(view),
    );
  }
  public get(
    principal: KnowledgeManagerPrincipal,
    id: string,
  ): KnowledgeManagerJob {
    const job = this.jobs.get(id);
    if (job === undefined || job.tenantId !== principal.tenantId)
      throw new BackendApiError("NOT_FOUND", "Job no encontrado.", 404);
    return view(job);
  }
  public async create(
    principal: KnowledgeManagerPrincipal,
    baseId: string,
    assistantId: string,
    files: readonly File[],
  ): Promise<KnowledgeManagerJob> {
    if (files.length === 0 || files.length > 8)
      throw new BackendApiError(
        "BAD_REQUEST",
        "Debe enviar entre 1 y 8 archivos.",
        400,
      );
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (total > 50 * 1024 * 1024)
      throw new BackendApiError(
        "PAYLOAD_TOO_LARGE",
        "El upload excede 50 MB.",
        413,
      );
    const started = this.now();
    const job: MutableJob = {
      jobId: `km-job-${++this.sequence}`,
      tenantId: principal.tenantId,
      knowledgeBaseId: baseId,
      assistantId,
      documentIds: [],
      status: "processing",
      progress: 0,
      currentStage: "validating",
      processedFiles: 0,
      failedFiles: 0,
      totalFiles: files.length,
      startedAt: started.toISOString(),
      errors: [],
      warnings: [],
      controller: new AbortController(),
      files,
    };
    this.jobs.set(job.jobId, job);
    await this.execute(principal, job);
    return view(job);
  }
  public cancel(
    principal: KnowledgeManagerPrincipal,
    id: string,
  ): KnowledgeManagerJob {
    const job = this.jobs.get(id);
    if (job === undefined || job.tenantId !== principal.tenantId)
      throw new BackendApiError("NOT_FOUND", "Job no encontrado.", 404);
    job.controller.abort();
    job.status = "cancelled";
    job.currentStage = "cancelled";
    job.completedAt = this.now().toISOString();
    return view(job);
  }
  public async retry(
    principal: KnowledgeManagerPrincipal,
    id: string,
  ): Promise<KnowledgeManagerJob> {
    const prior = this.jobs.get(id);
    if (prior === undefined || prior.tenantId !== principal.tenantId)
      throw new BackendApiError("NOT_FOUND", "Job no encontrado.", 404);
    return this.create(
      principal,
      prior.knowledgeBaseId,
      prior.assistantId,
      prior.files,
    );
  }
  private async execute(
    principal: KnowledgeManagerPrincipal,
    job: MutableJob,
  ): Promise<void> {
    for (const file of job.files) {
      if (job.controller.signal.aborted) break;
      try {
        const result = await this.manager.ingest(
          principal,
          job.knowledgeBaseId,
          job.assistantId,
          { file },
          job.controller.signal,
          (stage, completed) => {
            job.currentStage = stage;
            job.progress = Math.min(
              99,
              Math.round(
                ((job.processedFiles + completed / 3) / job.totalFiles) * 100,
              ),
            );
          },
        );
        job.documentIds.push(result.document.documentId);
        job.processedFiles += 1;
      } catch (error) {
        job.failedFiles += 1;
        job.errors.push(
          Object.freeze({
            fileName: file.name,
            code:
              error instanceof Error && "code" in error
                ? String(error.code)
                : "INGESTION_FAILED",
            message:
              error instanceof Error ? error.message : "Falló la ingesta.",
          }),
        );
      }
    }
    const completed = this.now();
    job.completedAt = completed.toISOString();
    job.durationMilliseconds =
      completed.getTime() - new Date(job.startedAt).getTime();
    job.progress = job.status === "cancelled" ? job.progress : 100;
    job.currentStage =
      job.status === "cancelled"
        ? "cancelled"
        : job.processedFiles > 0
          ? "ready"
          : "failed";
    job.status =
      job.status === "cancelled"
        ? "cancelled"
        : job.failedFiles === 0
          ? "completed"
          : job.processedFiles > 0
            ? "partially-completed"
            : "failed";
  }
}
