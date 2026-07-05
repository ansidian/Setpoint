import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  updateNewsSource: vi.fn(async () => ({ ok: true })),
  deleteNewsSource: vi.fn(async () => ({ ok: true })),
  deleteNewsTopic: vi.fn(async () => ({ ok: true })),
  createNewsTopic: vi.fn(async () => ({ id: 9, name: "New" })),
  renameNewsTopic: vi.fn(async () => ({ ok: true })),
  updateNewsTopicMutedTerms: vi.fn(async () => ({ ok: true })),
  reorderNewsTopics: vi.fn(async () => ({ ok: true })),
  previewNewsSource: vi.fn(async () => ({ feedUrl: "https://x/feed", title: "X Feed", sampleTitles: ["Hello"] })),
  createNewsSource: vi.fn(async () => ({ source: { id: 30 } })),
  getNewsCatalog: vi.fn(async () => ({ topics: [] })),
  importNewsStarterTopics: vi.fn(async () => ({ imported: [] })),
}));
vi.mock("../../api.js", () => api);

const { default: NewsManagePanel } = await import("./NewsManagePanel.jsx");

afterEach(cleanup);

const news = {
  lastSeenAt: null, lastUpdatedAt: null,
  topics: [{
    id: 1, name: "AI", position: 0,
    sources: [{ id: 10, topicId: 1, kind: "rss", title: "Feed A", feedUrl: "https://a/f", siteUrl: null,
      enabled: true, hnQuery: null, minPoints: null, lastStatus: "403", lastFetchAt: null, consecutiveFailures: 7 }],
    items: [],
    mutedTerms: ["crypto"],
  }],
};

describe("NewsManagePanel", () => {
  it("toggling a source calls updateNewsSource and onChanged", async () => {
    const onChanged = vi.fn();
    render(<NewsManagePanel open onClose={() => {}} news={news} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /feed a/i }));
    await waitFor(() => expect(api.updateNewsSource).toHaveBeenCalledWith(10, { enabled: false }));
    expect(onChanged).toHaveBeenCalled();
  });

  it("shows a failing badge for a backed-off source", () => {
    render(<NewsManagePanel open onClose={() => {}} news={news} onChanged={() => {}} />);
    expect(screen.getByText(/HTTP 403 · failing/)).toBeTruthy();
  });

  it("add-source flow: check → confirm calls previewNewsSource then createNewsSource", async () => {
    const onChanged = vi.fn();
    render(<NewsManagePanel open onClose={() => {}} news={news} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: /add source/i }));
    fireEvent.change(screen.getByPlaceholderText(/paste a site or feed url/i), {
      target: { value: "https://x.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /check/i }));
    await screen.findByText(/X Feed/);
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    await waitFor(() => expect(api.createNewsSource).toHaveBeenCalledWith(
      expect.objectContaining({ topicId: 1, kind: "rss", feedUrl: "https://x/feed", title: "X Feed" }),
    ));
  });

  it("adds a mute term via the input and removes one via its chip", async () => {
    const onChanged = vi.fn();
    render(<NewsManagePanel open onClose={() => {}} news={news} onChanged={onChanged} />);
    fireEvent.change(screen.getByPlaceholderText(/mute keyword/i), { target: { value: " sponsored " } });
    fireEvent.keyDown(screen.getByPlaceholderText(/mute keyword/i), { key: "Enter" });
    await waitFor(() => expect(api.updateNewsTopicMutedTerms)
      .toHaveBeenCalledWith(1, ["crypto", "sponsored"]));
    expect(onChanged).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /unmute crypto/i }));
    await waitFor(() => expect(api.updateNewsTopicMutedTerms).toHaveBeenCalledWith(1, []));
  });
});
