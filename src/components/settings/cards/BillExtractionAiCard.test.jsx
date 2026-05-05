import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  getBillExtractModels: vi.fn(),
}));

vi.mock("@/api", () => ({
  getBillExtractModels: mockApi.getBillExtractModels,
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

const { default: BillExtractionAiCard } = await import("./BillExtractionAiCard.jsx");

function renderCard({ initialSettings, patch = vi.fn() } = {}) {
  function Harness() {
    const [settings, setSettings] = useState(initialSettings || {
      bill_extract_provider: "anthropic",
      bill_extract_model: "claude-haiku-4-5",
    });
    return <BillExtractionAiCard settings={settings} setSettings={setSettings} patch={patch} />;
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
  mockApi.getBillExtractModels.mockResolvedValue([
    {
      provider: "anthropic",
      label: "Anthropic",
      available: true,
      envVar: "ANTHROPIC_API_KEY",
      defaultModel: "claude-haiku-4-5",
      models: [{ id: "claude-haiku-4-5", label: "Haiku 4.5" }],
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

describe("BillExtractionAiCard", () => {
  it("renders provider and model as labeled peer fields", async () => {
    renderCard();

    await waitFor(() => {
      expect(mockApi.getBillExtractModels).toHaveBeenCalled();
    });

    expect(screen.getByText("Provider")).toBeTruthy();
    expect(screen.getByText("Model")).toBeTruthy();
    expect(screen.getByText("Model used to extract payee, amount, due date, and category from bill emails. Runs separately from the email snapshot model.")).toBeTruthy();
    expect(screen.getByLabelText("Bill extraction provider")).toBeTruthy();
    expect(screen.getByLabelText("Bill extraction model")).toBeTruthy();
  });

  it("switches provider and resets the model to that provider's default", async () => {
    const patch = vi.fn();
    renderCard({ patch });

    await waitFor(() => {
      expect(mockApi.getBillExtractModels).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText("Bill extraction provider"), {
      target: { value: "openai" },
    });

    await waitFor(() => {
      expect(patch).toHaveBeenLastCalledWith({
        bill_extract_provider: "openai",
        bill_extract_model: "gpt-5.5",
      });
    });

    expect(screen.getByLabelText("Bill extraction model").value).toBe("gpt-5.5");
  });

  it("disables model selection and shows the env-var warning for an unavailable provider", async () => {
    mockApi.getBillExtractModels.mockResolvedValueOnce([
      {
        provider: "anthropic",
        label: "Anthropic",
        available: true,
        envVar: "ANTHROPIC_API_KEY",
        defaultModel: "claude-haiku-4-5",
        models: [{ id: "claude-haiku-4-5", label: "Haiku 4.5" }],
      },
      {
        provider: "openai",
        label: "OpenAI",
        available: false,
        envVar: "OPENAI_API_KEY",
        defaultModel: "gpt-5.5",
        models: [{ id: "gpt-5.5", label: "GPT-5.5" }],
      },
    ]);

    renderCard({
      initialSettings: {
        bill_extract_provider: "openai",
        bill_extract_model: "gpt-5.5",
      },
    });

    await screen.findByText("Set OPENAI_API_KEY");

    expect(screen.getByLabelText("Bill extraction model").disabled).toBe(true);
  });
});
