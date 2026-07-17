export const BILL_EXTRACT_CATALOG = [
  {
    provider: "anthropic",
    label: "Anthropic",
    envVar: "ANTHROPIC_API_KEY",
    defaultModel: "claude-haiku-4-5",
    models: [
      { id: "claude-haiku-4-5", label: "Haiku 4.5" },
    ],
  },
  {
    provider: "openai",
    label: "OpenAI",
    envVar: "OPENAI_API_KEY",
    defaultModel: "gpt-5.5",
    models: [
      { id: "gpt-5.5", label: "GPT-5.5" },
      { id: "gpt-5.4", label: "GPT-5.4" },
      { id: "gpt-5.4-mini", label: "GPT-5.4 mini" },
      { id: "gpt-5.4-nano", label: "GPT-5.4 nano" },
    ],
  },
];

export const DEFAULT_BILL_EXTRACT_PROVIDER = "anthropic";
export const DEFAULT_BILL_EXTRACT_MODEL = "claude-haiku-4-5";

export function isAllowedBillExtractModel(provider: unknown, model: unknown): boolean {
  const entry = BILL_EXTRACT_CATALOG.find((p) => p.provider === provider);
  if (!entry) return false;
  return entry.models.some((m) => m.id === model);
}

export function billExtractAvailability() {
  return BILL_EXTRACT_CATALOG.map((entry) => ({
    provider: entry.provider,
    label: entry.label,
    envVar: entry.envVar,
    available: !!process.env[entry.envVar],
    defaultModel: entry.defaultModel,
    models: entry.models,
  }));
}
