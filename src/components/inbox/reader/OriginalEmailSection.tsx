import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { InboxEmailLike } from "../inboxTypes";
import type { EmailBodyState } from "./readerTypes";
import EmailAttachmentShelf from "./EmailAttachmentShelf";
import EmailBodyPane from "./EmailBodyPane";
import "./OriginalEmailSection.css";

export default function OriginalEmailSection({ email, bodyState, isMobile = false }: {
  email: InboxEmailLike;
  bodyState: EmailBodyState;
  isMobile?: boolean;
}) {
  const messageKey = String(email.uid || email.email_id || email.id || bodyState.body || "");
  const [original, setOriginal] = useState(false);
  const fullSource = bodyState.source === "loaded";
  const canChangeFormatting = fullSource && /<[a-z!/]/i.test(bodyState.body || "");
  return (
    <section className="inbox-original-section" data-mobile={isMobile}>
      <div className="inbox-original-heading">
        <h2>{bodyState.source === "fallback" ? "Email preview · full message unavailable" : "Original email"}</h2>
        {canChangeFormatting && (
          <button type="button" onClick={() => setOriginal(!original)}>
            {original ? "Reading view" : "View original formatting"}
            <ChevronRight size={13} aria-hidden="true" />
          </button>
        )}
      </div>
      <EmailAttachmentShelf emailUid={messageKey} attachments={bodyState.attachments} isMobile={isMobile} />
      <div className={isMobile ? undefined : "inbox-a-reader-body"}>
        <EmailBodyPane state={bodyState} fallback={email.body || email.preview} email={email} isMobile={isMobile} presentation={fullSource && !original ? "reading" : "original"} />
      </div>
    </section>
  );
}
