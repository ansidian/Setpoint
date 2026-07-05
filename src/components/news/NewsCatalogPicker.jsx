import { useEffect, useState } from "react";
import { getNewsCatalog, importNewsStarterTopics } from "../../api.js";
import { ManageButton } from "./manageUi.jsx";

export default function NewsCatalogPicker({ onImported }) {
  const [topics, setTopics] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getNewsCatalog()
      .then((result) => { if (!cancelled) setTopics(result?.topics || []); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  function toggle(name) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  async function handleImport() {
    setImporting(true);
    try {
      await importNewsStarterTopics([...selected]);
      onImported?.();
    } finally {
      setImporting(false);
    }
  }

  if (loading) return null;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ fontSize: 12, color: "var(--sp-subtext)" }}>Starter topics</div>
      <div style={{ display: "grid", gap: 6 }}>
        {topics.map((topic) => (
          <label
            key={topic.name}
            style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--sp-text)", cursor: "pointer" }}
          >
            <input
              type="checkbox"
              checked={selected.has(topic.name)}
              onChange={() => toggle(topic.name)}
              style={{ accentColor: "var(--sp-accent)", cursor: "pointer", width: 13, height: 13, margin: 0 }}
            />
            {topic.name}
            <span style={{ color: "var(--sp-subtext)", fontSize: 11 }}>
              ({topic.sources.length} source{topic.sources.length === 1 ? "" : "s"})
            </span>
          </label>
        ))}
      </div>
      <ManageButton onClick={handleImport} disabled={importing || !selected.size}>
        Add selected
      </ManageButton>
    </div>
  );
}
