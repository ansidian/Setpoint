import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EmailRow from "./EmailRow.jsx";

afterEach(() => cleanup());

function makeEmail(overrides = {}) {
  return {
    id: "m1", uid: "m1",
    from: "Stripe", fromEmail: "billing@stripe.com",
    subject: "Invoice #1042 — payment due",
    date: "2026-06-24T12:00:00.000Z",
    _lane: "needs_attention",
    read: false,
    ...overrides,
  };
}

function renderRow({ email = {}, ...props } = {}) {
  return render(
    <EmailRow
      email={makeEmail(email)}
      onOpen={vi.fn()}
      density="comfortable"
      accent="#cba6da"
      {...props}
    />,
  );
}

describe("EmailRow lane tag (mobile)", () => {
  it("shows the lane label when showLaneTag is set on a triaged row", () => {
    renderRow({ showLaneTag: true });
    expect(screen.getByText("Needs Attention")).toBeTruthy();
  });

  it("shows no lane tag on desktop (prop absent)", () => {
    renderRow();
    expect(screen.queryByText("Needs Attention")).toBeNull();
  });

  it("suppresses the lane tag on untriaged (live) rows", () => {
    renderRow({ email: { _untriaged: true }, showLaneTag: true });
    expect(screen.queryByText("Needs Attention")).toBeNull();
  });

  it("replaces the category pill with the lane tag when showLaneTag is set", () => {
    renderRow({ email: { category: "finance" }, showLaneTag: true });
    expect(screen.getByText("Needs Attention")).toBeTruthy();
    expect(screen.queryByText("finance")).toBeNull();
  });

  it("still renders the category pill on desktop", () => {
    renderRow({ email: { category: "finance" } });
    expect(screen.getByText("finance")).toBeTruthy();
  });
});

describe("EmailRow pinned", () => {
  it("renders a pin glyph when the email is pinned", () => {
    renderRow({ email: { _pinned: true } });
    expect(screen.getByTestId("email-row-pin")).toBeTruthy();
  });

  it("renders no pin glyph when the email is not pinned", () => {
    renderRow();
    expect(screen.queryByTestId("email-row-pin")).toBeNull();
  });

  it("applies a muted treatment when a pinned email was provider-removed", () => {
    const { container } = renderRow({ email: { _pinned: true, _providerRemoved: true } });
    const row = container.querySelector('[role="button"]');
    expect(row.style.opacity).toBe("0.55");
  });
});
