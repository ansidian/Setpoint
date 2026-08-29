import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EmailAttachmentShelf from "./EmailAttachmentShelf";

const testState = vi.hoisted(() => ({ fetchEmailAttachmentBlob: vi.fn() }));

// test-architecture: allow-boundary-mock -- Attachment preview bytes cross the authenticated browser HTTP boundary; the shelf test controls that response while exercising the real preview lifecycle.
vi.mock("../../../api", () => ({
  fetchEmailAttachmentBlob: testState.fetchEmailAttachmentBlob,
  getEmailAttachmentUrl: (uid: string, attachmentId: string) => `/attachment/${uid}/${attachmentId}`,
}));

beforeEach(() => {
  testState.fetchEmailAttachmentBlob.mockResolvedValue(new Blob(["image-test"], { type: "image/png" }));
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:attachment-preview"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EmailAttachmentShelf", () => {
  it("opens a safe preview, closes with Escape, and restores focus", async () => {
    render(<EmailAttachmentShelf
      emailUid="gmail-message"
      attachments={[
        { id: "2", filename: "scan.png", contentType: "image/png", size: 2048, inline: false },
      ]}
    />);

    const trigger = screen.getByRole("button", { name: "Preview scan.png" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "scan.png" })).toBeTruthy();
    const previewImage = await screen.findByAltText("scan.png");
    const fitButton = screen.getByRole("button", { name: "Fit image to window" });
    expect((fitButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("125%")).toBeTruthy();
    expect((fitButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(fitButton);
    expect((fitButton as HTMLButtonElement).disabled).toBe(true);
    // test-architecture: allow-boundary-interaction -- Preview bytes cross the authenticated browser HTTP boundary; the selected message/part and abort signal are the outbound contract.
    expect(testState.fetchEmailAttachmentBlob).toHaveBeenCalledWith("gmail-message", "2", expect.any(AbortSignal));

    fireEvent.error(previewImage);
    expect(screen.getByRole("alert").textContent).toContain("This image could not be rendered");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "scan.png" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    // test-architecture: allow-boundary-interaction -- Object URL revocation is a browser resource-lifecycle boundary with no remaining rendered state after the modal closes.
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:attachment-preview");
  });

  it("keeps oversized CSV files download-only inside the preview", async () => {
    render(<EmailAttachmentShelf
      emailUid="gmail-message"
      attachments={[
        { id: "5", filename: "large.csv", contentType: "text/csv", size: 5 * 1024 * 1024 + 1, inline: false },
      ]}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Preview large.csv" }));

    expect((await screen.findByRole("alert")).textContent).toContain("larger than 5 MB");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    // test-architecture: allow-boundary-interaction -- The declared-size guard must prevent the authenticated attachment HTTP request for CSV files outside the preview bound.
    expect(testState.fetchEmailAttachmentBlob).not.toHaveBeenCalled();
  });

});
