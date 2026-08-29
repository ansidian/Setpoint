import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SayBlock } from "./AlfredMessages";

afterEach(cleanup);

describe("alfred message primitives", () => {
  it("SayBlock does not split its automatic opening emphasis at a decimal point", () => {
    const { container } = render(<SayBlock text="Rent is $1,850.00 due Friday. Nothing else is due." done />);
    expect(container.querySelector("strong")?.textContent).toBe("Rent is $1,850.00 due Friday.");
  });

  it("SayBlock renders paragraphs plus unordered and numbered lists", () => {
    const { container } = render(<SayBlock text={[
      "Amazon changed its terms. Key updates:",
      "",
      "- Most disputes require **individual arbitration**.",
      "- Small-claims court remains available.",
      "",
      "1. Review the changes.",
      "2. Decide whether they matter to you.",
    ].join("\n")} done />);

    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelectorAll("ul > li")).toHaveLength(2);
    expect(container.querySelectorAll("ol > li")).toHaveLength(2);
    expect(screen.getByText("individual arbitration").tagName).toBe("STRONG");
    expect(container.textContent).not.toContain("- Most disputes");
  });

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
