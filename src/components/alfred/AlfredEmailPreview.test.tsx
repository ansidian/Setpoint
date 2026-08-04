import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AlfredEmailPreview from "./AlfredEmailPreview";

const item = (uid: string) => ({
  uid,
  subject: "Your Mercury policy documents",
  from: { name: "Mercury Online", address: "no_reply@mercuryinsurance.com" },
  email_date: "2026-02-26T17:30:00.000Z",
  body_snippet: "Snippet fallback text",
});

let bodyResponse: Response;

beforeEach(() => {
  bodyResponse = new Response(JSON.stringify({ body: "Full body text" }), { status: 200, headers: { "content-type": "application/json" } });
  vi.stubGlobal("fetch", async () => bodyResponse);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function PreviewHarness({ uid }: { uid: string }) {
  const [open, setOpen] = useState(true);
  return <>{open ? <AlfredEmailPreview item={item(uid)} onClose={() => setOpen(false)} /> : null}<output>{open ? "open" : "closed"}</output></>;
}

describe("AlfredEmailPreview", () => {
  it("renders the header and the fetched body", async () => {
    render(<AlfredEmailPreview item={item("body-1")} onClose={() => {}} />);
    expect(screen.getByText("Your Mercury policy documents")).toBeTruthy();
    expect(screen.getByText(/Mercury Online/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Full body text")).toBeTruthy());
  });

  it("falls back to the chip snippet when the stored body is gone", async () => {
    bodyResponse = new Response(JSON.stringify({ message: "not found" }), { status: 404, headers: { "content-type": "application/json" } });
    render(<AlfredEmailPreview item={item("missing-1")} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Snippet fallback text")).toBeTruthy());
  });

  it("exposes the absolute received date as a tooltip on the header", () => {
    render(<AlfredEmailPreview item={item("date-1")} onClose={() => {}} />);
    expect(screen.getByTitle(/Received .*2026/)).toBeTruthy();
  });

  it("closes on pointerdown outside the preview, not inside it", () => {
    render(<PreviewHarness uid="dismiss-1" />);
    fireEvent.pointerDown(screen.getByRole("dialog", { name: "Email preview" }));
    expect(screen.getByText("open")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.getByText("closed")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Email preview" })).toBeNull();
  });
});
