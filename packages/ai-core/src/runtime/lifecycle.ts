/** Bus de eventos aislado para el ciclo de vida del runtime. */
import type {
  RuntimeEvent,
  RuntimeEventListener,
  RuntimeLifecycle,
} from "./types.js";

export class DefaultRuntimeLifecycle implements RuntimeLifecycle {
  private readonly listeners = new Set<RuntimeEventListener>();

  public constructor(listeners: readonly RuntimeEventListener[] = []) {
    for (const listener of listeners) this.listeners.add(listener);
  }

  public subscribe(listener: RuntimeEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public async emit(event: RuntimeEvent): Promise<void> {
    for (const listener of this.listeners) {
      try {
        await listener(event);
      } catch {
        // La observabilidad no puede interrumpir la ejecución principal.
      }
    }
  }
}

export function createRuntimeLifecycle(
  listeners: readonly RuntimeEventListener[] = [],
): RuntimeLifecycle {
  return new DefaultRuntimeLifecycle(listeners);
}
