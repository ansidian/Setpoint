import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import useViewportWidth from "./useViewportWidth.js";

describe("useViewportWidth", () => {
  afterEach(() => {
    window.innerWidth = 1024;
  });

  it("tracks window width changes through resize events", async () => {
    window.innerWidth = 1400;

    const { result } = renderHook(() => useViewportWidth());

    expect(result.current).toBe(1400);

    await act(async () => {
      window.innerWidth = 960;
      window.dispatchEvent(new Event("resize"));
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
    });

    await waitFor(() => {
      expect(result.current).toBe(960);
    });
  });
});
