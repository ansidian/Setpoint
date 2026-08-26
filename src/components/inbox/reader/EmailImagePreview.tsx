import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
const ZOOM_FACTOR = 1.25;

function clampScale(scale: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(scale * 100) / 100));
}

export default function EmailImagePreview({
  objectUrl,
  filename,
  onError,
}: {
  objectUrl: string;
  filename: string;
  onError: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [mode, setMode] = useState<"fit" | "custom">("fit");
  const [customScale, setCustomScale] = useState(1);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => setViewportSize({ width: root.clientWidth, height: root.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const fitScale = useMemo(() => {
    if (!naturalSize.width || !naturalSize.height || !viewportSize.width || !viewportSize.height) return 1;
    const availableWidth = Math.max(1, viewportSize.width - 32);
    const availableHeight = Math.max(1, viewportSize.height - 88);
    return Math.max(0.01, Math.min(1, availableWidth / naturalSize.width, availableHeight / naturalSize.height));
  }, [naturalSize, viewportSize]);
  const scale = mode === "fit" ? fitScale : customScale;
  const renderedWidth = naturalSize.width ? Math.max(1, naturalSize.width * scale) : 0;
  const renderedHeight = naturalSize.height ? Math.max(1, naturalSize.height * scale) : 0;
  const stageWidth = Math.max(viewportSize.width, renderedWidth);
  const stageHeight = Math.max(viewportSize.height, renderedHeight);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const frame = window.requestAnimationFrame(() => {
      viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2);
      viewport.scrollTop = Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scale, stageHeight, stageWidth]);

  const zoom = (factor: number) => {
    setCustomScale(clampScale(scale * factor));
    setMode("custom");
  };

  return (
    <div className="email-image-preview" ref={rootRef}>
      <div className="email-image-preview-viewport" ref={viewportRef}>
        <div
          className="email-image-preview-stage"
          style={{
            width: stageWidth || "100%",
            height: stageHeight || "100%",
          }}
        >
          <img
            className="email-attachment-preview-image"
            src={objectUrl}
            alt={filename}
            style={renderedWidth && renderedHeight ? { width: renderedWidth, height: renderedHeight } : undefined}
            onLoad={(event) => {
              setNaturalSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              });
            }}
            onError={onError}
          />
        </div>
      </div>
      <nav className="email-image-preview-controls" aria-label="Image zoom controls">
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          disabled={scale <= MIN_SCALE}
          onClick={() => zoom(1 / ZOOM_FACTOR)}
        >
          <ZoomOut size={16} aria-hidden="true" />
        </button>
        <span className="email-image-preview-scale" aria-live="polite">{Math.round(scale * 100)}%</span>
        <button
          type="button"
          className="email-image-preview-fit"
          aria-label="Fit image to window"
          title="Fit image to window"
          disabled={mode === "fit"}
          onClick={() => setMode("fit")}
        >
          <Maximize2 size={15} aria-hidden="true" />
          <span>Fit</span>
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          disabled={scale >= MAX_SCALE}
          onClick={() => zoom(ZOOM_FACTOR)}
        >
          <ZoomIn size={16} aria-hidden="true" />
        </button>
      </nav>
    </div>
  );
}
