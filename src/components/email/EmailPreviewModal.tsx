import type { RefObject } from 'react';
import { ArrowRight } from 'lucide-react';
import { Dialog, DialogContent } from '../ui/dialog';
import { Button } from '../ui/button';
import EmailPreviewContent, { type EmailPreviewMessage } from './EmailPreviewContent';

/** Shared source reading dialog with optional navigation to the Inbox reader. */
export default function EmailPreviewModal({ email, dateLabel, dateTitle, triggerRef, onClose, onJumpToInbox }: {
  email: EmailPreviewMessage; dateLabel: string; dateTitle?: string; triggerRef: RefObject<HTMLElement | null>; onClose: () => void;
  onJumpToInbox?: () => void;
}) {
  return <Dialog open modal onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent aria-label="Email preview" showCloseButton={false} finalFocus={triggerRef} data-suspend-calendar-hotkeys="all"
      overlayStyle={{ zIndex: "calc(var(--z-popover) + 1)", background:'#0009', backdropFilter:'none', WebkitBackdropFilter:'none' }}
      style={{ zIndex: "calc(var(--z-popover) + 2)", display:'flex', flexDirection:'column', gap:0, padding:0, width:'min(1200px, 88vw, calc(100vw - 32px))', maxWidth:'none', height:'calc(100dvh - clamp(32px, 6dvh, 112px))', overflow:'hidden', background:'#16161e', isolation:'isolate' }}>
      <EmailPreviewContent email={email} dateLabel={dateLabel} dateTitle={dateTitle} onClose={onClose}/>
      {onJumpToInbox && <div className="flex shrink-0 justify-end border-t border-white/[0.06] px-4 py-3">
        <Button onClick={onJumpToInbox} className="h-auto min-h-9 gap-1.5 rounded-[6px] border-[#ffffff24] bg-primary px-3 py-2 text-xs font-normal leading-[18px] text-primary-foreground hover:bg-primary hover:brightness-[1.12] focus-visible:-translate-y-px focus-visible:ring-2 focus-visible:ring-primary active:translate-y-px motion-reduce:transform-none motion-reduce:transition-none">Jump to inbox<ArrowRight aria-hidden="true" /></Button>
      </div>}
    </DialogContent>
  </Dialog>;
}
