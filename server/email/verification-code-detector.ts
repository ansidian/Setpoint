import type { VerificationCodeKind } from "../../shared/types/email.ts";

export const VERIFICATION_CODE_DETECTOR_VERSION = 1 as const;
export const VERIFICATION_CODE_ACTIVE_WINDOW_MS = 30 * 60 * 1000;

export interface VerificationCodeDetection {
  code: string;
  kind: VerificationCodeKind;
  activeUntil: string;
  detectorVersion: typeof VERIFICATION_CODE_DETECTOR_VERSION;
}

interface VerificationCodeInput {
  subject?: unknown;
  snippet?: unknown;
  bodyText?: unknown;
  emailTimestamp?: unknown;
}

interface Candidate {
  code: string;
  kind: VerificationCodeKind;
  start: number;
  end: number;
  alphabeticHyphenated: boolean;
}

interface ScoredCandidate {
  code: string;
  kind: VerificationCodeKind;
  score: number;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

const STRONG_MARKER_SOURCE = [
  String.raw`(?:verification|security|authentication|confirmation|login|sign[\s-]?in|one[\s-]?time)\s+(?:code|passcode|pin|password)`,
  String.raw`(?:otp|passcode|pin(?:\s+code)?)`,
  String.raw`verif(?:y|ying)\s+(?:your\s+)?identity`,
].join("|");

const CANDIDATE_RE = /(?<![A-Za-z0-9])(?:[A-Za-z0-9]{3,4}(?:-[A-Za-z0-9]{3,4}){1,3}|[A-Za-z0-9]{4,12})(?![A-Za-z0-9])/g;
const DIRECT_GAP_RE = /^[\s:;,.#=()–—-]*(?:(?:is|is below|below|following|to use)[\s:;,.#=()–—-]*)?$/i;
const LEADING_DIRECT_GAP_RE = /^[\s:;,.#=()–—-]*(?:is\s+your|is\s+the|[-–—:])[\s:;,.#=()–—-]*$/i;

function decodeEntity(entity: string, body: string): string {
  const normalized = body.toLowerCase();
  if (normalized.startsWith("#x")) {
    const value = Number.parseInt(normalized.slice(2), 16);
    return Number.isFinite(value) && value <= 0x10FFFF ? String.fromCodePoint(value) : entity;
  }
  if (normalized.startsWith("#")) {
    const value = Number.parseInt(normalized.slice(1), 10);
    return Number.isFinite(value) && value <= 0x10FFFF ? String.fromCodePoint(value) : entity;
  }
  return NAMED_ENTITIES[normalized] ?? entity;
}

export function normalizeVerificationCodeText(value: unknown): string {
  return String(value ?? "")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi, decodeEntity)
    .replace(/[\p{Cf}\uFEFF]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function validTimestamp(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    return null;
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 19) === value.slice(0, 19) ? parsed : null;
}

function maskRejectedStructures(text: string): string {
  const mask = (value: string) => " ".repeat(value.length);
  return text
    .replace(/https?:\/\/\S+/gi, mask)
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, mask)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, mask)
    .replace(/[$€£]\s*\d[\d,.]*/g, mask)
    .replace(/\b\d{1,4}[/-]\d{1,2}[/-]\d{1,4}\b/g, mask)
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?\b/gi, mask)
    .replace(/(?:\+?\d[\s().-]*){10,}/g, mask)
    .replace(/\b(?:order|tracking|claim|ticket|invoice)\s*(?:(?:number|no\.?|id)\s*)?[:#-]?\s*[A-Za-z0-9-]{4,}\b/gi, mask);
}

function classifyCandidate(code: string): Pick<Candidate, "kind" | "alphabeticHyphenated"> | null {
  if (/^\d{4,8}$/.test(code)) {
    return { kind: "numeric", alphabeticHyphenated: false };
  }
  if (/^[A-Za-z0-9]{4,12}$/.test(code) && /[A-Za-z]/.test(code) && /\d/.test(code)) {
    return { kind: "alphanumeric", alphabeticHyphenated: false };
  }
  if (/^[A-Za-z0-9]{3,4}(?:-[A-Za-z0-9]{3,4}){1,3}$/.test(code)) {
    return { kind: "hyphenated", alphabeticHyphenated: !/\d/.test(code) };
  }
  return null;
}

function candidatesIn(text: string): Candidate[] {
  const scanText = maskRejectedStructures(text);
  const candidates: Candidate[] = [];
  for (const match of scanText.matchAll(CANDIDATE_RE)) {
    const code = match[0];
    const classified = classifyCandidate(code);
    if (!classified || match.index == null) continue;
    candidates.push({
      code,
      ...classified,
      start: match.index,
      end: match.index + code.length,
    });
  }
  return candidates;
}

function scoreField(
  text: string,
  fieldBase: number,
  { allowBareCode }: { allowBareCode: boolean },
): ScoredCandidate[] {
  const candidates = candidatesIn(text);
  if (!candidates.length) return [];
  const markerRe = new RegExp(`\\b(?:${STRONG_MARKER_SOURCE})\\b${allowBareCode ? "|\\bcode\\b" : ""}`, "gi");
  const markers = [...text.matchAll(markerRe)];
  const scored: ScoredCandidate[] = [];

  for (const candidate of candidates) {
    let bestScore = -1;
    let direct = false;
    let strongMarker = false;
    for (const marker of markers) {
      if (marker.index == null) continue;
      const markerStart = marker.index;
      const markerEnd = markerStart + marker[0].length;
      const isStrongMarker = new RegExp(`^(?:${STRONG_MARKER_SOURCE})$`, "i").test(marker[0]);
      if (candidate.start >= markerEnd) {
        const distance = candidate.start - markerEnd;
        if (distance > 64) continue;
        const gap = text.slice(markerEnd, candidate.start);
        const isDirect = DIRECT_GAP_RE.test(gap)
          || (allowBareCode
            && marker[0].toLowerCase() === "code"
            && /^.{0,40}\b(?:login|sign[\s-]?in|verif(?:y|ication)|auth(?:enticate|entication))\s*:\s*$/i.test(gap));
        const score = fieldBase + Math.max(0, 20 - distance) + (isDirect ? 30 : 0);
        if (score > bestScore) {
          bestScore = score;
          direct = isDirect;
          strongMarker = isStrongMarker;
        }
      } else if (candidate.end <= markerStart) {
        const distance = markerStart - candidate.end;
        if (distance > 48) continue;
        const gap = text.slice(candidate.end, markerStart);
        const isDirect = LEADING_DIRECT_GAP_RE.test(gap)
          || (allowBareCode && /^\s*[-–—]/.test(gap));
        const score = fieldBase + Math.max(0, 20 - distance) + (isDirect ? 30 : 0);
        if (score > bestScore) {
          bestScore = score;
          direct = isDirect;
          strongMarker = isStrongMarker;
        }
      }
    }
    if (bestScore < 0 || !direct) continue;
    if (candidate.alphabeticHyphenated && (!direct || !strongMarker || bestScore < 105)) continue;
    scored.push({ code: candidate.code, kind: candidate.kind, score: bestScore });
  }
  return scored;
}

export function detectVerificationCode(input: VerificationCodeInput): VerificationCodeDetection | null {
  const timestamp = validTimestamp(input.emailTimestamp);
  if (!timestamp) return null;

  const subject = normalizeVerificationCodeText(input.subject);
  const snippet = normalizeVerificationCodeText(input.snippet);
  const bodyText = normalizeVerificationCodeText(input.bodyText);
  const subjectHasStrongMarker = new RegExp(`\\b(?:${STRONG_MARKER_SOURCE})\\b`, "i").test(subject);
  const matches = [
    ...scoreField(subject, 100, { allowBareCode: false }),
    ...scoreField(snippet, 70, { allowBareCode: subjectHasStrongMarker }),
    ...scoreField(bodyText, 60, { allowBareCode: subjectHasStrongMarker }),
  ];
  if (!matches.length) return null;

  const bestByCode = new Map<string, ScoredCandidate>();
  for (const match of matches) {
    const existing = bestByCode.get(match.code);
    if (!existing || match.score > existing.score) bestByCode.set(match.code, match);
  }
  const bestScore = Math.max(...[...bestByCode.values()].map((match) => match.score));
  const winners = [...bestByCode.values()].filter((match) => match.score === bestScore);
  if (winners.length !== 1) return null;

  const winner = winners[0]!;
  return {
    code: winner.code,
    kind: winner.kind,
    activeUntil: new Date(timestamp.getTime() + VERIFICATION_CODE_ACTIVE_WINDOW_MS).toISOString(),
    detectorVersion: VERIFICATION_CODE_DETECTOR_VERSION,
  };
}
