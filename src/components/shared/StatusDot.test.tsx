import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusDot } from "./StatusDot";

afterEach(cleanup);

function dot() {
  return screen.getByTestId("status-dot");
}

describe("StatusDot", () => {
  it("renders a 6px round dot", () => {
    render(<StatusDot tone="#f38ba8" />);
    expect(dot().style.width).toBe("6px");
    expect(dot().style.height).toBe("6px");
    expect(dot().style.borderRadius).toBe("99px");
  });

  it("solid: fills with the tone, no border, no shadow, no animation", () => {
    render(<StatusDot tone="#89dceb" state="solid" />);
    expect(dot().style.background).toBe("#89dceb");
    expect(dot().style.border).toBe("");
    expect(dot().style.boxShadow).toBe("");
    expect(dot().style.animation).toBe("");
  });

  it("hollow: transparent fill with a 1.5px tone border", () => {
    render(<StatusDot tone="#f38ba8" state="hollow" />);
    expect(dot().style.background).toBe("transparent");
    expect(dot().style.border).toBe("1.5px solid #f38ba8");
    expect(dot().style.boxShadow).toBe("");
  });

  it("glow: tone fill, tone box-shadow, and the pulse animation", () => {
    render(<StatusDot tone="var(--sp-accent)" state="glow" />);
    expect(dot().style.background).toBe("var(--sp-accent)");
    expect(dot().style.boxShadow).toBe("0 0 7px var(--sp-accent)");
    expect(dot().style.animation).toBe("sp-dot-pulse 2.4s ease-in-out infinite");
  });

  it("defaults to solid when state is omitted", () => {
    render(<StatusDot tone="#a6e3a1" />);
    expect(dot().style.boxShadow).toBe("");
    expect(dot().style.animation).toBe("");
    expect(dot().style.background).toBe("#a6e3a1");
  });
});
