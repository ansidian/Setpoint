import { afterEach, describe, expect, it, vi } from "vitest";

async function importApi() {
  vi.resetModules();
  vi.stubEnv("VITE_EA_DEMO", "");
  return import("./api.js");
}

function okJson(body, status = 200) {
  return {
    ok: true,
    status,
    json: vi.fn().mockResolvedValue(body),
  };
}

describe("deadline mutation API helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("returns the deadline object from calendar deadline mutation envelopes", async () => {
    const created = {
      id: "td-new",
      title: "Call dentist",
      due_date: "2026-04-20",
      due_time: "10:00 AM",
    };
    const updated = {
      id: "td-new",
      title: "Call dentist updated",
      due_date: "2026-04-20",
      due_time: "11:00 AM",
    };
    const fetch = vi.fn()
      .mockResolvedValueOnce(okJson({ deadline: created }, 201))
      .mockResolvedValueOnce(okJson({ deadline: updated }));
    vi.stubGlobal("fetch", fetch);

    const api = await importApi();

    await expect(api.createDeadline({ title: "Call dentist" })).resolves.toEqual(created);
    await expect(api.updateDeadline("td-new", { title: "Call dentist updated" })).resolves.toEqual(updated);
  });
});
