import { createPortal } from "react-dom";
import { useRef, useState } from "react";
import { X } from "lucide-react";
import useDismissablePortal from "../../hooks/useDismissablePortal.js";
import {
  createNewsTopic, deleteNewsSource, deleteNewsTopic, renameNewsTopic,
  reorderNewsTopics, updateNewsSource,
} from "../../api.js";
import { describeSourceHealth } from "./newsPageModel.js";
import NewsAddSourceForm from "./NewsAddSourceForm.jsx";
import NewsCatalogPicker from "./NewsCatalogPicker.jsx";
import { ManageButton } from "./manageUi.jsx";
import { manageInputStyle } from "./manageStyles.js";

function CloseButton({ onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      aria-label="Close"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 28, height: 28, borderRadius: 7, border: "none",
        background: hover ? "rgba(255,255,255,0.08)" : "transparent",
        color: "var(--sp-subtext)", cursor: "pointer", transition: "background 150ms",
      }}
    >
      <X size={15} />
    </button>
  );
}

export default function NewsManagePanel({ open, onClose, news, onChanged }) {
  const panelRef = useRef(null);
  const [newTopicName, setNewTopicName] = useState("");
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDeleteTopicId, setConfirmDeleteTopicId] = useState(null);
  const [addSourceTopicId, setAddSourceTopicId] = useState(null);

  useDismissablePortal({ active: open, ref: panelRef, onDismiss: onClose });

  if (!open) return null;

  const topics = news?.topics || [];

  async function handleCreateTopic() {
    const name = newTopicName.trim();
    if (!name) return;
    await createNewsTopic(name);
    setNewTopicName("");
    onChanged?.();
  }

  async function handleRenameCommit(topicId) {
    const name = renameDraft.trim();
    setRenamingId(null);
    if (!name) return;
    await renameNewsTopic(topicId, name);
    onChanged?.();
  }

  async function handleMove(topicId, direction) {
    const ids = topics.map((t) => t.id);
    const index = ids.indexOf(topicId);
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= ids.length) return;
    [ids[index], ids[swapIndex]] = [ids[swapIndex], ids[index]];
    await reorderNewsTopics(ids);
    onChanged?.();
  }

  async function handleDeleteTopic(topicId) {
    if (confirmDeleteTopicId !== topicId) {
      setConfirmDeleteTopicId(topicId);
      return;
    }
    setConfirmDeleteTopicId(null);
    await deleteNewsTopic(topicId);
    onChanged?.();
  }

  async function handleToggleSource(source) {
    await updateNewsSource(source.id, { enabled: !source.enabled });
    onChanged?.();
  }

  async function handleMinPointsChange(source, value) {
    await updateNewsSource(source.id, { minPoints: value });
    onChanged?.();
  }

  async function handleDeleteSource(sourceId) {
    await deleteNewsSource(sourceId);
    onChanged?.();
  }

  return createPortal(
    <>
      <div
        aria-hidden
        style={{
          position: "fixed", inset: 0, zIndex: 999,
          background: "rgba(11,11,19,0.45)",
          animation: "newsBackdropIn 200ms ease-out",
        }}
      />
      <div
        ref={panelRef}
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: "min(420px, 92vw)",
          background: "#16161e", isolation: "isolate", overscrollBehavior: "contain",
          borderLeft: "1px solid rgba(255,255,255,0.08)", boxShadow: "-12px 0 32px rgba(0,0,0,0.4)",
          display: "flex", flexDirection: "column", zIndex: 1000,
          animation: "newsPanelIn 200ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--sp-text)" }}>Manage news</div>
        <CloseButton onClick={onClose} />
      </div>

      <div style={{ padding: 16, overflowY: "auto", flex: 1, display: "grid", gap: 18 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={newTopicName}
            onChange={(e) => setNewTopicName(e.target.value)}
            placeholder="New topic name"
            style={{ ...manageInputStyle, flex: 1 }}
          />
          <ManageButton onClick={handleCreateTopic} disabled={!newTopicName.trim()}>Add topic</ManageButton>
        </div>

        {topics.length === 0 ? (
          <NewsCatalogPicker onImported={onChanged} />
        ) : (
          topics.map((topic, index) => (
            <div
              key={topic.id}
              style={{ display: "grid", gap: 8, paddingBottom: 14, borderBottom: "1px solid rgba(255,255,255,0.05)" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {renamingId === topic.id ? (
                  <input
                    autoFocus
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={() => handleRenameCommit(topic.id)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleRenameCommit(topic.id); }}
                    style={{ ...manageInputStyle, flex: 1 }}
                  />
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => { setRenamingId(topic.id); setRenameDraft(topic.name); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { setRenamingId(topic.id); setRenameDraft(topic.name); }
                    }}
                    style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "var(--sp-text)", cursor: "pointer" }}
                  >
                    {topic.name}
                  </div>
                )}
                <ManageButton onClick={() => handleMove(topic.id, -1)} disabled={index === 0} ariaLabel="Move up">
                  ↑
                </ManageButton>
                <ManageButton
                  onClick={() => handleMove(topic.id, 1)}
                  disabled={index === topics.length - 1}
                  ariaLabel="Move down"
                >
                  ↓
                </ManageButton>
                <ManageButton onClick={() => handleDeleteTopic(topic.id)}>
                  {confirmDeleteTopicId === topic.id ? "Confirm?" : "Delete"}
                </ManageButton>
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                {topic.sources.map((source) => {
                  const health = describeSourceHealth(source);
                  return (
                    <div key={source.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                      <input
                        type="checkbox"
                        aria-label={source.title}
                        checked={source.enabled}
                        onChange={() => handleToggleSource(source)}
                        style={{ accentColor: "var(--sp-accent)", cursor: "pointer", width: 13, height: 13, margin: 0 }}
                      />
                      <span style={{
                        color: "var(--sp-text)", flex: 1, overflow: "hidden",
                        textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}
                      >
                        {source.title}
                      </span>
                      {health.failing ? (
                        <span title={health.label} style={{ color: "var(--sp-rose)", fontSize: 10.5 }}>
                          {health.label}
                        </span>
                      ) : null}
                      {source.kind === "hn" ? (
                        <input
                          type="number"
                          value={source.minPoints ?? 50}
                          onChange={(e) => handleMinPointsChange(source, Number(e.target.value))}
                          style={{ ...manageInputStyle, width: 56, padding: "4px 6px" }}
                        />
                      ) : null}
                      <ManageButton onClick={() => handleDeleteSource(source.id)} ariaLabel={`Delete ${source.title}`}>
                        ×
                      </ManageButton>
                    </div>
                  );
                })}
              </div>

              {addSourceTopicId === topic.id ? (
                <NewsAddSourceForm
                  topicId={topic.id}
                  onAdded={() => { setAddSourceTopicId(null); onChanged?.(); }}
                  onCancel={() => setAddSourceTopicId(null)}
                />
              ) : (
                <ManageButton onClick={() => setAddSourceTopicId(topic.id)}>Add source</ManageButton>
              )}
            </div>
          ))
        )}
      </div>
      </div>
    </>,
    document.body,
  );
}
