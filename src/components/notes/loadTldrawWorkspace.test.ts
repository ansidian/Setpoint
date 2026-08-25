import { describe, expect, it } from "vitest";
import type { TldrawBootstrapResponse } from "../../../shared/types/tldraw";
import { loadTldrawWorkspace } from "./loadTldrawWorkspace";

function bootstrap(revision: number): TldrawBootstrapResponse {
  return {
    licenseKey: null,
    licenseRequired: false,
    document: {
      document: {
        store: { [`page:${revision}`]: { id: `page:${revision}`, typeName: "page" } },
        schema: { schemaVersion: 2, sequences: {} },
      },
      revision,
      updatedAt: "2026-08-25T12:00:00.000Z",
    },
  };
}

describe("loadTldrawWorkspace", () => {
  it("fetches a fresh server bootstrap for every route mount", async () => {
    const responses = [bootstrap(3), bootstrap(4)];
    let bootstrapReads = 0;
    const getBootstrap = async () => responses[bootstrapReads++]!;
    const recoveryStore = {
      read: async () => null,
      clearIfCurrent: async () => false,
    };

    const first = await loadTldrawWorkspace({ getBootstrap, recoveryStore });
    const second = await loadTldrawWorkspace({ getBootstrap, recoveryStore });

    expect(first.response.document.revision).toBe(3);
    expect(second.response.document.revision).toBe(4);
    expect(bootstrapReads).toBe(2);
  });

  it("does not open the server canvas when local recovery cannot be checked", async () => {
    await expect(loadTldrawWorkspace({
      getBootstrap: async () => bootstrap(3),
      recoveryStore: {
        read: async () => { throw new Error("IndexedDB is unavailable"); },
        clearIfCurrent: async () => false,
      },
    })).rejects.toThrow("IndexedDB is unavailable");
  });
});
