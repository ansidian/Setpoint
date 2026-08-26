import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileWarning } from "lucide-react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export default function EmailPdfPreview({
  objectUrl,
  filename,
}: {
  objectUrl: string;
  filename: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [renderWidth, setRenderWidth] = useState(0);
  const [pageText, setPageText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    setDocument(null);
    setPageNumber(1);
    setLoading(true);
    setError(null);

    import("pdfjs-dist")
      .then(({ getDocument, GlobalWorkerOptions }) => {
        if (cancelled) return null;
        GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        loadingTask = getDocument({ url: objectUrl });
        return loadingTask.promise;
      })
      .then((pdfDocument) => {
        if (!pdfDocument || cancelled) return;
        setDocument(pdfDocument);
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
          setError("This PDF could not be rendered. Download it to view the original file.");
        }
      });

    return () => {
      cancelled = true;
      void loadingTask?.destroy();
    };
  }, [objectUrl]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateWidth = () => setRenderWidth(Math.max(0, viewport.clientWidth - 32));
    updateWidth();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateWidth);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!document || !canvas || renderWidth <= 0) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;

    setLoading(true);
    setError(null);
    setPageText("");
    document.getPage(pageNumber)
      .then(async (page) => {
        if (cancelled) return null;
        const naturalViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(1.6, renderWidth / naturalViewport.width);
        const viewport = page.getViewport({ scale });
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas rendering is unavailable");

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        });
        const [, textContent] = await Promise.all([renderTask.promise, page.getTextContent()]);
        return textContent.items
          .map((item) => ("str" in item ? item.str : ""))
          .filter(Boolean)
          .join(" ");
      })
      .then((text) => {
        if (!cancelled) {
          setPageText(text || "No extractable text is available for this PDF page.");
          setLoading(false);
        }
      })
      .catch((cause: unknown) => {
        if (cancelled || (cause instanceof Error && cause.name === "RenderingCancelledException")) return;
        setLoading(false);
        setError("This PDF page could not be rendered. Download it to view the original file.");
      });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, pageNumber, renderWidth]);

  return (
    <div className="email-pdf-preview" ref={viewportRef}>
      {error ? (
        <div className="email-attachment-preview-state email-attachment-preview-error" role="alert">
          <FileWarning size={26} aria-hidden="true" />
          <strong>PDF preview unavailable</strong>
          <span>{error}</span>
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          className="email-pdf-preview-canvas"
          aria-hidden="true"
        />
      )}

      {!error && pageText ? (
        <div
          className="email-pdf-preview-accessible"
          role="document"
          aria-label={`Page ${pageNumber} of ${filename}`}
        >
          {pageText}
        </div>
      ) : null}

      {loading && !error ? (
        <div className="email-pdf-preview-loading" role="status">
          <span className="email-attachment-preview-spinner" aria-hidden="true" />
          <span>Rendering PDF…</span>
        </div>
      ) : null}

      {document && document.numPages > 1 ? (
        <nav className="email-pdf-preview-pagination" aria-label="PDF pages">
          <button
            type="button"
            aria-label="Previous page"
            disabled={pageNumber <= 1}
            onClick={() => setPageNumber((page) => Math.max(1, page - 1))}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <span>{pageNumber} / {document.numPages}</span>
          <button
            type="button"
            aria-label="Next page"
            disabled={pageNumber >= document.numPages}
            onClick={() => setPageNumber((page) => Math.min(document.numPages, page + 1))}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </nav>
      ) : null}
    </div>
  );
}
