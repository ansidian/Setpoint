import { useEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { motion, useIsPresent, useReducedMotion } from 'motion/react';
import { motionTransition } from '../../lib/motion';
import useMediaQuery from '../../hooks/useMediaQuery';
import { Dialog, DialogContent } from '../ui/dialog';

/** Desktop details occupy the calendar column; mobile details protect focus. */
type Props = { children: ReactNode; onClose: () => void; triggerRef: RefObject<HTMLElement | null>; identity: string };

export default function FinanceDetailDrawer(props: Props) {
  const mobile = useMediaQuery('(max-width: 767px)');
  return mobile ? <MobileFinanceDetail {...props}/> : <DesktopFinanceDetail {...props}/>;
}

function MobileFinanceDetail({ children, onClose, triggerRef, identity }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const present = useIsPresent();
  useEffect(() => { if (panelRef.current) panelRef.current.scrollTop = 0; }, [identity]);
  return <Dialog modal open={present} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent ref={panelRef} className="fin-workspace fin-mobile-detail" aria-label="Payment details" aria-modal="true"
      showCloseButton={false} finalFocus={triggerRef} data-suspend-calendar-hotkeys="blocking"
      overlayStyle={{ background: '#0009', backdropFilter: 'none', WebkitBackdropFilter: 'none' }}>
      <div className="fin-detail">{children}</div>
    </DialogContent>
  </Dialog>;
}

function DesktopFinanceDetail({ children, onClose, triggerRef, identity }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const present = useIsPresent();
  const reduceMotion = useReducedMotion() ?? false;
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!present) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onClose(); }
    };
    const panel = panelRef.current;
    panel?.addEventListener('keydown', escape);
    return () => panel?.removeEventListener('keydown', escape);
  }, [present, onClose]);
  useEffect(() => { if (panelRef.current) panelRef.current.scrollTop = 0; }, [identity]);
  useEffect(() => {
    const panel = panelRef.current;
    return () => {
      // Retargeting keeps this drawer mounted; restore the latest item, not the first.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const trigger = triggerRef.current;
      if (trigger?.isConnected && (panel?.contains(document.activeElement) || document.activeElement === document.body)) {
        trigger.focus({ preventScroll: true });
      }
    };
  }, [triggerRef]);
  return <motion.div className="fin-detail-panel" ref={panelRef}
    role="region" aria-label="Payment details" tabIndex={-1}
    initial={{ x: reduceMotion ? 0 : 12, opacity: reduceMotion ? 1 : 0 }}
    exit={{ x: reduceMotion ? 0 : 8, opacity: 0 }}
    animate={{ x: 0, opacity: 1 }} transition={motionTransition(reduceMotion)}>
    <div className="fin-detail">{children}</div>
  </motion.div>;
}
