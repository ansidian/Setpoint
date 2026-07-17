import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/settings/cards/ApiTokensCard", () => ({
  default: function ApiTokensCardMock() {
    return <div data-testid="api-tokens-card" />;
  },
}));
vi.mock("@/components/settings/cards/PasskeysCard", () => ({
  default: function PasskeysCardMock() {
    return <div data-testid="passkeys-card" />;
  },
}));

const { default: SystemSettingsSection } = await import("./SystemSettingsSection");

afterEach(() => {
  cleanup();
});

describe("SystemSettingsSection", () => {
  it("does not render embedding or vector-search status", () => {
    render(
      <SystemSettingsSection />,
    );

    expect(screen.getByTestId("api-tokens-card")).toBeTruthy();
    expect(screen.getByTestId("passkeys-card")).toBeTruthy();
    expect(screen.queryByText("Bill Extraction AI")).toBeNull();
    expect(screen.queryByText("Email Triage Automation")).toBeNull();
    expect(screen.queryByText("Search & Historical Context")).toBeNull();
    expect(screen.queryByText("OpenAI embeddings")).toBeNull();
    expect(screen.queryByText("Indexed chunks")).toBeNull();
    expect(screen.queryByText("Set OPENAI_API_KEY")).toBeNull();
  });
});
