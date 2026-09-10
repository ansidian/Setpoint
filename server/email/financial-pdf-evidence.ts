import { createHash } from "node:crypto";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { PDFPageProxy, TextItem } from "pdfjs-dist/types/src/display/api.js";
import type * as PdfJs from "pdfjs-dist/legacy/build/pdf.mjs";
import { FINANCIAL_EMAIL_SOURCE_LIMITS as limits, FinancialEmailSourceError } from "./financial-email-source.ts";

interface PdfEvidence {
  text: string;
  pages: number;
  sha256: string;
  extractorVersion: string;
}

function requireCompletePdfBytes(content: Buffer): void {
  if (content.length > limits.pdfBytes) throw new FinancialEmailSourceError("financial_pdf_oversized", "A PDF attachment exceeds the financial evidence byte limit.", 413);
  if (!/^%PDF-(?:1\.[0-7]|2\.0)\b/.test(content.subarray(0, 16).toString("latin1"))) {
    throw new FinancialEmailSourceError("financial_pdf_corrupt", "A PDF attachment does not have a valid PDF header.");
  }
  const end = content.subarray(Math.max(0, content.length - 1024)).toString("latin1");
  const offset = end.match(/startxref\s+(\d+)\s+%%EOF\s*$/)?.[1];
  if (!offset || Number(offset) >= content.length) {
    throw new FinancialEmailSourceError("financial_pdf_incomplete", "A PDF attachment has no complete trailer.");
  }
  const crossReference = content.subarray(Number(offset), Number(offset) + 64).toString("latin1");
  if (!/^(?:xref\b|\d+\s+\d+\s+obj\b)/.test(crossReference)) {
    throw new FinancialEmailSourceError("financial_pdf_corrupt", "A PDF attachment has a damaged cross-reference table.");
  }
}

/** Preserve spatially associated label/value columns, with one line per visual row. */
function pageRows(items: TextItem[], viewport: ReturnType<PDFPageProxy["getViewport"]>): string {
  const pieces = items.filter((item) => item.str.trim()).map((item) => {
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = viewport.transform;
    const t = item.transform as number[];
    if (t.length !== 6 || t.some((value) => !Number.isFinite(value))
      || a * t[0]! + c * t[1]! <= 0 || item.dir !== "ltr"
      || Math.abs(a * t[2]! + c * t[3]!) > 0.1 || Math.abs(b * t[0]! + d * t[1]!) > 0.1) {
      throw new FinancialEmailSourceError("financial_pdf_unsupported_layout", "The PDF contains text whose layout cannot be read reliably.");
    }
    return { text: item.str, x: a * t[4]! + c * t[5]! + e, y: b * t[4]! + d * t[5]! + f, width: item.width, height: item.height };
  }).sort((left, right) => left.y - right.y || left.x - right.x);
  const rows: Array<{ y: number; pieces: typeof pieces }> = [];
  for (const piece of pieces) {
    const previous = rows.at(-1);
    if (previous && Math.abs(piece.y - previous.y) <= Math.min(2, Math.max(0.5, piece.height * 0.15))) previous.pieces.push(piece);
    else rows.push({ y: piece.y, pieces: [piece] });
  }
  return rows.map((row) => {
    const sorted = row.pieces.sort((left, right) => left.x - right.x);
    return sorted.reduce((line, piece, index) => {
      const previous = sorted[index - 1];
      if (!previous) return piece.text;
      const gap = piece.x - previous.x - previous.width;
      const separator = gap > Math.max(6, piece.height) ? " | " : gap > 0.5 ? " " : "";
      return `${line}${separator}${piece.text}`;
    }, "").trim();
  }).filter(Boolean).join("\n");
}

/** Reject a substantial raster region: text-only extraction cannot prove its bill facts. */
async function requireReadablePage(page: PDFPageProxy, pdfjs: typeof PdfJs): Promise<void> {
  const viewport = page.getViewport({ scale: 1 });
  const operations = await page.getOperatorList();
  if (operations.fnArray.length > 100_000) throw new FinancialEmailSourceError("financial_pdf_incomplete", "The PDF page exceeds the supported drawing complexity.");
  let matrix = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  const imageOperations = new Set([
    pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject,
    pdfjs.OPS.paintImageMaskXObject, pdfjs.OPS.paintImageXObjectRepeat,
    pdfjs.OPS.paintInlineImageXObjectGroup, pdfjs.OPS.paintImageMaskXObjectGroup,
    pdfjs.OPS.paintImageMaskXObjectRepeat,
  ]);
  for (const [index, operation] of operations.fnArray.entries()) {
    const args = operations.argsArray[index] as number[];
    if (operation === pdfjs.OPS.save) stack.push([...matrix]);
    else if (operation === pdfjs.OPS.restore) matrix = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (operation === pdfjs.OPS.transform) matrix = pdfjs.Util.transform(matrix, args);
    else if (imageOperations.has(operation)) {
      const area = Math.abs(matrix[0]! * matrix[3]! - matrix[1]! * matrix[2]!);
      if (!Number.isFinite(area) || area > viewport.width * viewport.height * 0.15
        || ![pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject].includes(operation)) {
        throw new FinancialEmailSourceError("financial_pdf_incomplete", "The PDF contains image evidence that requires visual review.");
      }
    } else if (operation === pdfjs.OPS.setTextRenderingMode && (args[0] === 3 || args[0] === 7)) {
      throw new FinancialEmailSourceError("financial_pdf_incomplete", "The PDF contains hidden text that cannot establish visible bill facts.");
    }
  }
  const annotations = await page.getAnnotations();
  if (annotations.some((annotation: { annotationType: number }) => annotation.annotationType !== pdfjs.AnnotationType.LINK)) {
    throw new FinancialEmailSourceError("financial_pdf_incomplete", "The PDF contains annotations outside the readable page evidence.");
  }
}

/** Runs only inside the killable financial-source worker, never on the server event loop. */
export async function extractFinancialPdfEvidence(content: Buffer): Promise<PdfEvidence> {
  requireCompletePdfBytes(content);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const packageRoot = dirname(fileURLToPath(import.meta.resolve("pdfjs-dist/package.json")));
  // A warning means PDF.js recovered, substituted, or omitted source data.
  // This worker is isolated, so recording its warnings cannot affect app logging.
  let parseWarning = false;
  const originalWarn = console.warn;
  console.warn = () => { parseWarning = true; };
  const task = pdfjs.getDocument({
    data: new Uint8Array(content), stopAtErrors: true, verbosity: pdfjs.VerbosityLevel.WARNINGS,
    useWorkerFetch: false, useWasm: false, useSystemFonts: false, disableFontFace: true,
    maxImageSize: 4_000_000,
    standardFontDataUrl: join(packageRoot, "standard_fonts") + sep,
    cMapUrl: join(packageRoot, "cmaps") + sep, cMapPacked: true,
  });
  try {
    const document = await task.promise;
    const metadata = await document.getMetadata();
    const info = metadata.info as { EncryptFilterName?: string | null; IsAcroFormPresent?: boolean; IsXFAPresent?: boolean };
    if (info.EncryptFilterName) throw new FinancialEmailSourceError("financial_pdf_encrypted", "Encrypted PDF attachments require owner review.");
    if (info.IsAcroFormPresent || info.IsXFAPresent || await document.getAttachments()) {
      throw new FinancialEmailSourceError("financial_pdf_incomplete", "The PDF contains form or embedded-file evidence outside its page text.");
    }
    if (document.numPages > limits.pdfPages) throw new FinancialEmailSourceError("financial_pdf_pages", "A PDF attachment exceeds the financial evidence page limit.");
    const pages: string[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const items = content.items.filter((item): item is TextItem => "str" in item);
      const text = pageRows(items, page.getViewport({ scale: 1 }));
      if (!text.trim() || text.includes("\uFFFD") || [...text].some((character) => character.charCodeAt(0) < 32 && character !== "\n" && character !== "\t")) {
        throw new FinancialEmailSourceError("financial_pdf_textless", "A PDF page has no complete readable text; visual review is required.");
      }
      await requireReadablePage(page, pdfjs);
      pages.push(`[Page ${number} of ${document.numPages}]\n${text}`);
      if (pages.join("\n\n").length > limits.combinedChars) throw new FinancialEmailSourceError("financial_source_oversized", "Complete PDF text exceeds the financial decision limit.", 413);
      page.cleanup();
    }
    if (parseWarning) throw new FinancialEmailSourceError("financial_pdf_incomplete", "PDF extraction required recovery or omitted source data.");
    return { text: pages.join("\n\n"), pages: document.numPages, sha256: createHash("sha256").update(content).digest("hex"), extractorVersion: `pdfjs-${pdfjs.version}:setpoint-text-v1` };
  } catch (error) {
    if (error instanceof FinancialEmailSourceError) throw error;
    if (error instanceof Error && error.name === "PasswordException") throw new FinancialEmailSourceError("financial_pdf_encrypted", "Encrypted PDF attachments require owner review.");
    throw new FinancialEmailSourceError("financial_pdf_corrupt", "A PDF attachment could not be completely parsed.");
  } finally {
    console.warn = originalWarn;
    await task.destroy();
  }
}
