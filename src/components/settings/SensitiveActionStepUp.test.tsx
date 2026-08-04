import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SensitiveActionStepUp } from "./SensitiveActionStepUp";
import { useSensitiveActionStepUp } from "./sensitiveActionStepUpModel";

const mockStepUpWithPassword = vi.hoisted(() => vi.fn());

// test-architecture: allow-boundary-mock -- password step-up is an authenticated security HTTP boundary; the rendered deferred-action workflow stays real.
vi.mock("@/auth/securityApi", () => ({
  stepUpWithPassword: mockStepUpWithPassword,
}));

function Harness({ action }: { action: () => Promise<void> }) {
  const stepUp = useSensitiveActionStepUp();
  return (
    <div>
      <button type="button" onClick={() => stepUp.run(action, "save this credential")}>Run sensitive action</button>
      <SensitiveActionStepUp state={stepUp} />
    </div>
  );
}

describe("SensitiveActionStepUp", () => {
  it("confirms the current password and retries the deferred action", async () => {
    const action = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("Confirm your password"), {
        code: "PASSWORD_STEP_UP_REQUIRED",
        status: 403,
      }))
      .mockResolvedValueOnce(undefined);
    mockStepUpWithPassword.mockResolvedValueOnce({ recentAuth: true });
    render(<Harness action={action} />);

    fireEvent.click(screen.getByRole("button", { name: "Run sensitive action" }));
    expect(await screen.findByText(/confirm your current password to retry save this credential/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "owner-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and retry" }));

    // test-architecture: allow-boundary-interaction -- the entered password crosses the authenticated step-up boundary and is intentionally absent from rendered state.
    expect(mockStepUpWithPassword).toHaveBeenCalledWith("owner-password");
    await waitFor(() => expect(screen.queryByLabelText("Current password")).toBeNull());
  });
});
