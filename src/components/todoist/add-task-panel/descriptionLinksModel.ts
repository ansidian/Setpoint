export function extractDescriptionUrls(description: string): string[] {
  const matches = description.match(/https?:\/\/[^\s<>"']+/gi) || [];
  return [...new Set(matches.map((url) => url.replace(/[),.;!?]+$/, "")).filter(Boolean))];
}
