import { useCallback, useRef, useState } from "react";
import type { AlfredEmailContextSource } from "../../../shared/types/alfred";

// Owns the Alfred panel's mount/open/handoff state. `alfredMounted` lazy-mounts
// the panel on first use and keeps it mounted thereafter; `askAlfred` opens it
// with a query handoff. Callbacks are stable so the memoized AlfredPanel's
// Esc-listener effect stops re-binding on every dashboard SSE/refresh re-render.
export default function useAlfredPanelState() {
  const [alfredOpen, setAlfredOpen] = useState(false);
  const [alfredMounted, setAlfredMounted] = useState(false);
  const [alfredNewChatTick, setAlfredNewChatTick] = useState(0);
  const [alfredHandoff, setAlfredHandoff] = useState<{ id: number; query: string } | null>(null);
  const [alfredEmailHandoff, setAlfredEmailHandoff] = useState<{ id: number; source: AlfredEmailContextSource } | null>(null);
  const alfredHandoffSeq = useRef(0);

  const toggleAlfred = useCallback(() => {
    setAlfredMounted(true);
    setAlfredOpen((v) => !v);
  }, []);
  const closeAlfred = useCallback(() => setAlfredOpen(false), []);
  const alfredNewChat = useCallback(() => {
    setAlfredMounted(true);
    setAlfredOpen(true);
    setAlfredNewChatTick((t) => t + 1);
  }, []);
  const askAlfred = useCallback((query: string) => {
    const q = String(query || "").trim();
    if (!q) return;
    setAlfredMounted(true);
    setAlfredOpen(true);
    alfredHandoffSeq.current += 1;
    setAlfredHandoff({ id: alfredHandoffSeq.current, query: q });
  }, []);
  const attachEmailToAlfred = useCallback((source: AlfredEmailContextSource) => {
    if (!String(source?.uid || "").trim()) return;
    setAlfredMounted(true);
    setAlfredOpen(true);
    alfredHandoffSeq.current += 1;
    setAlfredEmailHandoff({ id: alfredHandoffSeq.current, source });
  }, []);

  return {
    alfredOpen,
    alfredMounted,
    alfredNewChatTick,
    alfredHandoff,
    alfredEmailHandoff,
    toggleAlfred,
    closeAlfred,
    alfredNewChat,
    askAlfred,
    attachEmailToAlfred,
  };
}
