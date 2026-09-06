import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SayBlock } from "./AlfredMessages";

afterEach(cleanup);

describe("alfred message primitives", () => {

  it("SayBlock supports inline emphasis, code, and safe links without interpreting HTML", () => {
    const { container } = render(<SayBlock
      text={'Details. Use *care*, run `check`, and read [the source](https://example.com). <script>alert("x")</script>'}
      done
    />);

    expect(screen.getByText("care").tagName).toBe("EM");
    expect(screen.getByText("check").tagName).toBe("CODE");
    expect(screen.getByRole("link", { name: "the source" }).getAttribute("href")).toBe("https://example.com");
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain('<script>alert("x")</script>');
  });

  it("SayBlock leaves unsafe Markdown links as literal text", () => {
    const { container } = render(<SayBlock text="Details. [Open](javascript:alert(1))" done />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("javascript:alert(1)");
  });

});
