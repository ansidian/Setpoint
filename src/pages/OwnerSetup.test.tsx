import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import OwnerSetup from "./OwnerSetup";

function response(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

function installClaimResponse(payload: unknown, status = 200): void {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) !== "/api/auth/setup/claim") throw new Error(`Unexpected request: ${String(input)}`);
    return response(payload, status);
  }));
}

function renderSetup(): void {
  function Harness() {
    const [claimed, setClaimed] = useState(false);
    return claimed ? <h1>Onboarding ready</h1> : <OwnerSetup onClaimed={() => setClaimed(true)} />;
  }
  render(<Harness />);
}

describe("OwnerSetup", () => {
  beforeEach(() => {
    installClaimResponse({
      claimed: true,
      authenticated: true,
      recoveryCodes: ["SP-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-1111-2222"],
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps mismatched passwords in the browser", async () => {
    renderSetup();
    fillClaimForm("first-password", "different-password");

    expect((await screen.findByRole("alert")).textContent).toContain("Passwords do not match");
  });

  it("shows recovery codes once and requires acknowledgement before handoff", async () => {
    renderSetup();
    fillClaimForm("new-owner-password", "new-owner-password");

    expect(await screen.findByText("SP-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-1111-2222")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Onboarding ready" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "I saved these codes" }));
    expect(await screen.findByRole("heading", { name: "Onboarding ready" })).toBeTruthy();
  });

  it("prefills the visible browser origin and requires explicit confirmation", () => {
    renderSetup();

    expect(screen.getByLabelText<HTMLInputElement>("Canonical Setpoint URL").value).toBe(window.location.origin);
    fireEvent.change(screen.getByLabelText("Deployment setup token"), { target: { value: "deployment-setup-token" } });
    fireEvent.change(screen.getByLabelText("Create password"), { target: { value: "new-owner-password" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "new-owner-password" } });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Claim Setpoint" }).disabled).toBe(true);
  });

  it("shows the fixed server conflict without retaining secrets", async () => {
    installClaimResponse({ message: "Instance is already claimed" }, 409);
    renderSetup();

    const setupToken = screen.getByLabelText("Deployment setup token") as HTMLInputElement;
    const password = screen.getByLabelText("Create password") as HTMLInputElement;
    const confirmation = screen.getByLabelText("Confirm password") as HTMLInputElement;
    fillClaimForm("new-owner-password", "new-owner-password");

    expect((await screen.findByRole("alert")).textContent).toContain("Instance is already claimed");
    expect(setupToken.value).toBe("");
    expect(password.value).toBe("");
    expect(confirmation.value).toBe("");
  });
});

function fillClaimForm(password: string, confirmation: string): void {
  fireEvent.change(screen.getByLabelText("Deployment setup token"), { target: { value: "deployment-setup-token" } });
  fireEvent.change(screen.getByLabelText("Create password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: confirmation } });
  fireEvent.click(screen.getByRole("checkbox", { name: /confirm this is the canonical/i }));
  fireEvent.click(screen.getByRole("button", { name: "Claim Setpoint" }));
}
