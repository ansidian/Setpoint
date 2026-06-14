import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EmailRow from "./EmailRow.jsx";
import { makeInboxEmail } from "./test-utils/inboxFixtures.js";

vi.mock("./primitives", () => ({
  Avatar: function AvatarMock() {
    return null;
  },
}));

function makePendingGraceRow(graceAtIso) {
  return makeInboxEmail({
    id: "security-pending",
    uid: "security-pending",
    subject: "New sign-in to your account",
    _untriaged: true,
    _resurfaced: false,
    _pendingSecurityGrace: true,
    _pendingSecurityGraceAt: Date.parse(graceAtIso),
  });
}

describe("EmailRow pending-security-grace label", () => {
  afterEach(cleanup);

  it("computes the countdown label live from nowTick, not a baked field", () => {
    const email = makePendingGraceRow("2026-05-03T16:05:00.000Z");

    const { rerender } = render(
      <EmailRow
        email={email}
        account={null}
        selected={false}
        onOpen={() => {}}
        density="default"
        showPreview
        accent="#89b4fa"
        nowTick={Date.parse("2026-05-03T16:03:30.000Z")}
      />,
    );
    // 90s before classification → "Classifying soon".
    expect(screen.getByText("Classifying soon")).toBeTruthy();

    // Advancing nowTick past the <1m boundary must change the rendered label —
    // proving it is derived in render rather than frozen at row-build time.
    rerender(
      <EmailRow
        email={email}
        account={null}
        selected={false}
        onOpen={() => {}}
        density="default"
        showPreview
        accent="#89b4fa"
        nowTick={Date.parse("2026-05-03T16:04:30.000Z")}
      />,
    );
    expect(screen.queryByText("Classifying soon")).toBeNull();
    expect(screen.getByText("Classifying in <1m")).toBeTruthy();
  });

  it("renders the static Live label for non-grace untriaged rows", () => {
    const email = makeInboxEmail({
      id: "live-1",
      uid: "live-1",
      _untriaged: true,
      _resurfaced: false,
      _pendingSecurityGrace: false,
    });

    render(
      <EmailRow
        email={email}
        account={null}
        selected={false}
        onOpen={() => {}}
        density="default"
        showPreview
        accent="#89b4fa"
        nowTick={Date.now()}
      />,
    );
    expect(screen.getByText("Live")).toBeTruthy();
  });
});
