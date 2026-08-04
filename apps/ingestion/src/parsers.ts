import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { Readable } from "node:stream";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  createDocumentParser,
  KnowledgeError,
  throwIfKnowledgeAborted,
} from "@gano-bot/ai-core/knowledge";
import type {
  DocumentParser,
  KnowledgeDocumentSection,
  LoadedDocument,
  ParsedDocument,
} from "@gano-bot/ai-core/knowledge";
import type { AIMetadata } from "@gano-bot/ai-core";
import { LOCAL_FORMATS } from "./formats.js";

function normalizeText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function asBytes(document: LoadedDocument): Uint8Array {
  return typeof document.content === "string"
    ? new TextEncoder().encode(document.content)
    : document.content;
}
function asText(document: LoadedDocument): string {
  return typeof document.content === "string"
    ? document.content
    : new TextDecoder("utf-8", { fatal: true }).decode(document.content);
}
function section(
  id: string,
  title: string | undefined,
  text: string,
  startOffset: number,
  level?: number,
  page?: number,
): KnowledgeDocumentSection {
  return Object.freeze({
    id,
    ...(title !== undefined ? { title } : {}),
    text,
    ...(level !== undefined ? { level } : {}),
    ...(page !== undefined ? { page } : {}),
    startOffset,
    endOffset: startOffset + text.length,
  });
}
function parsed(
  document: LoadedDocument,
  text: string,
  sections: readonly KnowledgeDocumentSection[],
  metadata: AIMetadata = {},
): ParsedDocument {
  return Object.freeze({
    tenantId: document.tenantId,
    assistantId: document.assistantId,
    knowledgeBaseId: document.knowledgeBaseId,
    documentId: document.documentId,
    version: document.version,
    title: document.title,
    source: document.source,
    mimeType: document.mimeType,
    language: document.language ?? "es",
    text: normalizeText(text),
    sections: Object.freeze(sections),
    metadata: Object.freeze({ ...document.metadata, ...metadata }),
  });
}
function oneSection(document: LoadedDocument, text: string): ParsedDocument {
  const normalized = normalizeText(text);
  return parsed(
    document,
    normalized,
    normalized.length === 0
      ? []
      : [
          section(
            `${document.documentId}-section-1`,
            document.title,
            normalized,
            0,
          ),
        ],
  );
}

function parseMarkdown(document: LoadedDocument): ParsedDocument {
  const text = normalizeText(asText(document));
  const matches = [...text.matchAll(/^(#{1,6})\s+(.+)$/gm)];
  if (matches.length === 0) return oneSection(document, text);
  const sections: KnowledgeDocumentSection[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    if (match?.index === undefined) continue;
    const end = matches[index + 1]?.index ?? text.length;
    const value = text.slice(match.index, end).trim();
    sections.push(
      section(
        `${document.documentId}-section-${index + 1}`,
        match[2]?.trim(),
        value,
        match.index,
        match[1]?.length,
      ),
    );
  }
  return parsed(document, text, sections);
}
function stringifyJson(
  value: unknown,
  path = "$",
  depth = 0,
): readonly string[] {
  if (depth > 32)
    throw new KnowledgeError(
      "INVALID_DOCUMENT",
      "El JSON excede la profundidad máxima permitida.",
    );
  if (Array.isArray(value))
    return value.flatMap((item, index) =>
      stringifyJson(item, `${path}[${index}]`, depth + 1),
    );
  if (typeof value === "object" && value !== null)
    return Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([key, item]) =>
        stringifyJson(item, `${path}.${key}`, depth + 1),
      );
  return [`${path}: ${value === null ? "null" : String(value)}`];
}
function parseJson(document: LoadedDocument): ParsedDocument {
  let value: unknown;
  try {
    value = JSON.parse(asText(document));
  } catch (error) {
    throw new KnowledgeError(
      "INVALID_DOCUMENT",
      "El contenido JSON no es válido.",
      undefined,
      error,
    );
  }
  const lines = stringifyJson(value);
  const text = lines.join("\n");
  const sections = lines.map((line, index) =>
    section(
      `${document.documentId}-json-${index + 1}`,
      line.slice(0, line.indexOf(":")),
      line,
      text.indexOf(line),
    ),
  );
  return parsed(document, text, sections, { structured: true });
}
function parseCsvRows(input: string): readonly (readonly string[])[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((item) => item.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (quoted)
    throw new KnowledgeError(
      "INVALID_DOCUMENT",
      "El CSV contiene un campo entrecomillado sin cerrar.",
    );
  row.push(field);
  if (row.some((item) => item.length > 0)) rows.push(row);
  return Object.freeze(rows.map((item) => Object.freeze(item)));
}
function parseCsv(document: LoadedDocument): ParsedDocument {
  const rows = parseCsvRows(asText(document));
  if (rows.length === 0) return oneSection(document, "");
  const headers = rows[0] ?? [];
  const blocks = rows
    .slice(1)
    .map(
      (row, index) =>
        `# Fila ${index + 1}\n${headers.map((header, column) => `${header.trim() || `columna_${column + 1}`}: ${row[column] ?? ""}`).join("\n")}`,
    );
  const text = blocks.join("\n\n");
  let offset = 0;
  const sections = blocks.map((block, index) => {
    const result = section(
      `${document.documentId}-row-${index + 1}`,
      `Fila ${index + 1}`,
      block,
      offset,
      1,
    );
    offset += block.length + 2;
    return result;
  });
  return parsed(document, text, sections, {
    rowCount: Math.max(0, rows.length - 1),
    columnCount: headers.length,
  });
}
function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, number: string) =>
      String.fromCodePoint(Number(number)),
    );
}
function parseHtml(document: LoadedDocument): ParsedDocument {
  let html = asText(document);
  html = html.replace(
    /<(script|style|noscript|iframe|object|embed|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    "",
  );
  html = html.replace(/<!--([\s\S]*?)-->/g, "");
  html = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|section|article)>/gi, "\n")
    .replace(
      /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
      (_match, level: string, title: string) =>
        `${"#".repeat(Number(level))} ${decodeEntities(title.replace(/<[^>]+>/g, " ")).trim()}\n`,
    )
    .replace(/<[^>]+>/g, " ");
  return parseMarkdown({ ...document, content: decodeEntities(html) });
}

async function parsePdf(
  document: LoadedDocument,
  signal: AbortSignal | undefined,
): Promise<ParsedDocument> {
  const task = getDocument({ data: asBytes(document), useSystemFonts: true });
  try {
    const pdf = await task.promise;
    const pages: string[] = [];
    const sections: KnowledgeDocumentSection[] = [];
    let offset = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      throwIfKnowledgeAborted(signal);
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const body = normalizeText(
        content.items.map((item) => ("str" in item ? item.str : "")).join(" "),
      );
      const value = `# Página ${pageNumber}\n${body}`;
      pages.push(value);
      sections.push(
        section(
          `${document.documentId}-page-${pageNumber}`,
          `Página ${pageNumber}`,
          value,
          offset,
          1,
          pageNumber,
        ),
      );
      offset += value.length + 2;
    }
    return parsed(document, pages.join("\n\n"), sections, {
      pageCount: pdf.numPages,
    });
  } finally {
    await task.destroy();
  }
}
async function parseDocx(document: LoadedDocument): Promise<ParsedDocument> {
  const result = await mammoth.extractRawText({
    buffer: Buffer.from(asBytes(document)),
  });
  const text = normalizeText(result.value);
  const paragraphs = text
    .split(/\n{2,}/)
    .filter((value) => value.trim().length > 0);
  let offset = 0;
  const sections = paragraphs.map((value, index) => {
    const resultSection = section(
      `${document.documentId}-paragraph-${index + 1}`,
      `Párrafo ${index + 1}`,
      value,
      offset,
    );
    offset += value.length + 2;
    return resultSection;
  });
  return parsed(document, text, sections, {
    parserMessages: result.messages.length,
  });
}
async function parseXlsx(document: LoadedDocument): Promise<ParsedDocument> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.read(Readable.from([Buffer.from(asBytes(document))]));
  const blocks: string[] = [];
  const sections: KnowledgeDocumentSection[] = [];
  let offset = 0;
  workbook.eachSheet((sheet) => {
    const rows: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const values = row.values;
      const cells = Array.isArray(values)
        ? values
            .slice(1)
            .map((value) =>
              typeof value === "object" && value !== null
                ? JSON.stringify(value)
                : String(value ?? ""),
            )
        : [];
      rows.push(`${rowNumber}: ${cells.join(" | ")}`);
    });
    const value = `# Hoja: ${sheet.name}\n${rows.join("\n")}`;
    blocks.push(value);
    sections.push(
      section(
        `${document.documentId}-sheet-${sheet.id}`,
        sheet.name,
        value,
        offset,
        1,
      ),
    );
    offset += value.length + 2;
  });
  return parsed(document, blocks.join("\n\n"), sections, {
    sheetCount: workbook.worksheets.length,
  });
}

export function createLocalDocumentParsers(): readonly DocumentParser[] {
  return Object.freeze(
    LOCAL_FORMATS.map((format) =>
      createDocumentParser({
        id: `${format.kind}-document-parser`,
        mimeTypes: format.mimeTypes,
        parse: async ({ document, context }) => {
          throwIfKnowledgeAborted(context.signal);
          switch (format.kind) {
            case "txt":
              return oneSection(document, asText(document));
            case "markdown":
              return parseMarkdown(document);
            case "json":
              return parseJson(document);
            case "csv":
              return parseCsv(document);
            case "html":
              return parseHtml(document);
            case "pdf":
              return parsePdf(document, context.signal);
            case "docx":
              return parseDocx(document);
            case "xlsx":
              return parseXlsx(document);
          }
        },
      }),
    ),
  );
}
export { normalizeText };
