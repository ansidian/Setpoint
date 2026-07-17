export function publicAssetUrl(path: string, baseUrl = import.meta.env.BASE_URL): string {
  const normalizedBase = baseUrl || "/";
  const normalizedPath = String(path || "").replace(/^\/+/, "");
  return `${normalizedBase}${normalizedPath}`;
}
