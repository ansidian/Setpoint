import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const claimOwner = vi.hoisted(() => vi.fn());

vi.mock("../setupApi", () => ({ claimOwner }));

const { default: OwnerSetup } = await import("./OwnerSetup");

describe("OwnerSetup", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps mismatched passwords in the browser", async () => {
    render(<OwnerSetup onClaimed={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Create password"), { target: { value: "first-password" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "different-password" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /confirm this is the canonical/i }));
    fireEvent.click(screen.getByRole("button", { name: "Claim Setpoint" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Passwords do not match");
    expect(claimOwner).not.toHaveBeenCalled();
  });

  it("shows recovery codes once and requires acknowledgement before handoff", async () => {
    const onClaimed = vi.fn();
    claimOwner.mockResolvedValue({
      claimed: true,
      authenticated: true,
      recoveryCodes: ["SP-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-1111-2222"],
    });
    render(<OwnerSetup onClaimed={onClaimed} />);

    fireEvent.change(screen.getByLabelText("Create password"), { target: { value: "new-owner-password" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "new-owner-password" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /confirm this is the canonical/i }));
    fireEvent.click(screen.getByRole("button", { name: "Claim Setpoint" }));

    expect(await screen.findByText("SP-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-1111-2222")).toBeTruthy();
    expect(onClaimed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "I saved these codes" }));
    expect(onClaimed).toHaveBeenCalledTimes(1);
    expect(claimOwner).toHaveBeenCalledWith("new-owner-password", window.location.origin);
  });

  it("prefills the visible browser origin and requires explicit confirmation", () => {
    render(<OwnerSetup onClaimed={vi.fn()} />);

    expect(screen.getByLabelText<HTMLInputElement>("Canonical Setpoint URL").value).toBe(window.location.origin);
    fireEvent.change(screen.getByLabelText("Create password"), { target: { value: "new-owner-password" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "new-owner-password" } });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Claim Setpoint" }).disabled).toBe(true);
  });

  it("shows the fixed server conflict without retaining the password", async () => {
    claimOwner.mockRejectedValue(new Error("Instance is already claimed"));
    render(<OwnerSetup onClaimed={vi.fn()} />);

    const password = screen.getByLabelText("Create password") as HTMLInputElement;
    const confirmation = screen.getByLabelText("Confirm password") as HTMLInputElement;
    fireEvent.change(password, { target: { value: "new-owner-password" } });
    fireEvent.change(confirmation, { target: { value: "new-owner-password" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /confirm this is the canonical/i }));
    fireEvent.click(screen.getByRole("button", { name: "Claim Setpoint" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Instance is already claimed");
    expect(password.value).toBe("");
    expect(confirmation.value).toBe("");
  });
});
