export function resolveRouterBasename(baseUrl = import.meta.env.BASE_URL) {
  if (!baseUrl || baseUrl === "/") return undefined;
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}
