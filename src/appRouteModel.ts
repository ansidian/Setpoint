export type AppRoutePath = "/" | "/login" | "/setup" | "/settings" | "/onboarding";

export interface AppBootstrapState {
  claimed: boolean;
  authenticated: boolean;
  onboardingFinished: boolean;
}

export function initialAppBootstrap(demoMode: boolean): AppBootstrapState | null {
  return demoMode
    ? { claimed: true, authenticated: true, onboardingFinished: true }
    : null;
}

export function applyOnboardingStatusChange(
  bootstrap: AppBootstrapState | null,
  finished: unknown,
): AppBootstrapState | null {
  if (bootstrap === null || typeof finished !== "boolean") return bootstrap;
  return { ...bootstrap, onboardingFinished: finished };
}

export function isSettingsShortcut(event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "defaultPrevented" | "key" | "metaKey">): boolean {
  return !event.defaultPrevented
    && (event.metaKey || event.ctrlKey)
    && !event.altKey
    && event.key === ",";
}

export function resolveAppRedirect(
  path: AppRoutePath,
  bootstrap: AppBootstrapState,
): AppRoutePath | null {
  if (!bootstrap.claimed) return path === "/setup" ? null : "/setup";

  if (path === "/setup") {
    return bootstrap.onboardingFinished ? "/" : "/onboarding";
  }

  if (!bootstrap.authenticated) return path === "/login" ? null : "/login";

  if (path === "/login") {
    return bootstrap.onboardingFinished ? "/" : "/onboarding";
  }

  return null;
}
