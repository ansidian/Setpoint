import { canonicalUrlService } from "../platform/canonical-url.ts";
import type { GoogleOAuthApplicationCredentials } from "../google-oauth-credentials.ts";

export const GOOGLE_COMBINED_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

export async function getAuthUrl(
  state: string,
  applicationCredentials: GoogleOAuthApplicationCredentials,
): Promise<string> {
  const redirectUri = await canonicalUrlService.resolveProviderCallbackUrl("googleOAuth");
  const params = new URLSearchParams({
    client_id: applicationCredentials.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_COMBINED_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}
