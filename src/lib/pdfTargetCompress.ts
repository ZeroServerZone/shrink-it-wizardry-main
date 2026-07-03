// Client-side "compress PDF to a target size" utility.
//
// Strategy: PDF text-layout compression has very little headroom (pdf-lib can
// only strip redundant objects). To reliably hit a user-chosen target size we
// rasterize each page with pdf.js, re-encode the page as a JPEG at a given
// DPI/quality, and rebuild a new PDF from those images with pdf-lib. We walk
// a DPI ladder (outer) and a JPEG-quality ladder (inner) from high to low
// fidelity until the rebuilt PDF is at/under the target, keeping the best
// (smallest that still fits, otherwise the smallest overall) result.
//
// Trade-off: pages become images, so text stops being selectable. This is
// the same approach most "compress PDF to X KB" tools use once ordinary
// stream optimization can't reach the target. Everything runs in the
// browser — nothing is uploaded anywhere.

import * as pdfjsLib from "pdfjs-dist";
// Vite bundles the worker file and gives us a hashed URL to it.
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

let workerConfigured = false;
function ensureWorker() {
  if (!workerConfigured) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;
    workerConfigured = true;
  }
}

export interface PdfCompressResult {
  blob: Blob;
  bytes: number;
  hitTarget: boolean;
  pageCount: number;
}

interface RenderedPage {
  width: number;
  height: number;
  canvas: HTMLCanvasElement;
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas encoding failed"))),
      "image/jpeg",
      quality,
    );
  });
}

// pdf.js viewport `scale` of 1 == the PDF's native 72dpi point size.
// These roughly correspond to ~130dpi down to ~40dpi.
const SCALE_LADDER = [1.8, 1.3, 1.0, 0.65, 0.45];
const QUALITY_LADDER = [0.85, 0.7, 0.55, 0.4, 0.28, 0.18];

export async function compressPdfToTarget(
  file: File,
  targetBytes: number,
  onProgress?: (pct: number) => void,
): Promise<PdfCompressResult> {
  ensureWorker();
  const { PDFDocument } = await import("pdf-lib");

  const srcBuf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: srcBuf }).promise;
  const pageCount = pdf.numPages;
  if (pageCount === 0) throw new Error("PDF has no pages");

  async function renderPagesAtScale(scale: number): Promise<RenderedPage[]> {
    const rendered: RenderedPage[] = [];
    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext("2d", { willReadFrequently: false });
      if (!ctx) throw new Error("Canvas not supported in this browser");
      // Flatten onto white so JPEG (no alpha) doesn't turn transparent areas black.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      rendered.push({ width: viewport.width, height: viewport.height, canvas });
    }
    return rendered;
  }

  async function buildPdf(pages: RenderedPage[], quality: number): Promise<Blob> {
    const out = await PDFDocument.create();
    for (const p of pages) {
      const jpegBlob = await canvasToJpegBlob(p.canvas, quality);
      const jpegBuf = await jpegBlob.arrayBuffer();
      const img = await out.embedJpg(jpegBuf);
      const pageRef = out.addPage([p.width, p.height]);
      pageRef.drawImage(img, { x: 0, y: 0, width: p.width, height: p.height });
    }
    const bytes = await out.save();
    return new Blob([bytes], { type: "application/pdf" });
  }

  let best: { blob: Blob; bytes: number } | null = null;
  let hitTarget = false;
  const totalSteps = SCALE_LADDER.length * QUALITY_LADDER.length;
  let step = 0;

  outer: for (const scale of SCALE_LADDER) {
    const pages = await renderPagesAtScale(scale);
    onProgress?.(Math.min(35, Math.round(((step + 1) / totalSteps) * 35)));

    for (const quality of QUALITY_LADDER) {
      const blob = await buildPdf(pages, quality);
      step += 1;
      onProgress?.(35 + Math.round((step / totalSteps) * 60));

      if (!best || blob.size < best.bytes) best = { blob, bytes: blob.size };
      if (blob.size <= targetBytes) {
        hitTarget = true;
        best = { blob, bytes: blob.size };
        break outer;
      }
    }
  }

  onProgress?.(100);
  if (!best) throw new Error("Could not compress this PDF");
  return { blob: best.blob, bytes: best.bytes, hitTarget, pageCount };
}
