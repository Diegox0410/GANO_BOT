import type { ToolAuditEvent, ToolAuditSink } from "./types.js";
/** Sink volátil exclusivamente para desarrollo y pruebas. */ export class InMemoryToolAuditSink implements ToolAuditSink {
  private readonly events: ToolAuditEvent[] = [];
  public async write(event: ToolAuditEvent): Promise<void> {
    this.events.push(
      Object.freeze({
        ...event,
        ...(event.metadata !== undefined
          ? { metadata: Object.freeze({ ...event.metadata }) }
          : {}),
      }),
    );
  }
  public async list(): Promise<readonly ToolAuditEvent[]> {
    return Object.freeze([...this.events]);
  }
}
export function createInMemoryToolAuditSink(): ToolAuditSink {
  return new InMemoryToolAuditSink();
}
