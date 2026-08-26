import { useCallback, useEffect, useRef, useState } from "react";
import { FileWarning } from "lucide-react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

function EmailPdfPage({
  document,
  filename,
  pageNumber,
  renderWidth,
  scrollRootRef,
  onError,
}: {
  document: PDFDocumentProxy;
  filename: string;
  pageNumber: number;
  renderWidth: number;
  scrollRootRef: React.RefObject<HTMLDivElement | null>;
  onError: () => void;
}) {
  const pageRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [shouldRender, setShouldRender] = useState(() => typeof IntersectionObserver === "undefined");
  const [rendered, setRendered] = useState(false);
  const [pageText, setPageText] = useState("");

  useEffect(() => {
    const page = pageRef.current;
    const scrollRoot = scrollRootRef.current;
    if (!page || !scrollRoot || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setShouldRender(true);
      observer.disconnect();
    }, {
      root: scrollRoot,
      rootMargin: "100% 0px",
    });
    observer.observe(page);
    return () => observer.disconnect();
  }, [document, pageNumber, scrollRootRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!shouldRender || !canvas || renderWidth <= 0) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;

    document.getPage(pageNumber)
      .then(async (page) => {
        if (cancelled) return null;
        const naturalViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(2.4, renderWidth / naturalViewport.width);
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
        if (cancelled || text == null) return;
        setPageText(text || "No extractable text is available for this PDF page.");
        setRendered(true);
      })
      .catch((cause: unknown) => {
        if (cancelled || (cause instanceof Error && cause.name === "RenderingCancelledException")) return;
        onError();
      });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, onError, pageNumber, renderWidth, shouldRender]);

  return (
    <section
      ref={pageRef}
      className={`email-pdf-preview-page${rendered ? " email-pdf-preview-page-rendered" : ""}`}
      aria-label={`Page ${pageNumber} of ${filename}`}
    >
      <canvas
        ref={canvasRef}
        className="email-pdf-preview-canvas"
        aria-hidden="true"
      />
      {!rendered ? (
        <div className="email-pdf-preview-page-loading" aria-hidden="true">
          <span className="email-attachment-preview-spinner" />
          <span>Rendering page {pageNumber}…</span>
        </div>
      ) : null}
      {pageText ? (
        <div
          className="email-pdf-preview-accessible"
          role="document"
          aria-label={`Page ${pageNumber} of ${filename}`}
        >
          {pageText}
        </div>
      ) : null}
    </section>
  );
}

export default function EmailPdfPreview({
  objectUrl,
  filename,
}: {
  objectUrl: string;
  filename: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [renderWidth, setRenderWidth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    setDocument(null);
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
        setLoading(false);
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

  const handlePageError = useCallback(() => {
    setError("This PDF page could not be rendered. Download it to view the original file.");
  }, []);

  return (
    <div
      className="email-pdf-preview"
      ref={viewportRef}
      tabIndex={0}
      aria-label={document
        ? `Scrollable PDF preview of ${filename}, ${document.numPages} page${document.numPages === 1 ? "" : "s"}`
        : `PDF preview of ${filename}`}
    >
      {error ? (
        <div className="email-attachment-preview-state email-attachment-preview-error" role="alert">
          <FileWarning size={26} aria-hidden="true" />
          <strong>PDF preview unavailable</strong>
          <span>{error}</span>
        </div>
      ) : document ? (
        <div className="email-pdf-preview-pages">
          {Array.from({ length: document.numPages }, (_, index) => (
            <EmailPdfPage
              key={index + 1}
              document={document}
              filename={filename}
              pageNumber={index + 1}
              renderWidth={renderWidth}
              scrollRootRef={viewportRef}
              onError={handlePageError}
            />
          ))}
        </div>
      ) : null}

      {loading && !error ? (
        <div className="email-pdf-preview-loading" role="status">
          <span className="email-attachment-preview-spinner" aria-hidden="true" />
          <span>Rendering PDF…</span>
        </div>
      ) : null}
    </div>
  );
}
