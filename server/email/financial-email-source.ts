import { Worker } from "node:worker_threads";
import type { EmailAuthenticationProjection, EmailProvider } from "../../shared/types/email.ts";
import type { FinancialSourceWorkerResult } from "./financial-email-source-worker.ts";

export const FINANCIAL_EMAIL_SOURCE_LIMITS = Object.freeze({
  messageBytes: 8 * 1024 * 1024,
  gmailResponseBytes: Math.ceil(8 * 1024 * 1024 * 4 / 3) + 64 * 1024,
  pdfCount: 3,
  pdfBytes: 2 * 1024 * 1024,
  pdfPages: 10,
  combinedChars: 20_000,
  fetchTimeoutMs: 30_000,
  parseTimeoutMs: 15_000,
  concurrentParsers: 2,
});

export interface FinancialEmailSource {
  body: string;
  fromName: string;
  fromAddress: string;
  subject: string;
  emailDate: string;
  threadId: string | null;
  messageId: string | null;
  senderAuthentication: EmailAuthenticationProjection | null;
  attachments: Array<{
    partId: string;
    filename: string;
    sha256: string;
    bytes: number;
    pages: number;
    extractorVersion: string;
  }>;
}

export type FinancialSourceErrorCode =
  | "financial_source_unavailable" | "financial_source_invalid"
  | "financial_source_oversized" | "financial_source_incomplete"
  | "financial_source_timeout" | "financial_source_busy"
  | "financial_source_unsupported_attachment"
  | "financial_pdf_oversized" | "financial_pdf_count" | "financial_pdf_pages"
  | "financial_pdf_corrupt" | "financial_pdf_encrypted" | "financial_pdf_textless"
  | "financial_pdf_incomplete" | "financial_pdf_unsupported_layout";

export class FinancialEmailSourceError extends Error {
  code: FinancialSourceErrorCode;
  status: number;

  constructor(code: FinancialSourceErrorCode, message: string, status = 422) {
    super(message);
    this.name = "FinancialEmailSourceError";
    this.code = code;
    this.status = status;
  }
}

export interface FinancialSourceMetadata {
  provider: EmailProvider;
  emailDate?: string;
  threadId?: string | null;
}

let activeParsers = 0;

/** No provider/index side effects. MIME and PDF work share a killable resource budget. */
export async function parseFinancialEmailSource(raw: Buffer, metadata: FinancialSourceMetadata): Promise<FinancialEmailSource> {
  if (!raw.length) throw new FinancialEmailSourceError("financial_source_unavailable", "The original email source is unavailable.", 404);
  if (raw.length > FINANCIAL_EMAIL_SOURCE_LIMITS.messageBytes) {
    throw new FinancialEmailSourceError("financial_source_oversized", "The original email exceeds the financial evidence byte limit.", 413);
  }
  if (activeParsers >= FINANCIAL_EMAIL_SOURCE_LIMITS.concurrentParsers) {
    throw new FinancialEmailSourceError("financial_source_busy", "Financial source parsing is busy; retry acquisition.", 503);
  }
  activeParsers++;
  let worker: Worker | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    worker = new Worker(new URL("./financial-email-source-worker.ts", import.meta.url), {
      workerData: { raw, metadata },
      // Native Node TypeScript loading; never inherit a test runner or server inspector.
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
    return await new Promise<FinancialEmailSource>((resolve, reject) => {
      timeout = setTimeout(() => reject(new FinancialEmailSourceError(
        "financial_source_timeout", "Financial evidence parsing exceeded its time limit.", 503,
      )), FINANCIAL_EMAIL_SOURCE_LIMITS.parseTimeoutMs);
      worker!.once("message", (result: FinancialSourceWorkerResult) => {
        if (result.ok) resolve(result.source);
        else reject(new FinancialEmailSourceError(result.code, result.message, result.status));
      });
      worker!.once("error", () => reject(new FinancialEmailSourceError(
        "financial_source_invalid", "Financial evidence parsing failed within its resource limit.",
      )));
      worker!.once("exit", () => reject(new FinancialEmailSourceError(
        "financial_source_invalid", "Financial evidence parsing ended without a complete source.",
      )));
    });
  } finally {
    clearTimeout(timeout);
    await worker?.terminate();
    activeParsers--;
  }
}

/** Read the encoded Gmail response with a cap before JSON/base64/MIME parsing. */
export async function readFinancialSourceResponse(response: Response): Promise<unknown> {
  const cap = FINANCIAL_EMAIL_SOURCE_LIMITS.gmailResponseBytes;
  const declaredBytes = Number(response.headers.get("content-length") || 0);
  if (declaredBytes > cap) {
    await response.body?.cancel();
    throw new FinancialEmailSourceError("financial_source_oversized", "The financial source response exceeds its byte limit.", 413);
  }
  if (!response.body) throw new FinancialEmailSourceError("financial_source_unavailable", "The source response is empty.", 502);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > cap) throw new FinancialEmailSourceError("financial_source_oversized", "The financial source response exceeds its byte limit.", 413);
      chunks.push(Buffer.from(value));
    }
    try {
      return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8")) as unknown;
    } catch {
      throw new FinancialEmailSourceError("financial_source_invalid", "The provider returned an invalid source response.", 502);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
