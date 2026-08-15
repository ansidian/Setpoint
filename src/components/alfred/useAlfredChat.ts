import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  acknowledgeAlfredCalendarProposalCreated,
  deleteAlfredConversation,
  runAlfredStream,
} from "../../api";
import type { AlfredPreparedEmailContext, AlfredProvider } from "../../../shared/types/alfred";
import type { NormalizedCalendarEvent } from "../../../shared/types/calendar";
import {
  applyAlfredEvent,
  clearUncreatedAlfredProposals,
  makeAlfredNotice,
  makeUserMessage,
  markAlfredProposalCreated,
  markAlfredUserMessageFailed,
  setAlfredProposalHandoffError,
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
  const expiryTimerRef = useRef<number | null>(null);
  const expiresAtRef = useRef<number | null>(null);
  const pendingCreatedAckRef = useRef(new Set<string>());

  const expireUncreatedProposals = useCallback(() => {
    const expiresAt = expiresAtRef.current;
    if (!expiresAt || Date.now() < expiresAt) return;
    setMessages((current) => clearUncreatedAlfredProposals(current));
    expiresAtRef.current = null;
  }, []);

  const scheduleExpiry = useCallback((expiresAt: string | undefined) => {
    if (expiryTimerRef.current != null) window.clearTimeout(expiryTimerRef.current);
    const deadline = new Date(expiresAt || "").getTime();
    expiresAtRef.current = Number.isFinite(deadline) ? deadline : null;
    if (!expiresAtRef.current) return;
    expiryTimerRef.current = window.setTimeout(
      expireUncreatedProposals,
      Math.max(0, expiresAtRef.current - Date.now()),
    );
  }, [expireUncreatedProposals]);

  useEffect(() => {
    const checkExpiry = () => expireUncreatedProposals();
    document.addEventListener("visibilitychange", checkExpiry);
    window.addEventListener("focus", checkExpiry);
    return () => {
      document.removeEventListener("visibilitychange", checkExpiry);
      window.removeEventListener("focus", checkExpiry);
      if (expiryTimerRef.current != null) window.clearTimeout(expiryTimerRef.current);
    };
  }, [expireUncreatedProposals]);

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
        createdProposalIds: [...pendingCreatedAckRef.current],
        signal: controller.signal,
        onEvent: (event) => {
          if (runSeqRef.current !== run) return; // superseded by new chat
          if (event.type === "run_start") {
            const expired = Boolean(requestedConversationId && requestedConversationId !== event.conversation_id);
            conversationRef.current = event.conversation_id;
            setActiveModel({ provider: event.provider, model: event.model });
            scheduleExpiry(event.expires_at);
            pendingCreatedAckRef.current.clear();
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
  }, [scheduleExpiry]);

  const setProposalHandoffError = useCallback((proposalId: string, error: string | null) => {
    setMessages((current) => setAlfredProposalHandoffError(current, proposalId, error));
  }, []);

  const completeProposal = useCallback((proposalId: string, event: NormalizedCalendarEvent) => {
    setMessages((current) => markAlfredProposalCreated(current, proposalId, event));
    const conversationId = conversationRef.current;
    if (!conversationId) return;
    pendingCreatedAckRef.current.add(proposalId);
    acknowledgeAlfredCalendarProposalCreated(conversationId, proposalId)
      .then(() => { pendingCreatedAckRef.current.delete(proposalId); })
      .catch(() => {
        // Calendar save is authoritative. Retry this metadata-only coordination
        // on the next Alfred request without surfacing a false save failure.
      });
  }, []);

  // Clearing the composer draft is part of the new-chat action itself (not a
  // concern of whichever surface triggered it): the panel's header button and
  // the ⌘⇧\ tick both reset the full chat surface through this one path.
  const newChat = useCallback(() => {
    runSeqRef.current += 1;
    abortRef.current?.abort();
    const id = conversationRef.current;
    conversationRef.current = null;
    expiresAtRef.current = null;
    if (expiryTimerRef.current != null) window.clearTimeout(expiryTimerRef.current);
    pendingCreatedAckRef.current.clear();
    if (id) deleteAlfredConversation(id).catch(() => {});
    setMessages([]);
    setActiveModel(null);
    setDraft("");
    busyRef.current = false;
    setBusy(false);
  }, []);

  return { messages, busy, activeModel, draft, setDraft, submit, newChat, setProposalHandoffError, completeProposal } satisfies {
    messages: AlfredPanelMessage[];
    busy: boolean;
    activeModel: { provider: AlfredProvider; model: string } | null;
    draft: string;
    setDraft: Dispatch<SetStateAction<string>>;
    submit: (text: string, emailContext?: AlfredPreparedEmailContext | null) => Promise<AlfredSubmitResult>;
    newChat: () => void;
    setProposalHandoffError: (proposalId: string, error: string | null) => void;
    completeProposal: (proposalId: string, event: NormalizedCalendarEvent) => void;
  };
}

export type AlfredSubmitResult =
  | { status: "success" }
  | { status: "error"; message: string; code?: string }
  | { status: "ignored" | "cancelled" };
