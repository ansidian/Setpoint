import { useCallback, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { deleteAlfredConversation, runAlfredStream } from "../../api";
import type { AlfredPreparedEmailContext, AlfredProvider } from "../../../shared/types/alfred";
import {
  applyAlfredEvent,
  makeAlfredNotice,
  makeUserMessage,
  markAlfredUserMessageFailed,
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

  const submit = useCallback(async (
    text: string,
    emailContext: AlfredPreparedEmailContext | null = null,
  ): Promise<AlfredSubmitResult> => {
    const message = String(text || "").trim();
    if (!message || busyRef.current) return { status: "ignored" };
    busyRef.current = true;
    setBusy(true);
    const run = ++runSeqRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    const userMessage = makeUserMessage(message, emailContext || undefined);
    const requestedConversationId = conversationRef.current;
    let runEnded = false;
    let runFailure: { message: string; code?: string } | null = null;
    setMessages((ms) => [...ms, userMessage]);

    try {
      await runAlfredStream({
        message,
        conversationId: requestedConversationId,
        emailContextId: emailContext?.contextId,
        signal: controller.signal,
        onEvent: (event) => {
          if (runSeqRef.current !== run) return; // superseded by new chat
          if (event.type === "run_start") {
            const expired = Boolean(requestedConversationId && requestedConversationId !== event.conversation_id);
            conversationRef.current = event.conversation_id;
            setActiveModel({ provider: event.provider, model: event.model });
            if (expired) {
              setMessages([
                makeAlfredNotice("The previous chat expired, so this started a new chat."),
                userMessage,
              ]);
            }
            return;
          }
          if (event.type === "run_end") runEnded = true;
          if (event.type === "run_error") {
            runFailure = { message: event.message, ...(event.code ? { code: event.code } : {}) };
          }
          setMessages((ms) => applyAlfredEvent(ms, event));
        },
      });
      if (runSeqRef.current !== run) return { status: "cancelled" };
      const completedFailure = runFailure as { message: string; code?: string } | null;
      if (completedFailure) {
        setMessages((ms) => markAlfredUserMessageFailed(ms, userMessage.id));
        return { status: "error", ...completedFailure };
      }
      if (!runEnded) {
        const failure = { message: "Alfred could not complete this run." };
        setMessages((ms) => applyAlfredEvent(
          markAlfredUserMessageFailed(ms, userMessage.id),
          { type: "run_error", message: failure.message },
        ));
        return { status: "error", ...failure };
      }
      return { status: "success" };
    } catch (err) {
      if (runSeqRef.current === run && (!(err instanceof Error) || err.name !== "AbortError")) {
        const messageText = err instanceof Error ? err.message : "Alfred could not complete this run.";
        const code = err && typeof err === "object" && "code" in err && err.code ? String(err.code) : undefined;
        setMessages((ms) => applyAlfredEvent(ms, {
          type: "run_error",
          message: messageText,
          ...(code ? { code } : {}),
        }));
        setMessages((ms) => markAlfredUserMessageFailed(ms, userMessage.id));
        return { status: "error", message: messageText, ...(code ? { code } : {}) };
      }
      return { status: "cancelled" };
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
    submit: (text: string, emailContext?: AlfredPreparedEmailContext | null) => Promise<AlfredSubmitResult>;
    newChat: () => void;
  };
}

export type AlfredSubmitResult =
  | { status: "success" }
  | { status: "error"; message: string; code?: string }
  | { status: "ignored" | "cancelled" };
