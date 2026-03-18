import * as Comlink from "comlink";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import type {
  DrawInstructionV3,
  PdfRendererWorkerApi,
  PreparedImage,
} from "./pdf-worker-types";

function toJsPdfFormat(mimeType: PreparedImage["mimeType"]): "JPEG" | "PNG" {
  return mimeType === "image/png" ? "PNG" : "JPEG";
}

function renderInstructions(doc: jsPDF, instructions: DrawInstructionV3[], imageMap: Record<string, PreparedImage>) {
  for (const instruction of instructions) {
    if (instruction.type === "text") {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(instruction.fontSize);
      doc.text(instruction.lines, instruction.x, instruction.y, {
        align: instruction.align,
        maxWidth: instruction.maxWidth,
      });
      continue;
    }

    if (instruction.type === "image") {
      const image = imageMap[instruction.imageKey];

      if (!image) {
        continue;
      }

      doc.addImage(
        image.dataUrl,
        toJsPdfFormat(image.mimeType),
        instruction.x,
        instruction.y,
        instruction.width,
        instruction.height,
      );
      continue;
    }

    autoTable(doc, {
      startY: instruction.startY,
      theme: "grid",
      head: instruction.head,
      body: instruction.body,
      headStyles: instruction.headStyles,
      bodyStyles: instruction.bodyStyles,
      columnStyles: instruction.columnStyles,
      margin: { left: 20, right: 20 },
    });
  }
}

const api: PdfRendererWorkerApi = {
  async renderPage(payload) {
    const doc = new jsPDF("p", "px", payload.pageSize);
    renderInstructions(doc, payload.instructions, payload.imageMap);
    const result = doc.output("arraybuffer");
    return Comlink.transfer(result, [result]);
  },
};

Comlink.expose(api);
