import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChunkLoadBoundary from "./ChunkLoadBoundary";
import {
  CHUNK_RELOAD_STORAGE_KEY,
  isDynamicImportLoadError,
} from "./chunkLoadRecovery";

function ThrowError({ error }: { error: Error }): never {
  throw error;
}

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("ChunkLoadBoundary", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    consoleError.mockRestore();
  });

  it("recognizes browser dynamic import failures", () => {
    expect(isDynamicImportLoadError(new TypeError("Failed to fetch dynamically imported module: https://dashboard.example.com/assets/CalendarModal-old.js"))).toBe(true);
    expect(isDynamicImportLoadError(new Error("Loading chunk 12 failed."))).toBe(true);
    expect(isDynamicImportLoadError(new Error("ordinary render failure"))).toBe(false);
  });

  it("reloads once when a lazy chunk fails to load", async () => {
    const reloadPage = vi.fn();
    const storage = createStorage();

    render(
      <ChunkLoadBoundary reloadPage={reloadPage} storage={storage} now={() => 1000}>
        <ThrowError error={new TypeError("Failed to fetch dynamically imported module: https://dashboard.example.com/assets/CalendarModal-old.js")} />
      </ChunkLoadBoundary>,
    );

    // test-architecture: allow-boundary-interaction -- Browser page replacement has no post-navigation DOM result; automatic chunk recovery must cross the reload boundary exactly once.
    await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
    expect(storage.getItem(CHUNK_RELOAD_STORAGE_KEY)).toBe("1000");
    expect(screen.getByRole("alert").textContent).toContain("Reload Setpoint");
  });

  it("shows a manual reload action when automatic reload was already attempted recently", () => {
    const reloadPage = vi.fn();
    const storage = createStorage();
    storage.setItem(CHUNK_RELOAD_STORAGE_KEY, "1000");

    render(
      <ChunkLoadBoundary reloadPage={reloadPage} storage={storage} now={() => 2000}>
        <ThrowError error={new Error("Importing a module script failed.")} />
      </ChunkLoadBoundary>,
    );

    // test-architecture: allow-boundary-interaction -- Preventing a browser reload loop is a negative navigation-boundary contract that cannot be inferred from the retained fallback DOM.
    expect(reloadPage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reload app" }));

    // test-architecture: allow-boundary-interaction -- The manual recovery control must cross the browser reload boundary, whose successful page replacement cannot be observed in this document.
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });
});
