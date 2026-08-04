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
    let selectedId = "";

    render(
      <SearchableDropdown
        options={[
          { id: "returns", name: "Returns" },
          { id: "registration", name: "DMV Registration" },
          { id: "refund", name: "Refund Review" },
        ]}
        value=""
        onChange={(id) => { selectedId = id; }}
        placeholder="Select category..."
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /select category/i }));
    fireEvent.change(await screen.findByPlaceholderText("Search..."), {
      target: { value: "re" },
    });

    expect(selectedId).toBe("");
    expect(screen.getByText("Returns")).toBeTruthy();
    expect(screen.getByText("Refund Review")).toBeTruthy();
  });

  it("still allows creating a new option when enabled", async () => {
    let createdName = "";

    render(
      <SearchableDropdown
        options={[
          { id: "dmv", name: "DMV Registration" },
        ]}
        value=""
        onChange={vi.fn()}
        allowCreate
        onCreateNew={(name) => { createdName = name; }}
        placeholder="Select payee..."
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /select payee/i }));
    fireEvent.change(await screen.findByPlaceholderText("Search or type new..."), {
      target: { value: "Rent" },
    });
    fireEvent.click(screen.getByText((content) => content.includes("Create") && content.includes("Rent")));

    expect(createdName).toBe("Rent");
  });

  it("does not open or change when disabled", () => {
    let selectedId = "checking";

    render(
      <SearchableDropdown
        options={[{ id: "checking", name: "Checking" }]}
        value="checking"
        onChange={(id) => { selectedId = id; }}
        ariaLabel="Actual account"
        disabled
      />,
    );

    const trigger = screen.getByRole("button", { name: "Actual account" }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    fireEvent.click(trigger);
    expect(screen.queryByPlaceholderText("Search...")).toBeNull();
    expect(selectedId).toBe("checking");
  });
});
