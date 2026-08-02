import { useCallback, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { deleteAlfredConversation, runAlfredStream } from "../../api";
import type { AlfredProvider } from "../../../shared/types/alfred";
import {
  applyAlfredEvent,
  makeUserMessage,
} from "./alfredPanelModel";
import type { AlfredPanelMessage } from "./alfredPanelModel";

export default function useAlfredChat() {
  const [messages, setMessages] = useState<AlfredPanelMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [activeModel, setActiveModel] = useState<{ provider: AlfredProvider; model: string } | null>(null);
  const [draft, setDraft] = useState("");
  const busyRef = useRef(false);
  const conversationRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runSeqRef = useRef(0);

  const submit = useCallback(async (text: string): Promise<void> => {
    const message = String(text || "").trim();
    if (!message || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const run = ++runSeqRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setMessages((ms) => [...ms, makeUserMessage(message)]);

    try {
      await runAlfredStream({
        message,
        conversationId: conversationRef.current,
        signal: controller.signal,
        onEvent: (event) => {
          if (runSeqRef.current !== run) return; // superseded by new chat
          if (event.type === "run_start") {
            conversationRef.current = event.conversation_id;
            setActiveModel({ provider: event.provider, model: event.model });
            return;
          }
          setMessages((ms) => applyAlfredEvent(ms, event));
        },
      });
    } catch (err) {
      if (runSeqRef.current === run && (!(err instanceof Error) || err.name !== "AbortError")) {
        setMessages((ms) => applyAlfredEvent(ms, {
          type: "run_error",
          message: err instanceof Error ? err.message : "Alfred could not complete this run.",
        }));
      }
    } finally {
      if (runSeqRef.current === run) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }, []);

  // Clearing the composer draft is part of the new-chat action itself (not a
  // concern of whichever surface triggered it): the panel's header button and
  // the ⌘⇧\ tick both reset the full chat surface through this one path.
  const newChat = useCallback(() => {
    runSeqRef.current += 1;
    abortRef.current?.abort();
    const id = conversationRef.current;
    conversationRef.current = null;
    if (id) deleteAlfredConversation(id).catch(() => {});
    setMessages([]);
    setActiveModel(null);
    setDraft("");
    busyRef.current = false;
    setBusy(false);
  }, []);

  return { messages, busy, activeModel, draft, setDraft, submit, newChat } satisfies {
    messages: AlfredPanelMessage[];
    busy: boolean;
    activeModel: { provider: AlfredProvider; model: string } | null;
    draft: string;
    setDraft: Dispatch<SetStateAction<string>>;
    submit: (text: string) => Promise<void>;
    newChat: () => void;
  };
}
