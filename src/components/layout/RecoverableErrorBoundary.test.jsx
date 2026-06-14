import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RecoverableErrorBoundary from "./RecoverableErrorBoundary.jsx";

function ThrowError({ error }) {
  throw error;
}

describe("RecoverableErrorBoundary", () => {
  let consoleError;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    consoleError.mockRestore();
  });

  it("renders a recoverable fallback instead of unmounting the tree on a render error", () => {
    render(
      <RecoverableErrorBoundary>
        <ThrowError error={new Error("boom")} />
      </RecoverableErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("This view hit an error")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload app" })).toBeTruthy();
  });

  it("recovers when 'Try again' is clicked and the child no longer throws", () => {
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error("boom");
      return <div>recovered content</div>;
    }

    render(
      <RecoverableErrorBoundary>
        <Flaky />
      </RecoverableErrorBoundary>,
    );
    expect(screen.getByText("This view hit an error")).toBeTruthy();

    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("recovered content")).toBeTruthy();
  });

  it("re-throws dynamic-import load errors so the outer ChunkLoadBoundary can drive its reload", () => {
    const chunkError = new Error("Loading chunk 12 failed.");
    expect(() =>
      render(
        <RecoverableErrorBoundary>
          <ThrowError error={chunkError} />
        </RecoverableErrorBoundary>,
      ),
    ).toThrow(/Loading chunk/);
  });
});
