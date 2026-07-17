import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchableDropdown from "./SearchableDropdown";

beforeEach(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SearchableDropdown", () => {
  it("does not auto-select while typing into the search field", async () => {
    const onChange = vi.fn();

    render(
      <SearchableDropdown
        options={[
          { id: "returns", name: "Returns" },
          { id: "registration", name: "DMV Registration" },
          { id: "refund", name: "Refund Review" },
        ]}
        value=""
        onChange={onChange}
        placeholder="Select category..."
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /select category/i }));
    fireEvent.change(await screen.findByPlaceholderText("Search..."), {
      target: { value: "re" },
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("Returns")).toBeTruthy();
    expect(screen.getByText("Refund Review")).toBeTruthy();
  });

  it("renders the open surface with a live floating-panel token, not the retired bg-elevated/shadow-modal aliases", async () => {
    render(
      <SearchableDropdown
        options={[{ id: "rent", name: "Rent" }]}
        value=""
        onChange={vi.fn()}
        placeholder="Select account..."
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /select account/i }));
    await screen.findByPlaceholderText("Search...");

    const surface = document.querySelector<HTMLElement>('[data-slot="popover-content"]');
    expect(surface).toBeTruthy();
    if (!surface) throw new Error("Expected popover surface");
    // Scope-B retired --color-elevated/shadow-modal; these utilities now generate
    // no rule, leaving the dropdown surface transparent. Guard against their return.
    expect(surface.className).not.toContain("bg-elevated");
    expect(surface.className).not.toContain("shadow-modal");
    // The surface must use the app-wide floating-panel token (matches every other popover).
    expect(surface.className).toContain("bg-[var(--sp-panel)]");
  });

  it("still allows creating a new option when enabled", async () => {
    const onCreateNew = vi.fn();

    render(
      <SearchableDropdown
        options={[
          { id: "dmv", name: "DMV Registration" },
        ]}
        value=""
        onChange={vi.fn()}
        allowCreate
        onCreateNew={onCreateNew}
        placeholder="Select payee..."
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /select payee/i }));
    fireEvent.change(await screen.findByPlaceholderText("Search or type new..."), {
      target: { value: "Rent" },
    });
    fireEvent.click(screen.getByText((content) => content.includes("Create") && content.includes("Rent")));

    expect(onCreateNew).toHaveBeenCalledWith("Rent");
  });
});
