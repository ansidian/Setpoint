import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";

export type InboxDiscardRequest = (dirty: boolean, onDiscard: () => void) => boolean;
interface PendingDiscard { scope: string; proceed: () => void }

/** Keeps the editor intact until the owner explicitly discards its changes. */
export default function useInboxDiscardPrompt(scope: string) {
  const [pending, setPending] = useState<PendingDiscard | null>(null);
  const [completedDiscard, setCompletedDiscard] = useState<PendingDiscard | null>(null);
  const pendingRef = useRef<PendingDiscard | null>(null);
  const continuationRef = useRef<PendingDiscard | null>(null);
  const activeScopeRef = useRef<string | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const skipReturnFocusRef = useRef(false);

  useLayoutEffect(() => {
    activeScopeRef.current = scope;
    return () => {
      // Activity hides tear down effects without losing the editor's state.
      // A deferred navigation must never survive that leave or a new email.
      activeScopeRef.current = null;
      pendingRef.current = null;
      continuationRef.current = null;
      setPending(null);
      setCompletedDiscard(null);
    };
  }, [scope]);

  const cancelDiscard = useCallback(() => {
    pendingRef.current = null;
    continuationRef.current = null;
    setPending(null);
  }, []);
  const requestDiscard = useCallback<InboxDiscardRequest>((dirty, proceed) => {
    if (!dirty) return true;
    if (activeScopeRef.current !== scope) return false;
    // While a choice is pending, preserve the originally requested action.
    if (pendingRef.current || continuationRef.current) return false;
    const next = { scope, proceed };
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    skipReturnFocusRef.current = false;
    pendingRef.current = next;
    setCompletedDiscard(null);
    setPending(next);
    return false;
  }, [scope]);
  const discard = () => {
    const current = pendingRef.current;
    if (!current || activeScopeRef.current !== current.scope) return;
    pendingRef.current = null;
    continuationRef.current = current;
    skipReturnFocusRef.current = true;
    setPending(null);
  };
  useEffect(() => {
    // BaseUI's completion callback marks its portal unmounted. Continue in the
    // following effect, after that portal's focus and aria-hidden cleanups,
    // so a new foreground dialog can take ownership without a competing close.
    if (!completedDiscard || continuationRef.current !== completedDiscard) return;
    continuationRef.current = null;
    if (activeScopeRef.current === completedDiscard.scope) completedDiscard.proceed();
  }, [completedDiscard]);
  const confirming = pending?.scope === scope;
  const dialog = (
    <Dialog
      open={confirming}
      onOpenChange={(open) => { if (!open) cancelDiscard(); }}
      onOpenChangeComplete={(open) => { if (!open && continuationRef.current) setCompletedDiscard(continuationRef.current); }}
    >
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/20 supports-backdrop-filter:backdrop-blur-none motion-reduce:animate-none"
        overlayStyle={{ zIndex: "calc(var(--z-popover) + 1)" }}
        className="gap-3 bg-[#16161e] motion-reduce:animate-none"
        style={{ zIndex: "calc(var(--z-popover) + 2)" }}
        finalFocus={() => !skipReturnFocusRef.current && returnFocusRef.current?.isConnected ? returnFocusRef.current : false}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          // The underlying task editor also handles Escape. Only this prompt
          // should consume it, leaving that editor and its draft untouched.
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancelDiscard();
          }
        }}
      >
        <DialogTitle>Discard unsaved changes?</DialogTitle>
        <DialogDescription>Your reminder or reply has changes that haven’t been saved.</DialogDescription>
        <div className="mt-1 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" className="min-h-11 hover:-translate-y-px focus-visible:-translate-y-px active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none" onClick={cancelDiscard}>Keep editing</Button>
          <Button variant="destructive" className="min-h-11 hover:-translate-y-px focus-visible:-translate-y-px active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none" onClick={discard}>Discard changes</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
  return { requestDiscard, cancelDiscard, confirming, dialog };
}
