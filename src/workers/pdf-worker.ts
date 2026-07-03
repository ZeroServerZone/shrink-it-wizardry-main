/// <reference lib="webworker" />
import { PDFDocument } from "pdf-lib";

type Msg =
  | { type: "compress-pdf"; id: string; buffer: ArrayBuffer }
  | { type: "image-to-pdf"; id: string; buffers: ArrayBuffer[]; mimes: string[] };

self.onmessage = async (e: MessageEvent<Msg>) => {
  const msg = e.data;
  try {
    if (msg.type === "compress-pdf") {
      const src = await PDFDocument.load(msg.buffer, { ignoreEncryption: true });
      const out = await PDFDocument.create();
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
      const bytes = await out.save({ useObjectStreams: true });
      (self as unknown as Worker).postMessage(
        { type: "done", id: msg.id, buffer: bytes.buffer, mime: "application/pdf", ext: "pdf" },
        [bytes.buffer],
      );
    } else if (msg.type === "image-to-pdf") {
      const out = await PDFDocument.create();
      for (let i = 0; i < msg.buffers.length; i++) {
        const buf = msg.buffers[i];
        const mime = msg.mimes[i];
        const img = mime.includes("png")
          ? await out.embedPng(buf)
          : await out.embedJpg(buf);
        const page = out.addPage([img.width, img.height]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      }
      const bytes = await out.save();
      (self as unknown as Worker).postMessage(
        { type: "done", id: msg.id, buffer: bytes.buffer, mime: "application/pdf", ext: "pdf" },
        [bytes.buffer],
      );
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({
      type: "error",
      id: msg.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
