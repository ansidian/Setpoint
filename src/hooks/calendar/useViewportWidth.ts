import { useEffect, useRef, useState } from "react";

export default function useViewportWidth(): number {
  const [viewportWidth, setViewportWidth] = useState(() => (
    typeof window === "undefined" ? 0 : window.innerWidth
  ));
  const resizeRafRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    function handleResize(): void {
      if (resizeRafRef.current) return;
      resizeRafRef.current = window.requestAnimationFrame(() => {
        resizeRafRef.current = 0;
        setViewportWidth((current) => (
          current === window.innerWidth ? current : window.innerWidth
        ));
      });
    }

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (resizeRafRef.current) {
        window.cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = 0;
      }
    };
  }, []);

  return viewportWidth;
}
