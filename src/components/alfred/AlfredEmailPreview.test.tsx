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

beforeEach(() => {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ body: "Full body text" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
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
  it("closes on a backdrop click, not a click inside the preview", async () => {
    render(<PreviewHarness uid="dismiss-1" />);
    fireEvent.click(screen.getByRole("dialog", { name: "Email preview" }));
    expect(screen.getByText("open")).toBeTruthy();
    const backdrop = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')!;
    fireEvent.pointerDown(backdrop, { button: 0, pointerType: "mouse" });
    fireEvent.mouseDown(backdrop, { button: 0 });
    fireEvent.pointerUp(backdrop, { button: 0, pointerType: "mouse" });
    fireEvent.mouseUp(backdrop, { button: 0 });
    fireEvent.click(backdrop);
    await waitFor(() => expect(screen.getByText("closed")).toBeTruthy());
    expect(screen.queryByRole("dialog", { name: "Email preview" })).toBeNull();
  });
});
