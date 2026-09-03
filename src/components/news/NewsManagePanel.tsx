import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import useDismissablePortal from "../../hooks/useDismissablePortal";
import {
  createNewsTopic, deleteNewsSource, deleteNewsTopic, renameNewsTopic,
  reorderNewsTopics, updateNewsSource, updateNewsTopicMutedTerms,
} from "../../api";
import { describeSourceHealth, summarizeTopicSourceHealth } from "./newsPageModel";
import NewsAddSourceForm from "./NewsAddSourceForm";
import AnimatedCollapse from "../shared/AnimatedCollapse";
import AnimatedHeight from "../shared/AnimatedHeight";
import NewsCatalogPicker from "./NewsCatalogPicker";
import { ManageButton } from "./manageUi";
import { manageInputStyle } from "./manageStyles";
import type { MouseEventHandler } from "react";
import type { NewsPageEnvelope, NewsSource, NewsTopic } from "../../../shared/types/news.ts";

function CloseButton({ onClick }: { onClick: MouseEventHandler<HTMLButtonElement> }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      className="news-manage-close"
      aria-label="Close"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 28, height: 28, borderRadius: 8, border: "none",
        background: hover ? "rgba(255,255,255,0.08)" : "transparent",
        color: "var(--sp-subtext)", cursor: "pointer", transition: "background 150ms",
      }}
    >
      <X size={15} />
    </button>
  );
}

function TopicOverviewButton({ topic, onClick }: { topic: NewsTopic; onClick: MouseEventHandler<HTMLButtonElement> }) {
  const [hover, setHover] = useState(false);
  const sources = topic.sources || [];
  const enabledSources = sources.filter((source) => source.enabled);
  const sourceHealth = summarizeTopicSourceHealth(enabledSources);
  const healthLabel = !sourceHealth
    ? (sources.length === 0 ? "No sources" : (enabledSources.length === 0 ? "Paused" : "Healthy"))
    : sourceHealth.label;
  const healthColor = sourceHealth?.tone === "danger"
    ? "var(--sp-rose)"
    : (sourceHealth ? "var(--sp-cream)" : "var(--sp-subtext)");

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      style={{
        width: "100%", display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto auto",
        alignItems: "center", gap: 12, padding: "12px 13px", borderRadius: 8,
        border: `1px solid ${hover ? "rgba(255,255,255,0.13)" : "rgba(255,255,255,0.07)"}`,
        background: hover ? "rgba(255,255,255,0.055)" : "rgba(255,255,255,0.025)",
        color: "var(--sp-text)", textAlign: "left", cursor: "pointer",
        transition: "background 150ms, border-color 150ms",
      }}
    >
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{topic.name}</span>
        <span style={{ display: "block", marginTop: 3, fontSize: 11, color: "var(--sp-subtext)" }}>
          {enabledSources.length}/{sources.length} enabled
        </span>
      </span>
      <span style={{
        fontSize: 10.5, whiteSpace: "nowrap",
        color: healthColor,
      }}>
        {healthLabel}
      </span>
      <span aria-hidden style={{ color: "var(--sp-subtext)", fontSize: 17 }}>›</span>
    </button>
  );
}

interface NewsManagePanelProps {
  open: boolean;
  onClose?: () => void;
  news: NewsPageEnvelope | null;
  onChanged?: () => void;
  initialTopicId?: number | null;
}

interface NewsPanelState {
  open: boolean;
  initialTopicId: number | null;
  selectedTopicId: number | null;
}

export default function NewsManagePanel({
  open,
  onClose,
  news,
  onChanged,
  initialTopicId = null,
}: NewsManagePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [panelState, setPanelState] = useState<NewsPanelState>(() => ({
    open,
    initialTopicId,
    selectedTopicId: open ? (initialTopicId ?? null) : null,
  }));
  const [newTopicName, setNewTopicName] = useState("");
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDeleteTopicId, setConfirmDeleteTopicId] = useState<number | null>(null);
  const [addSourceTopicId, setAddSourceTopicId] = useState<number | null>(null);
  const [muteDrafts, setMuteDrafts] = useState<Record<number, string>>({});

  if (panelState.open !== open || panelState.initialTopicId !== initialTopicId) {
    setPanelState({
      open,
      initialTopicId,
      selectedTopicId: open ? (initialTopicId ?? null) : null,
    });
    if (!open) {
      setRenamingId(null);
      setConfirmDeleteTopicId(null);
      setAddSourceTopicId(null);
    }
  }

  const showTopicOverview = () => {
    setRenamingId(null);
    setConfirmDeleteTopicId(null);
    setAddSourceTopicId(null);
    setPanelState((state) => ({ ...state, selectedTopicId: null }));
  };

  const closePanel = () => {
    setRenamingId(null);
    setConfirmDeleteTopicId(null);
    setAddSourceTopicId(null);
    onClose?.();
  };

  const focusableElements = (): HTMLElement[] => [...(panelRef.current?.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
  ) || [])];

  const focusPanel = () => {
    (focusableElements()[0] || panelRef.current)?.focus();
  };

  const containPanelFocus = (event: KeyboardEvent) => {
    const focusable = focusableElements();
    if (!focusable.length) {
      event.preventDefault();
      panelRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !panelRef.current?.contains(document.activeElement))) {
      event.preventDefault();
      last!.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !panelRef.current?.contains(document.activeElement))) {
      event.preventDefault();
      first!.focus();
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const returnTarget = returnFocusRef.current;
      returnFocusRef.current = null;
      window.queueMicrotask(() => returnTarget?.focus?.());
    };
  }, [open]);

  useDismissablePortal({
    active: open,
    ref: panelRef,
    onDismiss: closePanel,
    onActivate: focusPanel,
    activateKey: panelState.selectedTopicId,
    onTabKey: containPanelFocus,
    refs: undefined,
    ignoreSelector: undefined,
  });

  if (!open) return null;

  const topics = news?.topics || [];
  const selectedTopic = topics.find((topic) => topic.id === panelState.selectedTopicId) || null;
  const selectedTopicIndex = selectedTopic ? topics.indexOf(selectedTopic) : -1;

  async function handleCreateTopic() {
    const name = newTopicName.trim();
    if (!name) return;
    await createNewsTopic(name);
    setNewTopicName("");
    onChanged?.();
  }

  async function handleRenameCommit(topicId: number) {
    const name = renameDraft.trim();
    setRenamingId(null);
    if (!name) return;
    await renameNewsTopic(topicId, name);
    onChanged?.();
  }

  async function handleMove(topicId: number, direction: -1 | 1) {
    const ids = topics.map((t) => t.id);
    const index = ids.indexOf(topicId);
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= ids.length) return;
    const currentId = ids[index]!;
    ids[index] = ids[swapIndex]!;
    ids[swapIndex] = currentId;
    await reorderNewsTopics(ids);
    onChanged?.();
  }

  async function handleDeleteTopic(topicId: number) {
    if (confirmDeleteTopicId !== topicId) {
      setConfirmDeleteTopicId(topicId);
      return;
    }
    setConfirmDeleteTopicId(null);
    await deleteNewsTopic(topicId);
    setPanelState((state) => ({ ...state, selectedTopicId: null }));
    onChanged?.();
  }

  async function handleToggleSource(source: NewsSource) {
    await updateNewsSource(source.id, { enabled: !source.enabled });
    onChanged?.();
  }

  async function handleMinPointsChange(source: NewsSource, value: number) {
    await updateNewsSource(source.id, { minPoints: value });
    onChanged?.();
  }

  async function handleDeleteSource(sourceId: number) {
    await deleteNewsSource(sourceId);
    onChanged?.();
  }

  async function handleAddMutedTerm(topic: NewsTopic) {
    const draft = (muteDrafts[topic.id] || "").trim();
    if (!draft) return;
    await updateNewsTopicMutedTerms(topic.id, [...(topic.mutedTerms || []), draft]);
    setMuteDrafts((drafts) => ({ ...drafts, [topic.id]: "" }));
    onChanged?.();
  }

  async function handleRemoveMutedTerm(topic: NewsTopic, term: string) {
    await updateNewsTopicMutedTerms(topic.id, (topic.mutedTerms || []).filter((t) => t !== term));
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="news-sources-title"
        tabIndex={-1}
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: "min(420px, 92vw)",
          background: "#16161e", isolation: "isolate", overscrollBehavior: "contain",
          borderLeft: "1px solid rgba(255,255,255,0.08)", boxShadow: "-20px 0 60px rgba(0,0,0,0.7)",
          display: "flex", flexDirection: "column", zIndex: 1000,
          animation: "newsPanelIn 200ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 10, padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
            {selectedTopic ? (
              <ManageButton
                onClick={showTopicOverview}
                ariaLabel="Back to topics"
              >
                ←
              </ManageButton>
            ) : null}
            <h2 id="news-sources-title" style={{
              margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              fontSize: 14, fontWeight: 600, color: "var(--sp-text)",
            }}>
              {selectedTopic ? selectedTopic.name : "Sources"}
            </h2>
          </div>
          <CloseButton onClick={closePanel} />
        </div>

        {selectedTopic ? (
          <div style={{ padding: 16, overflowY: "auto", flex: 1, display: "grid", alignContent: "start", gap: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {renamingId === selectedTopic.id ? (
                <input
                  autoFocus
                  aria-label={`Topic name for ${selectedTopic.name}`}
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={() => handleRenameCommit(selectedTopic.id)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleRenameCommit(selectedTopic.id); }}
                  style={{ ...manageInputStyle, flex: 1 }}
                />
              ) : (
                <button
                  type="button"
                  aria-label={`Rename ${selectedTopic.name}`}
                  title="Rename topic"
                  onClick={() => { setRenamingId(selectedTopic.id); setRenameDraft(selectedTopic.name); }}
                  style={{
                    flex: 1, padding: 0, border: "none", background: "transparent",
                    color: "var(--sp-text)", font: "inherit", fontSize: 13, fontWeight: 600,
                    textAlign: "left", cursor: "pointer",
                  }}
                >
                  {selectedTopic.name}
                </button>
              )}
              <ManageButton
                onClick={() => handleMove(selectedTopic.id, -1)}
                disabled={selectedTopicIndex === 0}
                ariaLabel="Move up"
              >
                ↑
              </ManageButton>
              <ManageButton
                onClick={() => handleMove(selectedTopic.id, 1)}
                disabled={selectedTopicIndex === topics.length - 1}
                ariaLabel="Move down"
              >
                ↓
              </ManageButton>
              <ManageButton onClick={() => handleDeleteTopic(selectedTopic.id)}>
                {confirmDeleteTopicId === selectedTopic.id ? "Confirm?" : "Delete"}
              </ManageButton>
            </div>

            <section style={{ display: "grid", gap: 9 }}>
              <div style={{
                fontSize: 10.5, fontWeight: 600, letterSpacing: "0.08em",
                textTransform: "uppercase", color: "var(--sp-subtext)",
              }}>
                Sources
              </div>
              <div style={{ display: "grid", gap: 7 }}>
                {(selectedTopic.sources || []).map((source) => {
                  const health = describeSourceHealth(source);
                  const healthColor = health.label === "Reddit delayed · 429"
                    ? "var(--sp-cream)"
                    : "var(--sp-rose)";
                  return (
                    <div
                      key={source.id}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, minHeight: 30,
                        padding: "3px 0", fontSize: 12,
                      }}
                    >
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
                        <span title={health.label ?? undefined} style={{ color: healthColor, fontSize: 10.5 }}>
                          {health.label}
                        </span>
                      ) : null}
                      {source.kind === "hn" ? (
                        <input
                          type="number"
                          aria-label={`Minimum points for ${source.title}`}
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
                {(selectedTopic.sources || []).length === 0 ? (
                  <div style={{ fontSize: 11.5, color: "var(--sp-subtext)" }}>No sources yet.</div>
                ) : null}
              </div>

              <AnimatedCollapse open={addSourceTopicId === selectedTopic.id}>
                <AnimatedHeight>
                  <NewsAddSourceForm
                    topicId={selectedTopic.id}
                    onAdded={() => { setAddSourceTopicId(null); onChanged?.(); }}
                    onCancel={() => setAddSourceTopicId(null)}
                  />
                </AnimatedHeight>
              </AnimatedCollapse>
              <AnimatedCollapse open={addSourceTopicId !== selectedTopic.id}>
                <div><ManageButton onClick={() => setAddSourceTopicId(selectedTopic.id)}>Add source</ManageButton></div>
              </AnimatedCollapse>
            </section>

            <section style={{ display: "grid", gap: 9 }}>
              <div style={{
                fontSize: 10.5, fontWeight: 600, letterSpacing: "0.08em",
                textTransform: "uppercase", color: "var(--sp-subtext)",
              }}>
                Muted terms
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                {(selectedTopic.mutedTerms || []).map((term) => (
                  <span
                    key={term}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11,
                      color: "var(--sp-subtext)", background: "rgba(255,255,255,0.05)",
                      borderRadius: 999, padding: "2px 4px 2px 9px",
                    }}
                  >
                    {term}
                    <button
                      type="button"
                      aria-label={`Unmute ${term}`}
                      onClick={() => handleRemoveMutedTerm(selectedTopic, term)}
                      style={{
                        border: "none", background: "transparent", color: "var(--sp-subtext)",
                        cursor: "pointer", fontSize: 12, lineHeight: 1, padding: "0 4px",
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  aria-label={`Mute term for ${selectedTopic.name}`}
                  value={muteDrafts[selectedTopic.id] || ""}
                  onChange={(e) => setMuteDrafts((drafts) => ({ ...drafts, [selectedTopic.id]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddMutedTerm(selectedTopic); }}
                  placeholder="Mute keyword…"
                  style={{ ...manageInputStyle, width: 130, padding: "4px 8px" }}
                />
              </div>
            </section>
          </div>
        ) : (
          <div style={{ padding: 16, overflowY: "auto", flex: 1, display: "grid", alignContent: "start", gap: 18 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                aria-label="New topic name"
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
              <div style={{ display: "grid", gap: 8 }}>
                {topics.map((topic) => (
                  <TopicOverviewButton
                    key={topic.id}
                    topic={topic}
                    onClick={() => setPanelState((state) => ({ ...state, selectedTopicId: topic.id }))}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
