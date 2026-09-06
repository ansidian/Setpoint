import type { InboxEmailLike } from "../inboxTypes";
import type { EmailBodyState } from "./readerTypes";
import EmailAttachmentShelf from "./EmailAttachmentShelf";
import EmailBodyPane from "./EmailBodyPane";

export default function EmailContentSection({ email, bodyState, isMobile = false }: {
  email: InboxEmailLike;
  bodyState: EmailBodyState;
  isMobile?: boolean;
}) {
  const messageKey = String(email.uid || email.email_id || email.id || bodyState.body || "");
  return (
    <section>
      <EmailAttachmentShelf emailUid={messageKey} attachments={bodyState.attachments} isMobile={isMobile} />
      <div className={isMobile ? undefined : "inbox-a-reader-body"}>
        <EmailBodyPane state={bodyState} fallback={email.body || email.preview} email={email} isMobile={isMobile} />
      </div>
    </section>
  );
}
