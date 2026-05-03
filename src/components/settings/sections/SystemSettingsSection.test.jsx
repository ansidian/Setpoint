import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/settings/cards/BillExtractionAiCard", () => ({
  default: function BillExtractionAiCardMock() {
    return <div data-testid="bill-extraction-card" />;
  },
}));

vi.mock("@/components/settings/cards/ApiTokensCard", () => ({
  default: function ApiTokensCardMock() {
    return <div data-testid="api-tokens-card" />;
  },
}));

const { default: SystemSettingsSection } = await import("./SystemSettingsSection.jsx");

afterEach(() => {
  cleanup();
});

describe("SystemSettingsSection", () => {
  it("does not render retired embedding or vector-search status", () => {
    render(
      <SystemSettingsSection
        settings={{ openai_available: false, embedding_count: 12 }}
        setSettings={vi.fn()}
        patch={vi.fn()}
      />,
    );

    expect(screen.getByTestId("bill-extraction-card")).toBeTruthy();
    expect(screen.getByTestId("api-tokens-card")).toBeTruthy();
    expect(screen.queryByText("Search & Historical Context")).toBeNull();
    expect(screen.queryByText("OpenAI embeddings")).toBeNull();
    expect(screen.queryByText("Indexed chunks")).toBeNull();
    expect(screen.queryByText("Set OPENAI_API_KEY")).toBeNull();
  });
});
