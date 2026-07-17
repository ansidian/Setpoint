import { useState } from "react";
import { createNewsSource, previewNewsSource } from "../../api";
import { ManageButton } from "./manageUi.jsx";
import { manageInputStyle } from "./manageStyles.js";

export default function NewsAddSourceForm({ topicId, onAdded, onCancel }) {
  const [mode, setMode] = useState("rss");
  const [url, setUrl] = useState("");
  const [checking, setChecking] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [minPoints, setMinPoints] = useState(50);

  async function handleCheck() {
    setChecking(true);
    setError(null);
    setPreview(null);
    try {
      setPreview(await previewNewsSource(url.trim()));
    } catch (err) {
      setError(err?.message || "Could not check that URL.");
    } finally {
      setChecking(false);
    }
  }

  async function handleAdd() {
    await createNewsSource({
      topicId, kind: "rss", title: preview.title, feedUrl: preview.feedUrl, siteUrl: url.trim(),
    });
    onAdded?.();
  }

  async function handleAddHn() {
    await createNewsSource({
      topicId, kind: "hn", title: `Hacker News · ${query || "front page"}`, hnQuery: query, minPoints,
    });
    onAdded?.();
  }

  if (mode === "hn") {
    return (
      <div style={{ display: "grid", gap: 8, padding: "8px 0" }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Keyword (blank = front page)"
          style={manageInputStyle}
        />
        <input
          type="number"
          value={minPoints}
          onChange={(e) => setMinPoints(Number(e.target.value))}
          style={manageInputStyle}
        />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <ManageButton onClick={handleAddHn}>Add</ManageButton>
          <ManageButton onClick={() => setMode("rss")}>Back</ManageButton>
          <ManageButton onClick={onCancel}>Cancel</ManageButton>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 8, padding: "8px 0" }}>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Paste a site or feed URL"
        style={manageInputStyle}
      />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <ManageButton onClick={handleCheck} disabled={checking || !url.trim()}>Check</ManageButton>
        <ManageButton onClick={() => setMode("hn")}>HN keyword</ManageButton>
        <ManageButton onClick={onCancel}>Cancel</ManageButton>
      </div>
      {error ? <div style={{ color: "var(--sp-rose)", fontSize: 12 }}>{error}</div> : null}
      {preview ? (
        <div style={{ fontSize: 12, color: "var(--sp-subtext)" }}>
          <strong style={{ color: "var(--sp-text)" }}>{preview.title}</strong>
          {preview.sampleTitles?.[0] ? ` — latest: ${preview.sampleTitles[0]}` : null}
          <div style={{ marginTop: 6 }}>
            <ManageButton onClick={handleAdd}>Add</ManageButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
