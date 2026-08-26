import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EmailPdfPreview from "./EmailPdfPreview";

const testState = vi.hoisted(() => ({
  getDocument: vi.fn(),
  getPage: vi.fn(),
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: testState.getDocument,
}));

vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "pdf-worker.js" }));

beforeEach(() => {
  class TestIntersectionObserver {
    private readonly callback: IntersectionObserverCallback;

    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
    }

    observe(target: Element) {
      this.callback([
        { isIntersecting: true, target } as IntersectionObserverEntry,
      ], this as unknown as IntersectionObserver);
    }

    disconnect() {}
    unobserve() {}
    takeRecords() { return []; }
  }

  vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
  testState.getPage.mockImplementation(async (pageNumber: number) => ({
    getViewport: ({ scale }: { scale: number }) => ({
      width: 600 * scale,
      height: 800 * scale,
    }),
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    getTextContent: async () => ({ items: [{ str: `Text from page ${pageNumber}` }] }),
  }));
  testState.getDocument.mockReturnValue({
    promise: Promise.resolve({ numPages: 3, getPage: testState.getPage }),
    destroy: vi.fn(),
  });

  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("EmailPdfPreview", () => {
  it("renders every page in one keyboard-scrollable preview without pagination controls", async () => {
    render(<EmailPdfPreview objectUrl="blob:guide" filename="guide.pdf" />);

    const preview = await screen.findByLabelText("Scrollable PDF preview of guide.pdf, 3 pages");
    expect(preview.getAttribute("tabindex")).toBe("0");
    expect((await screen.findByRole("document", { name: "Page 3 of guide.pdf" })).textContent)
      .toContain("Text from page 3");
    expect(screen.queryByRole("button", { name: "Previous page" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next page" })).toBeNull();
  });
});
