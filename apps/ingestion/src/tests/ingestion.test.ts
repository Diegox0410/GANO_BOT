import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { createInMemoryKnowledgeRepository } from "@gano-bot/ai-core/knowledge";
import { ingestLocalFiles } from "../runner.js";
import "./rag.test.js";

const sourceDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../tests/fixtures",
);

function createPdf(text: string): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${text.length + 33} >>\nstream\nBT /F1 12 Tf 72 720 Td (${text}) Tj ET\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n `)
    .join(
      "\n",
    )}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
async function createDocx(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip
    .folder("_rels")
    ?.file(
      ".rels",
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    );
  zip
    .folder("word")
    ?.file(
      "document.xml",
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Documento DOCX local</w:t></w:r></w:p><w:p><w:r><w:t>Segundo párrafo</w:t></w:r></w:p></w:body></w:document>',
    );
  return zip.generateAsync({ type: "uint8array" });
}
async function createXlsx(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Primera").addRows([
    ["id", "nombre"],
    [1, "Ana"],
  ]);
  workbook.addWorksheet("Segunda").addRows([["estado"], ["activo"]]);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

test("ingesta end-to-end ocho formatos y deduplicación", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gano-ingestion-"));
  try {
    for (const name of [
      "sample.txt",
      "sample.md",
      "sample.json",
      "sample.csv",
      "sample.html",
    ])
      await cp(join(sourceDirectory, name), join(directory, name));
    await writeFile(
      join(directory, "sample.pdf"),
      createPdf("Documento PDF local"),
    );
    await writeFile(join(directory, "sample.docx"), await createDocx());
    await writeFile(join(directory, "sample.xlsx"), await createXlsx());
    const repository = createInMemoryKnowledgeRepository();
    const config = {
      rootDirectory: directory,
      tenantId: "tenant-test",
      assistantId: "assistant-test",
      knowledgeBaseId: "knowledge-test",
      repository,
      maximumDocumentBytes: 2_000_000,
    };
    const first = await ingestLocalFiles(config);
    assert.equal(first.failedCount, 0, JSON.stringify(first.files));
    assert.equal(first.documentCount, 8);
    assert.ok(first.chunkCount >= 8);
    const htmlChunks = await repository.getChunks(
      "tenant-test",
      "assistant-test",
      "knowledge-test",
      `document-${Buffer.from("sample.html").toString("base64url")}`,
      "1",
    );
    assert.ok(
      htmlChunks.some((chunk) => chunk.content.includes("Contenido visible")),
    );
    assert.ok(
      htmlChunks.every((chunk) => !chunk.content.includes("throw new Error")),
    );
    const xlsxChunks = await repository.getChunks(
      "tenant-test",
      "assistant-test",
      "knowledge-test",
      `document-${Buffer.from("sample.xlsx").toString("base64url")}`,
      "1",
    );
    assert.ok(xlsxChunks.some((chunk) => chunk.content.includes("Primera")));
    assert.ok(xlsxChunks.some((chunk) => chunk.content.includes("Segunda")));
    const second = await ingestLocalFiles(config);
    assert.equal(second.deduplicatedCount, 8);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rechaza selección fuera del directorio autorizado", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gano-ingestion-root-"));
  const outside = join(tmpdir(), "gano-ingestion-outside.txt");
  try {
    await writeFile(join(directory, "inside.txt"), "contenido");
    await writeFile(outside, "secreto");
    const result = await ingestLocalFiles({
      rootDirectory: directory,
      files: [outside],
      tenantId: "tenant",
      assistantId: "assistant",
      knowledgeBaseId: "base",
    });
    assert.equal(result.documentCount, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(outside, { force: true });
  }
});
