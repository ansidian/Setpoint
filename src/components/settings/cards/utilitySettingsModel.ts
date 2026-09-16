export function payLinkHost(url: string) {
  if (!/^https?:\/\//i.test(url.trim())) return '';
  try {
    const parsed = new URL(url.trim());
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.hostname : '';
  } catch { return ''; }
}
