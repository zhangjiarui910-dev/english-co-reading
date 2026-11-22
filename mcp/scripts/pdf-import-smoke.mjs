import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function makePdf(lines) {
  const escaped = lines.map((line) => String(line).replace(/([\\()])/g, "\\$1"));
  const commands = ["BT", "/F1 16 Tf", "72 720 Td"];
  escaped.forEach((line, index) => {
    if (index) commands.push("0 -24 Td");
    commands.push(`(${line}) Tj`);
  });
  commands.push("ET");
  const stream = `${commands.join("\n")}\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}endstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

const tempDataDir = await mkdtemp(path.join(os.tmpdir(), "co-reading-pdf-smoke-"));
process.env.READING_MCP_DATA_DIR = tempDataDir;

try {
  const { importBook } = await import("../src/importer.js");
  const pdf = makePdf([
    "Introduction to Learning English Through Books",
    "This text based PDF contains enough readable English for a realistic import test.",
    "The imported passage should remain searchable and available for review and reading progress.",
  ]);
  const imported = await importBook({
    filename: "learning-through-books.pdf",
    dataBase64: pdf.toString("base64"),
    bookId: "pdf-smoke",
    title: "Learning Through Books",
  });
  const manifest = JSON.parse(await readFile(path.join(tempDataDir, "books", "pdf-smoke", "manifest.json"), "utf8"));
  const chunk = await readFile(path.join(tempDataDir, "books", "pdf-smoke", manifest.chunks[0].path), "utf8");
  if (imported.source?.type !== "pdf" || imported.chunkCount < 1 || !chunk.includes("realistic import test")) {
    throw new Error("text PDF was not imported into readable chunks");
  }

  let scannedRejected = false;
  try {
    await importBook({
      filename: "scanned.pdf",
      dataBase64: makePdf([]).toString("base64"),
      bookId: "scanned-pdf-smoke",
      title: "Scanned PDF",
    });
  } catch (error) {
    scannedRejected = /OCR/i.test(error.message);
  }
  if (!scannedRejected) throw new Error("image-only PDF did not return an OCR explanation");
  console.log("pdf import smoke passed: text extraction, chunk creation, scanned-PDF guidance");
} finally {
  await rm(tempDataDir, { recursive: true, force: true });
}
