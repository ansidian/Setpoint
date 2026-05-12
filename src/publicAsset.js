export function publicAssetUrl(path, baseUrl = import.meta.env.BASE_URL) {
  const normalizedBase = baseUrl || "/";
  const normalizedPath = String(path || "").replace(/^\/+/, "");
  return `${normalizedBase}${normalizedPath}`;
}
