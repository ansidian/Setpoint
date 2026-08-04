import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ProviderModelSelect from "./ProviderModelSelect";

const PROVIDERS = [
  {
    provider: "anthropic",
    label: "Anthropic",
    pricingUrl: "https://platform.claude.com/docs/en/about-claude/pricing",
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
    pricingUrl: "https://developers.openai.com/api/docs/pricing",
    available: true,
    defaultModel: "gpt-5.5",
    models: [
      { id: "gpt-5.5", label: "GPT-5.5" },
      { id: "gpt-5.4", label: "GPT-5.4" },
    ],
  },
];

afterEach(cleanup);

describe("ProviderModelSelect", () => {
  it("renders accessible provider and model controls with the selected labels", () => {
    render(
      <ProviderModelSelect
        providers={PROVIDERS}
        provider="anthropic"
        model="claude-haiku-4-5"
        onChange={() => {}}
        providerAriaLabel="AI provider"
        modelAriaLabel="AI model"
      />,
    );

    expect(screen.getByRole("combobox", { name: "AI provider" }).textContent).toContain("Anthropic");
    expect(screen.getByRole("combobox", { name: "AI model" }).textContent).toContain("Haiku 4.5");
  });

  it("disables both controls and exposes the selected provider pricing link", () => {
    render(
      <ProviderModelSelect
        providers={PROVIDERS}
        provider="openai"
        model="gpt-5.5"
        onChange={() => {}}
        providerAriaLabel="AI provider"
        modelAriaLabel="AI model"
        disabled
      />,
    );

    expect(screen.getByRole<HTMLButtonElement>("combobox", { name: "AI provider" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("combobox", { name: "AI model" }).disabled).toBe(true);
    const link = screen.getByRole("link", { name: "OpenAI API pricing (opens in a new tab)" });
    expect(link.getAttribute("href")).toBe("https://developers.openai.com/api/docs/pricing");
    expect(link.getAttribute("target")).toBe("_blank");
  });
});
