import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getEmailBody: vi.fn(),
  peekEmailBody: vi.fn(() => null),
}));
vi.mock("../../api", () => api);

const { default: AlfredEmailPreview } = await import("./AlfredEmailPreview.jsx");

const item = {
  uid: "m1",
  subject: "Your Mercury policy documents",
  from: { name: "Mercury Online", address: "no_reply@mercuryinsurance.com" },
  email_date: "2026-02-26T17:30:00.000Z",
  body_snippet: "Snippet fallback text",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AlfredEmailPreview", () => {
  it("renders the header and the fetched body", async () => {
    api.getEmailBody.mockResolvedValue({ body: "Full body text" });
    render(<AlfredEmailPreview item={item} onClose={() => {}} />);
    expect(screen.getByText("Your Mercury policy documents")).toBeTruthy();
    expect(screen.getByText(/Mercury Online/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Full body text")).toBeTruthy());
    expect(api.getEmailBody).toHaveBeenCalledWith("m1");
  });

  it("falls back to the chip snippet when the stored body is gone", async () => {
    api.getEmailBody.mockRejectedValue(Object.assign(new Error("not found"), { status: 404 }));
    render(<AlfredEmailPreview item={item} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Snippet fallback text")).toBeTruthy());
  });

  it("exposes the absolute received date as a tooltip on the header", () => {
    api.getEmailBody.mockResolvedValue({ body: "Body" });
    render(<AlfredEmailPreview item={item} onClose={() => {}} />);
    expect(screen.getByTitle(/Received .*2026/)).toBeTruthy();
  });

  it("closes on pointerdown outside the preview, not inside it", () => {
    api.getEmailBody.mockResolvedValue({ body: "Body" });
    const onClose = vi.fn();
    render(<AlfredEmailPreview item={item} onClose={onClose} />);
    fireEvent.pointerDown(screen.getByRole("dialog", { name: "Email preview" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
