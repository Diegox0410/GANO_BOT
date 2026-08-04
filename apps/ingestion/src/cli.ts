#!/usr/bin/env node
import { resolve } from "node:path";
import { ingestLocalFiles, summarizeLocalIngestion } from "./runner.js";

interface CliOptions {
  readonly root: string;
  readonly files?: readonly string[];
  readonly tenantId: string;
  readonly assistantId: string;
  readonly knowledgeBaseId: string;
  readonly version: string;
  readonly maximumBytes: number;
}
function value(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}
function parseArguments(args: readonly string[]): CliOptions {
  const root = value(args, "--root");
  const tenantId = value(args, "--tenant");
  const assistantId = value(args, "--assistant");
  const knowledgeBaseId = value(args, "--knowledge-base");
  if (
    root === undefined ||
    tenantId === undefined ||
    assistantId === undefined ||
    knowledgeBaseId === undefined
  )
    throw new Error(
      "Uso: gano-ingest --root <directorio> --tenant <id> --assistant <id> --knowledge-base <id> [--files a.txt,b.md] [--version 1] [--max-bytes 26214400]",
    );
  const maximumBytes = Number(value(args, "--max-bytes") ?? 25 * 1024 * 1024);
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0)
    throw new Error("--max-bytes debe ser un entero positivo.");
  const files = value(args, "--files")
    ?.split(",")
    .map((file) => resolve(root, file.trim()));
  return {
    root: resolve(root),
    ...(files === undefined ? {} : { files }),
    tenantId,
    assistantId,
    knowledgeBaseId,
    version: value(args, "--version") ?? "1",
    maximumBytes,
  };
}
async function main(): Promise<void> {
  try {
    const options = parseArguments(process.argv.slice(2));
    const summary = await ingestLocalFiles({
      rootDirectory: options.root,
      files: options.files,
      tenantId: options.tenantId,
      assistantId: options.assistantId,
      knowledgeBaseId: options.knowledgeBaseId,
      version: options.version,
      maximumDocumentBytes: options.maximumBytes,
    });
    console.log(summarizeLocalIngestion(summary));
    if (summary.failedCount > 0) process.exitCode = 1;
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Falló la ingesta local.",
    );
    process.exitCode = 1;
  }
}
await main();
