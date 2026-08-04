import { extname } from "node:path";
import type { KnowledgeSourceKind } from "@gano-bot/ai-core/knowledge";

export interface LocalFormatDescriptor {
  readonly kind: Extract<
    KnowledgeSourceKind,
    "txt" | "markdown" | "json" | "csv" | "html" | "pdf" | "docx" | "xlsx"
  >;
  readonly extensions: readonly string[];
  readonly mimeTypes: readonly string[];
  readonly binary: boolean;
  readonly chunkerId: "paragraph" | "markdown" | "heading";
}
export const LOCAL_FORMATS: readonly LocalFormatDescriptor[] = Object.freeze([
  {
    kind: "txt",
    extensions: [".txt"],
    mimeTypes: ["text/plain"],
    binary: false,
    chunkerId: "paragraph",
  },
  {
    kind: "markdown",
    extensions: [".md", ".markdown"],
    mimeTypes: ["text/markdown", "text/x-markdown"],
    binary: false,
    chunkerId: "markdown",
  },
  {
    kind: "json",
    extensions: [".json"],
    mimeTypes: ["application/json"],
    binary: false,
    chunkerId: "heading",
  },
  {
    kind: "csv",
    extensions: [".csv"],
    mimeTypes: ["text/csv", "application/csv"],
    binary: false,
    chunkerId: "heading",
  },
  {
    kind: "html",
    extensions: [".html", ".htm"],
    mimeTypes: ["text/html", "application/xhtml+xml"],
    binary: false,
    chunkerId: "heading",
  },
  {
    kind: "pdf",
    extensions: [".pdf"],
    mimeTypes: ["application/pdf"],
    binary: true,
    chunkerId: "heading",
  },
  {
    kind: "docx",
    extensions: [".docx"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    binary: true,
    chunkerId: "heading",
  },
  {
    kind: "xlsx",
    extensions: [".xlsx"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    binary: true,
    chunkerId: "heading",
  },
]);
export function findFormatByPath(
  path: string,
): LocalFormatDescriptor | undefined {
  const extension = extname(path).toLowerCase();
  return LOCAL_FORMATS.find((format) => format.extensions.includes(extension));
}
export function sniffMimeType(data: Uint8Array): string | undefined {
  if (
    data.length >= 5 &&
    new TextDecoder("ascii").decode(data.slice(0, 5)) === "%PDF-"
  )
    return "application/pdf";
  if (
    data.length >= 4 &&
    data[0] === 0x50 &&
    data[1] === 0x4b &&
    data[2] === 0x03 &&
    data[3] === 0x04
  )
    return "application/zip";
  return undefined;
}
