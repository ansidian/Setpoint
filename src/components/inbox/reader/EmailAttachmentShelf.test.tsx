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
  it("shows files, filters inline CID assets, and keeps active formats download-only", () => {
    render(<EmailAttachmentShelf
      emailUid="gmail-message"
      attachments={[
        { id: "2", filename: "report.pdf", contentType: "application/pdf", size: 2048, inline: false },
        { id: "3", filename: "signature.png", contentType: "image/png", inline: true },
        { id: "4", filename: "notes.html", contentType: "text/html", size: 512, inline: false },
      ]}
    />);

    expect(screen.getByLabelText("2 email attachments")).toBeTruthy();
    expect(screen.getByText("report.pdf")).toBeTruthy();
    expect(screen.getByText("notes.html")).toBeTruthy();
    expect(screen.queryByText("signature.png")).toBeNull();
    expect(screen.getByRole("button", { name: "View report.pdf" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "View notes.html" })).toBeNull();
    expect(screen.getByRole("link", { name: "Download notes.html" }).getAttribute("href"))
      .toBe("/attachment/gmail-message/4");
  });

  it("opens a safe preview, closes with Escape, and restores focus", async () => {
    render(<EmailAttachmentShelf
      emailUid="gmail-message"
      attachments={[
        { id: "2", filename: "scan.png", contentType: "image/png", size: 2048, inline: false },
      ]}
    />);

    const trigger = screen.getByRole("button", { name: "View scan.png" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "scan.png" })).toBeTruthy();
    const previewImage = await screen.findByAltText("scan.png");
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

  it("surfaces a failed download without leaving the reader", async () => {
    testState.fetchEmailAttachmentBlob.mockRejectedValueOnce(new Error("too large"));
    render(<EmailAttachmentShelf
      emailUid="gmail-message"
      attachments={[
        { id: "4", filename: "archive.zip", contentType: "application/zip", size: 2048, inline: false },
      ]}
    />);

    fireEvent.click(screen.getByRole("link", { name: "Download archive.zip" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Could not download archive.zip. Try again.");
  });
});
