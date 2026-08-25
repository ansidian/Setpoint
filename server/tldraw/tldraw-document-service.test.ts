import { afterEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { createMigratedDb } from "../triage/triage-worker.test-utils.ts";
import {
  createTldrawDocumentService,
  TldrawDocumentConflictError,
} from "./tldraw-document-service.ts";

const documents = {
  store: { "page:page": { id: "page:page", typeName: "page", name: "Ideas" } },
  schema: { schemaVersion: 2, sequences: {} },
};

let client: Client | null = null;

afterEach(async () => {
  client?.close();
  client = null;
});

describe("tldraw document service", () => {
  it("stores a snapshot and skips unchanged writes without advancing revision", async () => {
    client = await createMigratedDb();
    const service = createTldrawDocumentService(client);

    const first = await service.saveDocument("owner", documents, 0, new Date("2026-08-25T12:00:00.000Z"));
    const unchanged = await service.saveDocument("owner", documents, first.revision, new Date("2026-08-25T12:01:00.000Z"));
    expect(first).toEqual({ revision: 1, updatedAt: "2026-08-25T12:00:00.000Z", unchanged: false });
    expect(unchanged).toEqual({ revision: 1, updatedAt: "2026-08-25T12:00:00.000Z", unchanged: true });
    await expect(service.getDocument("owner")).resolves.toEqual({
      document: documents,
      revision: 1,
      updatedAt: "2026-08-25T12:00:00.000Z",
    });
  });

  it("rejects a stale second device instead of overwriting the newer canvas", async () => {
    client = await createMigratedDb();
    const service = createTldrawDocumentService(client);
    await service.saveDocument("owner", documents, 0);
    await service.saveDocument("owner", {
      ...documents,
      store: { ...documents.store, "shape:new": { id: "shape:new", typeName: "shape" } },
    }, 1);

    await expect(service.saveDocument("owner", documents, 1)).rejects.toBeInstanceOf(TldrawDocumentConflictError);
    await expect(service.getDocument("owner")).resolves.toMatchObject({ revision: 2 });
  });
});
