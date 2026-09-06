import { MailOpen } from "lucide-react";
import InboxEmptyState from "../InboxEmptyState";

export function ReaderEmptyState() {
  return (
    <div className="inbox-reader-empty">
      <InboxEmptyState
        icon={<MailOpen size={28} strokeWidth={1.3} />}
        title="Choose a message"
        message="Select an email from the list to read it here."
      >
        <div className="inbox-empty-state-shortcuts"><kbd>J</kbd><kbd>K</kbd><span>next / previous message</span></div>
      </InboxEmptyState>
    </div>
  );
}
