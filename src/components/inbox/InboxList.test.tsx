import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import InboxList from "./InboxList";

afterEach(cleanup);

describe("InboxList", () => {
  it("hands the search query off to alfred on Cmd+Enter", () => {
    function AlfredHarness() {
      const [question, setQuestion] = useState("");
      return (
        <>
          <output aria-label="Alfred question">{question}</output>
          <InboxList
            accent="#cba6da"
            emails={[]}
            accountsById={{}}
            selectedId={null}
            onOpen={() => {}}
            density="default"
            layout="swimlanes"
            showPreview
            searchQuery="amazon return"
            onSearchChange={() => {}}
            onMarkAllRead={() => {}}
            onRefresh={() => {}}
            totalCount={0}
            unreadCount={0}
            searchRef={null}
            onAskAlfred={setQuestion}
          />
        </>
      );
    }

    render(<AlfredHarness />);
    fireEvent.keyDown(screen.getByLabelText("Search indexed mail"), {
      key: "Enter",
      metaKey: true,
    });

    expect(screen.getByLabelText("Alfred question").textContent).toBe("amazon return");
    expect(screen.queryByTestId("inbox-ai-confirmation")).toBeNull();
  });
});
