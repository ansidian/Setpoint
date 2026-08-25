import type {
  TldrawDocumentEnvelope,
  TldrawDocumentJson,
} from "../../../shared/types/tldraw";

export const TLDRAW_RECOVERY_VERSION = 1;

export type TldrawRecoveryDraft = {
  version: typeof TLDRAW_RECOVERY_VERSION;
  id: string;
  document: TldrawDocumentJson;
  baseRevision: number;
  updatedAt: string;
};

export type TldrawRecoveryResolution =
  | { kind: "server"; staleDraftId: string | null }
  | { kind: "recover"; draft: TldrawRecoveryDraft }
  | { kind: "conflict"; draft: TldrawRecoveryDraft };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDocument(value: unknown): value is TldrawDocumentJson {
  return isRecord(value) && isRecord(value.store) && isRecord(value.schema);
}

export function isTldrawRecoveryDraft(value: unknown): value is TldrawRecoveryDraft {
  if (!isRecord(value)) return false;
  return value.version === TLDRAW_RECOVERY_VERSION
    && typeof value.id === "string"
    && value.id.length > 0
    && isDocument(value.document)
    && Number.isSafeInteger(value.baseRevision)
    && Number(value.baseRevision) >= 0
    && typeof value.updatedAt === "string"
    && value.updatedAt.length > 0;
}

function documentsMatch(
  left: TldrawDocumentJson | null,
  right: TldrawDocumentJson,
): boolean {
  return left !== null && JSON.stringify(left) === JSON.stringify(right);
}

export function resolveTldrawRecovery(
  server: TldrawDocumentEnvelope,
  draft: TldrawRecoveryDraft | null,
): TldrawRecoveryResolution {
  if (!draft) return { kind: "server", staleDraftId: null };
  if (documentsMatch(server.document, draft.document)) {
    return { kind: "server", staleDraftId: draft.id };
  }
  if (draft.baseRevision === server.revision) return { kind: "recover", draft };
  return { kind: "conflict", draft };
}

