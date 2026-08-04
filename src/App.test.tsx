import { describe, expect, it } from "vitest";
import {
  applyOnboardingStatusChange,
  initialAppBootstrap,
  isSettingsShortcut,
  resolveAppRedirect,
  type AppBootstrapState,
} from "./appRouteModel";
import { resolveRouterBasename } from "./routerBase";

const ready: AppBootstrapState = {
  claimed: true,
  authenticated: true,
  onboardingFinished: true,
};

describe("App route policy", () => {
  it("starts demo builds inside an authenticated, completed owner workspace", () => {
    expect(initialAppBootstrap(true)).toEqual(ready);
    expect(initialAppBootstrap(false)).toBeNull();
  });

  it("admits only owner setup before the instance is claimed", () => {
    const unclaimed = { ...ready, claimed: false, authenticated: false, onboardingFinished: false };

    expect(resolveAppRedirect("/setup", unclaimed)).toBeNull();
    expect(resolveAppRedirect("/", unclaimed)).toBe("/setup");
    expect(resolveAppRedirect("/login", unclaimed)).toBe("/setup");
    expect(resolveAppRedirect("/settings", unclaimed)).toBe("/setup");
    expect(resolveAppRedirect("/onboarding", unclaimed)).toBe("/setup");
  });

  it("admits only login routes for an unauthenticated owner", () => {
    const signedOut = { ...ready, authenticated: false };

    expect(resolveAppRedirect("/login", signedOut)).toBeNull();
    expect(resolveAppRedirect("/", signedOut)).toBe("/login");
    expect(resolveAppRedirect("/settings", signedOut)).toBe("/login");
    expect(resolveAppRedirect("/onboarding", signedOut)).toBe("/login");
  });

  it("resumes unfinished onboarding from login without blocking direct dashboard access", () => {
    const onboarding = { ...ready, onboardingFinished: false };

    expect(resolveAppRedirect("/login", onboarding)).toBe("/onboarding");
    expect(resolveAppRedirect("/setup", onboarding)).toBe("/onboarding");
    expect(resolveAppRedirect("/", onboarding)).toBeNull();
    expect(resolveAppRedirect("/settings", onboarding)).toBeNull();
  });

  it("keeps every authenticated runtime route available after onboarding", () => {
    expect(resolveAppRedirect("/", ready)).toBeNull();
    expect(resolveAppRedirect("/settings", ready)).toBeNull();
    expect(resolveAppRedirect("/onboarding", ready)).toBeNull();
    expect(resolveAppRedirect("/login", ready)).toBe("/");
    expect(resolveAppRedirect("/setup", ready)).toBe("/");
  });

  it("applies only boolean onboarding lifecycle events", () => {
    expect(applyOnboardingStatusChange(ready, false)).toEqual({
      ...ready,
      onboardingFinished: false,
    });
    expect(applyOnboardingStatusChange(ready, "false")).toBe(ready);
    expect(applyOnboardingStatusChange(null, false)).toBeNull();
  });

  it("recognizes command-comma and control-comma without hijacking modified shortcuts", () => {
    expect(isSettingsShortcut({ key: ",", metaKey: true, ctrlKey: false, altKey: false, defaultPrevented: false })).toBe(true);
    expect(isSettingsShortcut({ key: ",", metaKey: false, ctrlKey: true, altKey: false, defaultPrevented: false })).toBe(true);
    expect(isSettingsShortcut({ key: ",", metaKey: true, ctrlKey: false, altKey: true, defaultPrevented: false })).toBe(false);
    expect(isSettingsShortcut({ key: ",", metaKey: true, ctrlKey: false, altKey: false, defaultPrevented: true })).toBe(false);
  });

  it("derives a router basename from Vite's deployment base", () => {
    expect(resolveRouterBasename("/")).toBeUndefined();
    expect(resolveRouterBasename("/Setpoint/")).toBe("/Setpoint");
    expect(resolveRouterBasename("/portfolio/demo")).toBe("/portfolio/demo");
  });
});
