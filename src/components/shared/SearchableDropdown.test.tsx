import { useState } from "react";
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

  it("keeps same-named provider records distinct during keyboard selection", async () => {
    let selectedId = "first";
    render(<SearchableDropdown options={[{ id:"first",name:"Electric" },{ id:"second",name:"Electric" }]}
      value={selectedId} onChange={id => { selectedId = id; }} ariaLabel="Payee" />);
    fireEvent.click(screen.getByRole("button", { name:"Payee" }));
    const search = await screen.findByPlaceholderText("Search...");
    fireEvent.change(search, { target:{ value:"Electric" } });
    fireEvent.keyDown(search, { key:"ArrowDown" });
    fireEvent.keyDown(search, { key:"Enter" });
    expect(selectedId).toBe("second");
  });
  it("keeps multi-selection and its search active while toggling labels", async () => {
    function Labels() {
      const [value, setValue] = useState<string[]>([]);
      return <SearchableDropdown multiple options={[
        { id: "work", name: "work" }, { id: "deep-work", name: "deep-work" },
      ]} value={value} onChange={setValue} ariaLabel="Labels" />;
    }
    render(<Labels />);
    fireEvent.click(screen.getByRole("button", { name: "Labels" }));
    const search = await screen.findByPlaceholderText("Search...");
    fireEvent.change(search, { target: { value: "work" } });
    fireEvent.click(screen.getByRole("option", { name: "work" }));
    expect((screen.getByPlaceholderText("Search...") as HTMLInputElement).value).toBe("work");
    fireEvent.click(screen.getByRole("option", { name: "deep-work" }));
    expect(screen.getByRole("option", { name: "work" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("option", { name: "deep-work" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("option", { name: "work" }));
    expect(screen.getByRole("option", { name: "work" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("option", { name: "deep-work" }).getAttribute("aria-selected")).toBe("true");
  });

});
