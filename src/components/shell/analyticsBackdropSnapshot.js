const MAX_CAPTURE_WIDTH = 1600;
const MAX_CAPTURE_HEIGHT = 1000;
const MAX_CAPTURE_PIXEL_RATIO = 0.55;
const MIN_CAPTURE_PIXEL_RATIO = 0.25;
const BLUR_RADIUS = 5;
const JPEG_QUALITY = 0.82;

let htmlToImageImportPromise = null;

function loadHtmlToImage() {
  if (!htmlToImageImportPromise) {
    htmlToImageImportPromise = import("html-to-image");
  }
  return htmlToImageImportPromise;
}

export function prewarmAnalyticsBackdropCapture() {
  if (typeof window === "undefined") return;
  void loadHtmlToImage();
}

export function resolveAnalyticsSnapshotScale({
  width,
  height,
  maxWidth = MAX_CAPTURE_WIDTH,
  maxHeight = MAX_CAPTURE_HEIGHT,
  maxPixelRatio = MAX_CAPTURE_PIXEL_RATIO,
  minPixelRatio = MIN_CAPTURE_PIXEL_RATIO,
} = {}) {
  const safeWidth = Number(width || 0);
  const safeHeight = Number(height || 0);
  if (!safeWidth || !safeHeight) return 1;

  const boundedScale = Math.min(
    maxPixelRatio,
    maxWidth / safeWidth,
    maxHeight / safeHeight,
    1,
  );
  return Math.max(minPixelRatio, boundedScale);
}

function blurCanvas(sourceCanvas) {
  const canvas = document.createElement("canvas");
  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;

  const context = canvas.getContext("2d");
  if (!context) return null;

  const pad = Math.ceil(BLUR_RADIUS * 2);
  context.filter = `blur(${BLUR_RADIUS}px) saturate(0.92) brightness(0.82)`;
  context.drawImage(
    sourceCanvas,
    -pad,
    -pad,
    canvas.width + pad * 2,
    canvas.height + pad * 2,
  );
  context.filter = "none";
  return canvas;
}

export async function captureAnalyticsBackdropSnapshot(sourceElement) {
  if (typeof document === "undefined" || !sourceElement) return null;

  const rect = sourceElement.getBoundingClientRect();
  const width = Math.round(rect.width || sourceElement.clientWidth || 0);
  const height = Math.round(rect.height || sourceElement.clientHeight || 0);
  if (!width || !height) return null;

  try {
    const { toCanvas } = await loadHtmlToImage();
    const pixelRatio = resolveAnalyticsSnapshotScale({ width, height });
    const sourceCanvas = await toCanvas(sourceElement, {
      backgroundColor: "#0b0c12",
      cacheBust: false,
      pixelRatio,
      skipFonts: true,
    });
    const blurredCanvas = blurCanvas(sourceCanvas);
    if (!blurredCanvas) return null;

    return {
      dataUrl: blurredCanvas.toDataURL("image/jpeg", JPEG_QUALITY),
      width,
      height,
      capturedWidth: blurredCanvas.width,
      capturedHeight: blurredCanvas.height,
      pixelRatio,
    };
  } catch (error) {
    console.warn("[EA] Failed to capture analytics backdrop snapshot:", error);
    return null;
  }
}
