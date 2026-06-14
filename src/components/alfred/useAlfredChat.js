import { useCallback, useRef, useState } from "react";
import { deleteAlfredConversation, runAlfredStream } from "../../api";
import {
  alfredModelByKey,
  applyAlfredEvent,
  DEFAULT_ALFRED_MODEL_KEY,
  makeUserMessage,
} from "./alfredPanelModel.js";

export default function useAlfredChat() {
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [modelKey, setModelKey] = useState(DEFAULT_ALFRED_MODEL_KEY);

  const modelKeyRef = useRef(modelKey);
  modelKeyRef.current = modelKey;
  const busyRef = useRef(false);
  const conversationRef = useRef(null);
  const abortRef = useRef(null);
  const runSeqRef = useRef(0);

  const submit = useCallback(async (text) => {
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
        model: alfredModelByKey(modelKeyRef.current).id,
        signal: controller.signal,
        onEvent: (event) => {
          if (runSeqRef.current !== run) return; // superseded by new chat
          if (event.type === "run_start") {
            conversationRef.current = event.conversation_id;
            return;
          }
          setMessages((ms) => applyAlfredEvent(ms, event));
        },
      });
    } catch (err) {
      if (runSeqRef.current === run && err?.name !== "AbortError") {
        setMessages((ms) => applyAlfredEvent(ms, {
          type: "run_error",
          message: err?.message || "Alfred could not complete this run.",
        }));
      }
    } finally {
      if (runSeqRef.current === run) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }, []);

  const newChat = useCallback(() => {
    runSeqRef.current += 1;
    abortRef.current?.abort();
    const id = conversationRef.current;
    conversationRef.current = null;
    if (id) deleteAlfredConversation(id).catch(() => {});
    setMessages([]);
    busyRef.current = false;
    setBusy(false);
  }, []);

  return { messages, busy, modelKey, setModelKey, submit, newChat };
}
