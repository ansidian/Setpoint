import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import EmailRow from "./EmailRow";
import type { InboxEmailLike } from "./inboxTypes";

afterEach(() => cleanup());

function makeEmail(overrides: Partial<InboxEmailLike> = {}): InboxEmailLike {
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

type RenderRowOptions = Omit<Partial<ComponentProps<typeof EmailRow>>, "email"> & {
  email?: Partial<InboxEmailLike>;
};

function renderRow({ email = {}, ...props }: RenderRowOptions = {}) {
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
  it("shows no lane tag on desktop (prop absent)", () => {
    renderRow();
    expect(screen.queryByText("Needs Attention")).toBeNull();
  });

  it("uses the stored lane even when legacy untriaged metadata is present", () => {
    renderRow({ email: { _untriaged: true }, showLaneTag: true });
    expect(screen.getByText("Needs Attention")).toBeTruthy();
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

  it("does not render the default uncategorized pill", () => {
    renderRow({ email: { category: "uncategorized" } });
    expect(screen.queryByText("uncategorized")).toBeNull();
  });

  it("does not repeat the queued lane when the arrival-state badge already communicates it", () => {
    renderRow({ email: { _lane: "queued", _arrivalGraceQueued: true }, showLaneTag: true });
    expect(screen.getAllByText("Queued")).toHaveLength(1);
  });

  it("does not repeat the untriaged-read lane when the read-state badge already communicates it", () => {
    renderRow({ email: { _lane: "untriaged_read", _untriagedRead: true }, showLaneTag: true });
    expect(screen.getAllByText("Read")).toHaveLength(1);
    expect(screen.queryByText("Untriaged Read")).toBeNull();
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
});
