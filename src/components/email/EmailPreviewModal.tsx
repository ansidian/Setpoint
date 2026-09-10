import type { RefObject } from 'react';
import { Dialog, DialogContent } from '../ui/dialog';
import EmailPreviewContent, { type EmailPreviewMessage } from './EmailPreviewContent';

/** Keeps source reading outside the month panel while the underlying selection stays mounted. */
export default function EmailPreviewModal({ email, dateLabel, triggerRef, onClose }: {
  email: EmailPreviewMessage; dateLabel: string; triggerRef: RefObject<HTMLButtonElement | null>; onClose: () => void;
}) {
  return <Dialog open modal onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent aria-label="Email preview" showCloseButton={false} finalFocus={triggerRef} data-suspend-calendar-hotkeys="all"
      overlayStyle={{ zIndex: "calc(var(--z-popover) + 1)", background:'#0009', backdropFilter:'none', WebkitBackdropFilter:'none' }}
      style={{ zIndex: "calc(var(--z-popover) + 2)", display:'flex', flexDirection:'column', gap:0, padding:0, width:'min(840px, calc(100vw - 32px))', maxWidth:'none', height:'min(760px, calc(100dvh - 32px))', overflow:'hidden', background:'#16161e', isolation:'isolate' }}>
      <EmailPreviewContent email={email} dateLabel={dateLabel} onClose={onClose}/>
    </DialogContent>
  </Dialog>;
}
