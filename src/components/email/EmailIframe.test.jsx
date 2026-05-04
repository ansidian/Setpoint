import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import EmailIframe from "./EmailIframe.jsx";

afterEach(() => {
  cleanup();
});

describe("EmailIframe", () => {
  it("passes shell tab hotkeys through from the email document", () => {
    const received = [];
    const onParentKey = (event) => received.push(event.key);
    window.addEventListener("keydown", onParentKey);

    try {
      render(<EmailIframe html="<p>Loaded email body</p>" />);

      const iframe = screen.getByTitle("Email content");
      fireEvent.load(iframe);

      for (const key of ["1", "2"]) {
        iframe.contentDocument.dispatchEvent(new KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
        }));
      }

      expect(received).toEqual(["1", "2"]);
    } finally {
      window.removeEventListener("keydown", onParentKey);
    }
  });
});
