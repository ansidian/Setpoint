import { useCallback, useRef, useState } from "react";

export default function useDirtyCloseConfirmation(enabled: boolean) {
  const dirtyRef = useRef(false);
  const allowNextCloseRef = useRef(false);
  const [confirming, setConfirming] = useState(false);

  const beforeClose = useCallback(() => {
    if (allowNextCloseRef.current) {
      allowNextCloseRef.current = false;
      return true;
    }
    if (!enabled || !dirtyRef.current) return true;
    setConfirming(true);
    return false;
  }, [enabled]);
  const setDirty = useCallback((dirty: boolean) => { dirtyRef.current = dirty; }, []);
  const cancel = useCallback(() => setConfirming(false), []);
  const allowNextClose = useCallback(() => { allowNextCloseRef.current = true; }, []);

  return {
    confirming,
    beforeClose,
    setDirty,
    cancel,
    allowNextClose,
  };
}
