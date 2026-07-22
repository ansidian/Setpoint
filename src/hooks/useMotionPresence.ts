import { useEffect, useState } from "react";

export default function useMotionPresence(visible: boolean, exitMs = 180): boolean {
  const [rendered, setRendered] = useState(visible);

  useEffect(() => {
    if (visible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- presence must remount before its entrance transition can run
      setRendered(true);
      return undefined;
    }
    if (!rendered) return undefined;
    const timer = window.setTimeout(() => setRendered(false), exitMs);
    return () => window.clearTimeout(timer);
  }, [exitMs, rendered, visible]);

  return rendered;
}
