import { useRef, useState } from "react";
import { Check, Mail, MailOpen, Mails, MoreHorizontal, Pin, PinOff, Trash2, CalendarX, ArrowRight, X, type LucideIcon } from "lucide-react";
import { MenuItem, MenuPanel, ToolbarButton } from "./DesktopReaderActionBar";
import type { BatchAction, BatchActionOption } from "../inboxBatchModel";
import type { InboxEmailLike } from "../inboxTypes";
import "./DesktopReaderActionBar.css";
import "./BatchReader.css";

const icons: Record<BatchAction, LucideIcon> = {
  read: MailOpen, unread: Mail, pin: Pin, unpin: PinOff, trash: Trash2,
  handled: Check, reopen: Check, dismiss: CalendarX, needs_attention: ArrowRight, fyi: ArrowRight, noise: ArrowRight,
};

export default function BatchReader({ emails, options, busy, accent, onAction, onClose }: {
  emails: readonly InboxEmailLike[]; options: readonly BatchActionOption[]; busy: boolean; accent: string;
  onAction: (action: BatchAction) => void; onClose: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const lifecycle = options.filter(option => option.action === "handled" || option.action === "reopen");
  const primary = lifecycle.length === 1 ? lifecycle[0] : undefined;
  const secondary = [...options.filter(option => option !== primary && option.action !== "trash"), ...options.filter(option => option.action === "trash")];
  const count = emails.length;
  const accounts = new Set(emails.map(email => email._accountKey || email.account_id || email.accountId || email._account?.id || email.account_email || "unknown")).size;
  const label = (option: BatchActionOption) => `${option.label} · ${option.count === count ? count : `${option.count} of ${count}`}`;
  const closeMenu = () => { setMenuOpen(false); trigger.current?.focus(); };
  return (
    <section className="inbox-batch-reader" aria-label="Selected emails" aria-busy={busy || undefined}>
      <div className="desktop-reader-action-bar">
        <div className="desktop-reader-action-cluster">
          {primary && <ToolbarButton icon={Check} label={label(primary)} primary accent={accent} disabled={busy} onClick={() => onAction(primary.action)} />}
          {secondary.length > 0 && <ToolbarButton icon={MoreHorizontal} ariaLabel="More selected email actions" buttonRef={trigger} popup="menu" expanded={menuOpen} disabled={busy} suspendHotkeys onClick={() => setMenuOpen(!menuOpen)} />}
        </div>
        <div className="desktop-reader-action-navigation">
          <ToolbarButton icon={X} ariaLabel="Clear selection" onClick={onClose} />
        </div>
        {menuOpen && <MenuPanel anchorRef={trigger} panelRef={panel} ariaLabel="Selected email actions" height={secondary.length * 36 + 24} onClose={closeMenu}>
          {secondary.map(option => <MenuItem key={option.action} icon={icons[option.action]} label={label(option)} keyHint={null} disabled={busy} onSelect={() => { closeMenu(); onAction(option.action); }} />)}
        </MenuPanel>}
      </div>
      <div className="inbox-batch-summary">
        <Mails size={36} strokeWidth={1.3} aria-hidden="true" />
        <h2>{count} {count === 1 ? "email" : "emails"} selected</h2>
        <p>{emails.filter(email => !email.read).length} unread · {accounts} {accounts === 1 ? "account" : "accounts"}</p>
        {busy && <p role="status">Applying changes…</p>}
        {!busy && !options.length && <p>No batch actions available for this selection.</p>}
      </div>
    </section>
  );
}
