import { useEffect, useRef } from "react";

const SPOTLIGHT_SIZE = 300;
const SPOTLIGHT_RADIUS = SPOTLIGHT_SIZE / 2;
const GRID_SIZE = 10;
const MAX_DPR = 2;
const SPOTLIGHT_OPACITY = 0.4;
const DOT_COLOR = "rgba(153, 124, 169, 0.9)";

function createPatternTile(dpr) {
  const tile = document.createElement("canvas");
  const tileSize = GRID_SIZE * dpr;
  tile.width = tileSize;
  tile.height = tileSize;

  const ctx = tile.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = DOT_COLOR;
  ctx.beginPath();
  ctx.arc(tileSize / 2, tileSize / 2, Math.max(0.7 * dpr, 0.7), 0, Math.PI * 2);
  ctx.fill();

  return tile;
}

function createMaskCanvas(dpr) {
  const maskCanvas = document.createElement("canvas");
  const size = SPOTLIGHT_SIZE * dpr;
  const radius = size / 2;

  maskCanvas.width = size;
  maskCanvas.height = size;

  const ctx = maskCanvas.getContext("2d");
  if (!ctx) return null;

  const gradient = ctx.createRadialGradient(
    radius,
    radius,
    0,
    radius,
    radius,
    radius,
  );
  gradient.addColorStop(0, "rgba(255,255,255,0.54)");
  gradient.addColorStop(0.52, "rgba(255,255,255,0.4)");
  gradient.addColorStop(0.78, "rgba(255,255,255,0)");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  return maskCanvas;
}

function drawSpotlight({
  ctx,
  canvas,
  patternTile,
  maskCanvas,
  dpr,
  left,
  top,
}) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const pattern = ctx.createPattern(patternTile, "repeat");
  if (!pattern) return;

  if (typeof pattern.setTransform === "function") {
    pattern.setTransform(new DOMMatrix().translate(-left * dpr, -top * dpr));
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    const tileSize = GRID_SIZE * dpr;
    const offsetX = -(((left % GRID_SIZE) + GRID_SIZE) % GRID_SIZE) * dpr;
    const offsetY = -(((top % GRID_SIZE) + GRID_SIZE) % GRID_SIZE) * dpr;
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.fillStyle = pattern;
    ctx.fillRect(
      -tileSize,
      -tileSize,
      canvas.width + tileSize * 2,
      canvas.height + tileSize * 2,
    );
    ctx.restore();
  }

  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(maskCanvas, 0, 0);
  ctx.globalCompositeOperation = "source-over";
}

export default function MouseSpotlightCanvas() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const finePointerQuery = window.matchMedia("(pointer: fine)");
    const reducedMotionQuery = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    if (!finePointerQuery.matches || reducedMotionQuery.matches)
      return undefined;

    let ctx = null;
    let patternTile = null;
    let maskCanvas = null;
    let dpr = 1;
    let rafId = 0;
    let visible = false;
    let latestX = -9999;
    let latestY = -9999;
    let lastLeft = Number.NaN;
    let lastTop = Number.NaN;
    let lastVisible = false;

    function rebuildResources() {
      dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, MAX_DPR));
      canvas.width = SPOTLIGHT_SIZE * dpr;
      canvas.height = SPOTLIGHT_SIZE * dpr;
      ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
      if (!ctx) return false;
      patternTile = createPatternTile(dpr);
      maskCanvas = createMaskCanvas(dpr);
      return !!patternTile && !!maskCanvas;
    }

    if (!rebuildResources()) return undefined;

    function applyFrame() {
      rafId = 0;

      const left = latestX - SPOTLIGHT_RADIUS;
      const top = latestY - SPOTLIGHT_RADIUS;
      const moved = left !== lastLeft || top !== lastTop;
      const visibilityChanged = visible !== lastVisible;

      if (visible && moved) {
        drawSpotlight({ ctx, canvas, patternTile, maskCanvas, dpr, left, top });
      }

      if (moved) {
        canvas.style.transform = `translate3d(${left}px, ${top}px, 0)`;
        lastLeft = left;
        lastTop = top;
      }

      if (visibilityChanged) {
        canvas.style.opacity = visible ? String(SPOTLIGHT_OPACITY) : "0";
        lastVisible = visible;
      }
    }

    function scheduleFrame() {
      if (!rafId) rafId = window.requestAnimationFrame(applyFrame);
    }

    function handlePointerMove(event) {
      latestX = event.clientX;
      latestY = event.clientY;
      visible = true;
      scheduleFrame();
    }

    function handlePointerLeave() {
      visible = false;
      scheduleFrame();
    }

    function handleMouseOut(event) {
      if (event.relatedTarget) return;
      handlePointerLeave();
    }

    function handleResize() {
      const nextDpr = Math.max(
        1,
        Math.min(window.devicePixelRatio || 1, MAX_DPR),
      );
      if (nextDpr !== dpr) {
        rebuildResources();
        lastLeft = Number.NaN;
        lastTop = Number.NaN;
      }
      if (visible) scheduleFrame();
    }

    window.addEventListener("mousemove", handlePointerMove, { passive: true });
    window.addEventListener("mouseout", handleMouseOut);
    window.addEventListener("blur", handlePointerLeave);
    window.addEventListener("resize", handleResize, { passive: true });

    return () => {
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseout", handleMouseOut);
      window.removeEventListener("blur", handlePointerLeave);
      window.removeEventListener("resize", handleResize);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="mouse-spotlight-canvas"
      aria-hidden="true"
    />
  );
}
