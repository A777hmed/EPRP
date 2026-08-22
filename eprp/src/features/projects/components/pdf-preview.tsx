"use client";

import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Maximize2,
  Minus,
  Plus,
} from "lucide-react";

import { Button } from "@/components/ui/button";

/** Zoom steps, as multiples of fit-width. Fit Width returns to 1. */
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;
const FIT_INDEX = ZOOM_STEPS.indexOf(1);

/**
 * In-app PDF preview, rendered to canvas with PDF.js.
 *
 * The platform cannot rely on the host's native PDF viewer. The desktop shell
 * is Electron, which does not ship Chrome's PDF plugin: a signed URL with a
 * correct `application/pdf` content type, valid bytes and no framing
 * restrictions still renders an empty frame there, and a top-level navigation
 * to it downloads instead of displaying. Verified directly — a known-good,
 * same-origin PDF blob in a full-size iframe produced a document with zero
 * child nodes. Rendering the pages ourselves removes that dependency entirely.
 *
 * LOADING AND RENDERING DELIBERATELY SHARE ONE EFFECT, and the document proxy
 * stays a local variable rather than React state. Splitting them was tried and
 * broke: the load effect's cleanup calls `destroy()` on the loading task, which
 * terminates the worker, so a proxy parked in state could outlive the task that
 * owns it. Page 1 still came from cache and every later `getPage` hung forever
 * with no error to show. Keeping the proxy inside the effect that owns its task
 * makes that whole class of bug unreachable.
 *
 * The cost is that changing zoom re-opens the document. pdf.js serves the
 * refetch from the HTTP cache, and correctness is worth more than the saving.
 *
 * Everything here is client-side and read-only. The file comes from the same
 * short-lived signed URL the rest of the panel uses; nothing is cached, stored
 * or re-uploaded.
 */
export function PdfPreview({
  url,
  title,
  onDownload,
}: {
  url: string;
  title: string;
  onDownload?: () => void;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const pagesRef = React.useRef<HTMLDivElement>(null);
  /** Page canvases in order, so navigation can scroll to one by index. */
  const canvasesRef = React.useRef<HTMLCanvasElement[]>([]);

  const [state, setState] = React.useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [message, setMessage] = React.useState<string>();
  const [pageCount, setPageCount] = React.useState(0);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [zoomIndex, setZoomIndex] = React.useState<number>(FIT_INDEX);

  /*
   * The page being read, mirrored into a ref so the effect can restore the
   * reading position after a zoom without taking `currentPage` as a dependency
   * — scrolling would otherwise re-render every page.
   */
  const currentPageRef = React.useRef(1);
  const setPage = React.useCallback((page: number) => {
    currentPageRef.current = page;
    setCurrentPage(page);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    /*
     * The LOADING TASK owns teardown, not the document proxy: `destroy()`
     * aborts in-flight requests and terminates the worker.
     */
    let task: { destroy: () => Promise<void> } | undefined;

    const run = async () => {
      const container = pagesRef.current;
      const scroller = scrollRef.current;
      if (!container || !scroller) return;

      setState("loading");
      setMessage(undefined);
      const anchorPage = currentPageRef.current;

      try {
        // Imported inside the effect: pdf.js touches DOM APIs on load and must
        // never be pulled into a server render.
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();

        const loadingTask = pdfjs.getDocument({ url });
        task = loadingTask;
        const doc = await loadingTask.promise;
        if (cancelled) return;
        setPageCount(doc.numPages);

        const zoom = ZOOM_STEPS[zoomIndex];
        // Cap the raster scale so a long document does not allocate an
        // unreasonable amount of canvas memory on a high-DPI screen.
        const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
        const canvases: HTMLCanvasElement[] = [];
        container.replaceChildren();

        for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
          if (cancelled) return;
          const page = await doc.getPage(pageNumber);
          const natural = page.getViewport({ scale: 1 });

          // Fit-width is the baseline; zoom multiplies it.
          const available = scroller.clientWidth - 32;
          const fit = Math.max(available / natural.width, 0.1);
          const scaled = page.getViewport({ scale: fit * zoom });

          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(scaled.width * dpr);
          canvas.height = Math.floor(scaled.height * dpr);
          canvas.style.width = `${Math.floor(scaled.width)}px`;
          canvas.style.height = `${Math.floor(scaled.height)}px`;
          canvas.className = "mx-auto mb-3 block rounded-sm bg-white shadow-sm";
          canvas.setAttribute(
            "aria-label",
            `${title} — page ${pageNumber} of ${doc.numPages}`
          );

          const context = canvas.getContext("2d");
          if (!context) continue;
          context.scale(dpr, dpr);
          container.append(canvas);
          canvases.push(canvas);

          await page.render({ canvas, canvasContext: context, viewport: scaled })
            .promise;
          page.cleanup();
        }

        if (cancelled) return;
        canvasesRef.current = canvases;
        setState("ready");

        // Return the reader to where they were before the zoom changed.
        if (anchorPage > 1 && canvases[anchorPage - 1]) {
          canvases[anchorPage - 1].scrollIntoView({ block: "start" });
        }
      } catch (cause) {
        /*
         * Without this the spinner runs forever: a rejected async effect leaves
         * the toolbar disabled with nothing on screen explaining why.
         */
        if (cancelled) return;
        setState("error");
        setMessage(
          cause instanceof Error ? cause.message : "The file could not be read."
        );
      }
    };

    void run();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [url, zoomIndex, title]);

  const handleScroll = React.useCallback(() => {
    const scroller = scrollRef.current;
    const canvases = canvasesRef.current;
    if (!scroller || canvases.length === 0) return;
    // The last page whose top has passed the reading line is the one on screen.
    const marker = scroller.getBoundingClientRect().top + 80;
    let page = 1;
    for (let index = 0; index < canvases.length; index++) {
      if (canvases[index].getBoundingClientRect().top <= marker) page = index + 1;
      else break;
    }
    setPage(page);
  }, [setPage]);

  const goToPage = (page: number) => {
    const target = canvasesRef.current[page - 1];
    if (!target) return;
    target.scrollIntoView({ block: "start", behavior: "smooth" });
    setPage(page);
  };

  const busy = state === "loading";
  const zoomPercent = Math.round(ZOOM_STEPS[zoomIndex] * 100);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b bg-muted/30 px-2 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Previous page"
          disabled={busy || currentPage <= 1}
          onClick={() => goToPage(currentPage - 1)}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Next page"
          disabled={busy || currentPage >= pageCount}
          onClick={() => goToPage(currentPage + 1)}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>

        <span
          className="px-1.5 text-xs tabular-nums text-muted-foreground"
          aria-live="polite"
        >
          {pageCount ? `${currentPage} / ${pageCount}` : "—"}
        </span>

        <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Zoom out"
          disabled={busy || zoomIndex <= 0}
          onClick={() => setZoomIndex((index) => Math.max(0, index - 1))}
        >
          <Minus className="size-4" aria-hidden="true" />
        </Button>
        <span className="min-w-11 text-center text-xs tabular-nums text-muted-foreground">
          {zoomPercent}%
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Zoom in"
          disabled={busy || zoomIndex >= ZOOM_STEPS.length - 1}
          onClick={() =>
            setZoomIndex((index) => Math.min(ZOOM_STEPS.length - 1, index + 1))
          }
        >
          <Plus className="size-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          aria-label="Fit width"
          disabled={busy || zoomIndex === FIT_INDEX}
          onClick={() => setZoomIndex(FIT_INDEX)}
        >
          <Maximize2 className="size-3.5" aria-hidden="true" />
          Fit Width
        </Button>

        {onDownload && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-7 px-2 text-xs"
            onClick={onDownload}
          >
            <Download className="size-3.5" aria-hidden="true" />
            Download
          </Button>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        {busy && (
          <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-center gap-2 bg-background/80 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Rendering document…
          </div>
        )}
        {state === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-sm font-medium">This PDF could not be displayed</p>
            <p className="text-sm text-muted-foreground">{message}</p>
          </div>
        )}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-auto p-3"
        >
          <div ref={pagesRef} role="document" aria-label={title} />
        </div>
      </div>
    </div>
  );
}
