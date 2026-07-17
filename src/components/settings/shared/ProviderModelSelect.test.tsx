import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/select", () => import("./selectMock.test-utils"));

const { default: ProviderModelSelect } = await import("./ProviderModelSelect");

const PROVIDERS = [
  {
    provider: "anthropic",
    label: "Anthropic",
    available: true,
    defaultModel: "claude-sonnet-4-6",
    models: [
      { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
      { id: "claude-haiku-4-5", label: "Haiku 4.5" },
    ],
  },
  {
    provider: "openai",
    label: "OpenAI",
    available: true,
    defaultModel: "gpt-5.5",
    models: [
      { id: "gpt-5.5", label: "GPT-5.5" },
      { id: "gpt-5.4", label: "GPT-5.4" },
    ],
  },
];

function renderSelect(overrides = {}) {
  const onChange = vi.fn();
  render(
    <ProviderModelSelect
      providers={PROVIDERS}
      provider="anthropic"
      model="claude-sonnet-4-6"
      onChange={onChange}
      providerAriaLabel="AI provider"
      modelAriaLabel="AI model"
      {...overrides}
    />,
  );
  return { onChange };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProviderModelSelect", () => {
  it("switching provider resets to that provider's default model", () => {
    const { onChange } = renderSelect();

    fireEvent.change(screen.getByLabelText("AI provider"), {
      target: { value: "openai" },
    });

    expect(onChange).toHaveBeenCalledWith("openai", "gpt-5.5");
  });

  it("falls back to the provider default when the model id is not in the provider", () => {
    renderSelect({ provider: "anthropic", model: "gpt-5.5" });

    // gpt-5.5 is not an Anthropic model, so the displayed value falls back to the default.
    expect(screen.getByLabelText<HTMLSelectElement>("AI model").value).toBe("claude-sonnet-4-6");
  });

  it("keeps the current model id when it belongs to the selected provider", () => {
    renderSelect({ provider: "anthropic", model: "claude-haiku-4-5" });

    expect(screen.getByLabelText<HTMLSelectElement>("AI model").value).toBe("claude-haiku-4-5");
  });

  it("disables the model select when the selected provider is unavailable", () => {
    const providers = [
      PROVIDERS[0],
      { ...PROVIDERS[1], available: false },
    ];
    renderSelect({ providers, provider: "openai", model: "gpt-5.5" });

    expect(screen.getByLabelText<HTMLSelectElement>("AI model").disabled).toBe(true);
  });

  it("passes the current provider through when only the model changes", () => {
    const { onChange } = renderSelect({ provider: "openai", model: "gpt-5.5" });

    fireEvent.change(screen.getByLabelText("AI model"), {
      target: { value: "gpt-5.4" },
    });

    expect(onChange).toHaveBeenCalledWith("openai", "gpt-5.4");
  });

  it("falls back to the first provider when the provided provider is unknown", () => {
    const { onChange } = renderSelect({ provider: "mystery", model: "whatever" });

    // selected provider resolves to the first entry (anthropic) and its default model.
    expect(screen.getByLabelText<HTMLSelectElement>("AI provider").value).toBe("anthropic");
    expect(screen.getByLabelText<HTMLSelectElement>("AI model").value).toBe("claude-sonnet-4-6");

    // changeModel routes back through the resolved provider, not the bad input.
    fireEvent.change(screen.getByLabelText("AI model"), {
      target: { value: "claude-haiku-4-5" },
    });
    expect(onChange).toHaveBeenCalledWith("anthropic", "claude-haiku-4-5");
  });

  it("disables both selects when disabled is set", () => {
    renderSelect({ disabled: true });

    expect(screen.getByLabelText<HTMLSelectElement>("AI provider").disabled).toBe(true);
    expect(screen.getByLabelText<HTMLSelectElement>("AI model").disabled).toBe(true);
  });
});
