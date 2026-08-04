import { createToolExecutor } from "./executor.js";
import type { ToolDependencies, ToolServices } from "./types.js";
export function createToolServices(
  dependencies: ToolDependencies,
): ToolServices {
  return Object.freeze({
    registry: dependencies.registry,
    executor: createToolExecutor(dependencies),
    ...(dependencies.auditSink !== undefined
      ? { audit: dependencies.auditSink }
      : {}),
  });
}
