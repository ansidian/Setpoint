import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/settings/cards/EmailTriageModeCard", () => ({
  default: function EmailTriageModeCardMock() {
    return <div data-testid="email-triage-mode-card" />;
  },
}));

vi.mock("@/components/settings/cards/EmailAiModelCard", () => ({
  default: function EmailAiModelCardMock() {
    return <div data-testid="email-ai-model-card" />;
  },
}));

vi.mock("@/components/settings/cards/BillExtractionAiCard", () => ({
  default: function BillExtractionAiCardMock() {
    return <div data-testid="bill-extraction-card" />;
  },
}));

vi.mock("@/components/settings/cards/ImportantSendersCard", () => ({
  default: function ImportantSendersCardMock() {
    return <div data-testid="important-senders-card" />;
  },
}));

vi.mock("@/components/settings/cards/BriefingSchedulesCard", () => ({
  default: function BriefingSchedulesCardMock() {
    return <div data-testid="snapshot-boundaries-card" />;
  },
}));

const { default: EmailAutomationSettingsSection } = await import("./EmailAutomationSettingsSection.jsx");

afterEach(() => {
  cleanup();
});

describe("EmailAutomationSettingsSection", () => {
  it("groups email automation controls in the agreed order", () => {
    render(
      <EmailAutomationSettingsSection
        settings={{ email_interests: [] }}
        setSettings={vi.fn()}
        patch={vi.fn()}
      />,
    );

    const orderedElements = [
      screen.getByTestId("email-triage-mode-card"),
      screen.getByTestId("email-ai-model-card"),
      screen.getByTestId("bill-extraction-card"),
      screen.getByText("Email Lookback").closest("[data-settings-section]"),
      screen.getByText("Email Interests").closest("[data-settings-section]"),
      screen.getByTestId("important-senders-card"),
      screen.getByTestId("snapshot-boundaries-card"),
    ];

    expect(orderedElements.every(Boolean)).toBe(true);

    for (let index = 1; index < orderedElements.length; index += 1) {
      const previous = orderedElements[index - 1];
      const current = orderedElements[index];
      expect(previous.compareDocumentPosition(current)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }

    expect(screen.getByText("Controls how far back the email snapshot looks when gathering context.")).toBeTruthy();
    expect(screen.queryByText(/generation/i)).toBeNull();
  });
});
