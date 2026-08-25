import { describe, expect, it } from "vitest";
import type { TldrawDocumentEnvelope, TldrawDocumentJson } from "../../../shared/types/tldraw";
import {
  resolveTldrawRecovery,
  type TldrawRecoveryDraft,
} from "./tldrawRecoveryModel";

const serverDocument: TldrawDocumentJson = {
  store: { "page:server": { id: "page:server", typeName: "page" } },
  schema: { schemaVersion: 2, sequences: {} },
};

function server(document: TldrawDocumentJson | null, revision = 4): TldrawDocumentEnvelope {
  return { document, revision, updatedAt: "2026-08-25T12:00:00.000Z" };
}

function draft({
  document = serverDocument,
  baseRevision = 4,
}: {
  document?: TldrawDocumentJson;
  baseRevision?: number;
} = {}): TldrawRecoveryDraft {
  return {
    version: 1,
    id: "draft-1",
    document,
    baseRevision,
    updatedAt: "2026-08-25T12:00:01.000Z",
  };
}

describe("resolveTldrawRecovery", () => {
  it("uses the server document when no local recovery exists", () => {
    expect(resolveTldrawRecovery(server(serverDocument), null)).toEqual({
      kind: "server",
      staleDraftId: null,
    });
  });

  it("clears a stale recovery envelope when its document already matches the server", () => {
    expect(resolveTldrawRecovery(server(serverDocument, 5), draft({ baseRevision: 4 }))).toEqual({
      kind: "server",
      staleDraftId: "draft-1",
    });
  });

  it("automatically recovers a local continuation of the current server revision", () => {
    const local = draft({
      document: { ...serverDocument, store: { "page:local": { id: "page:local", typeName: "page" } } },
    });
    expect(resolveTldrawRecovery(server(serverDocument), local)).toEqual({ kind: "recover", draft: local });
  });

  it("requires an explicit choice when local and server revisions diverge", () => {
    const local = draft({
      baseRevision: 3,
      document: { ...serverDocument, store: { "page:local": { id: "page:local", typeName: "page" } } },
    });
    expect(resolveTldrawRecovery(server(serverDocument), local)).toEqual({ kind: "conflict", draft: local });
  });
});

