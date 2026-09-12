import type { AlfredPanelMessage } from "./alfredPanelModel";

export type AlfredWorkMessage = Extract<AlfredPanelMessage, { type: "say" | "tools" }>;

export interface AlfredWorkHistory {
  id: string;
  type: "work-history";
  messages: AlfredWorkMessage[];
  done: boolean;
}

type AlfredPresentedMessage = Exclude<AlfredPanelMessage, { type: "tools" }> | AlfredWorkHistory;

// Keep the streamed transcript intact. Only its presentation groups each user
// turn's tool calls and narration; answers, results and errors remain visible.
export function presentAlfredMessages(messages: AlfredPanelMessage[], busy: boolean): AlfredPresentedMessage[] {
  const presented: AlfredPresentedMessage[] = [];
  let history: AlfredWorkHistory | null = null;

  for (const message of messages) {
    if (message.type === "user") history = null;
    if (message.type === "tools" || (message.type === "say" && message.preamble)) {
      if (!history) {
        history = { id: `history-${message.id}`, type: "work-history", messages: [], done: true };
        presented.push(history);
      }
      history.messages.push(message);
    } else {
      presented.push(message);
    }
  }

  // Only the last user turn can still be running. A stopped/failed turn settles
  // when the chat lifecycle clears busy, without altering individual tool state.
  if (history && busy) history.done = false;
  return presented;
}
