import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  getModels: vi.fn(),
}));

vi.mock("@/api", () => ({
  getModels: mockApi.getModels,
}));

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");

  function Select({ value, onValueChange, disabled, children }) {
    const childList = React.Children.toArray(children);
    const trigger = childList.find(
      (child) => React.isValidElement(child) && child.type?.displayName === "MockSelectTrigger",
    );
    const content = childList.find(
      (child) => React.isValidElement(child) && child.type?.displayName === "MockSelectContent",
    );
    const items = React.Children.toArray(content?.props?.children).filter(React.isValidElement);

    return (
      <select
        aria-label={trigger?.props?.["aria-label"]}
        className={trigger?.props?.className}
        disabled={disabled}
        value={value}
        onChange={(event) => onValueChange?.(event.target.value)}
      >
        {items.map((item) => (
          <option key={item.props.value} value={item.props.value} disabled={item.props.disabled}>
            {item.props.children}
          </option>
        ))}
      </select>
    );
  }

  function SelectTrigger() {
    return null;
  }
  SelectTrigger.displayName = "MockSelectTrigger";

  function SelectValue() {
    return null;
  }

  function SelectContent() {
    return null;
  }
  SelectContent.displayName = "MockSelectContent";

  function SelectItem() {
    return null;
  }

  return {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
  };
});

const { default: EmailAiModelCard } = await import("./EmailAiModelCard.jsx");

function renderCard({ initialSettings, patch = vi.fn() } = {}) {
  function Harness() {
    const [settings, setSettings] = useState(initialSettings || {
      email_ai_provider: "anthropic",
      email_ai_model: "claude-sonnet-4-6",
    });
    return <EmailAiModelCard settings={settings} setSettings={setSettings} patch={patch} />;
  }

  return {
    patch,
    ...render(<Harness />),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockApi.getModels.mockResolvedValue([
    {
      provider: "anthropic",
      label: "Anthropic",
      available: true,
      envVar: "ANTHROPIC_API_KEY",
      defaultModel: "claude-sonnet-4-6",
      models: [{ id: "claude-sonnet-4-6", label: "Sonnet 4.6" }],
    },
    {
      provider: "openai",
      label: "OpenAI",
      available: true,
      envVar: "OPENAI_API_KEY",
      defaultModel: "gpt-5.5",
      models: [
        { id: "gpt-5.5", label: "GPT-5.5" },
        { id: "gpt-5.4", label: "GPT-5.4" },
      ],
    },
  ]);
});

describe("EmailAiModelCard", () => {
  it("renders provider-aware email summary model controls", async () => {
    renderCard();

    await waitFor(() => {
      expect(mockApi.getModels).toHaveBeenCalled();
    });

    expect(screen.getByText("Email Snapshot AI")).toBeTruthy();
    expect(screen.getByText("Model used for email snapshot summaries and triage context. Bill extraction uses its own model.")).toBeTruthy();
    expect(screen.getByLabelText("Email snapshot provider")).toBeTruthy();
    expect(screen.getByLabelText("Email snapshot model")).toBeTruthy();
  });

  it("switches OpenAI to the current GPT-5.5 default", async () => {
    const patch = vi.fn();
    renderCard({ patch });

    await waitFor(() => {
      expect(mockApi.getModels).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText("Email snapshot provider"), {
      target: { value: "openai" },
    });

    await waitFor(() => {
      expect(patch).toHaveBeenLastCalledWith({
        email_ai_provider: "openai",
        email_ai_model: "gpt-5.5",
      });
    });

    expect(screen.getByLabelText("Email snapshot model").value).toBe("gpt-5.5");
  });
});
