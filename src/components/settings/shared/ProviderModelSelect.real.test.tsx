import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProviderModelSelect from "./ProviderModelSelect";

afterEach(cleanup);

describe("ProviderModelSelect with Base UI", () => {
  it("renders friendly provider and model labels in closed triggers", () => {
    render(
      <ProviderModelSelect
        providers={[
          {
            provider: "openai",
            label: "OpenAI",
            available: true,
            defaultModel: "gpt-5.6-sol",
            models: [{ id: "gpt-5.6-sol", label: "GPT-5.6 Sol" }],
          },
        ]}
        provider="openai"
        model="gpt-5.6-sol"
        onChange={vi.fn()}
        providerAriaLabel="AI provider"
        modelAriaLabel="AI model"
      />,
    );

    expect(screen.getByLabelText("AI provider").textContent).toContain("OpenAI");
    expect(screen.getByLabelText("AI provider").textContent).not.toContain("openai");
    expect(screen.getByLabelText("AI model").textContent).toContain("GPT-5.6 Sol");
  });
});
