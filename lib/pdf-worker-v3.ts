import * as Comlink from "comlink";
import { PDFDocument } from "pdf-lib";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { Styles } from "jspdf-autotable";

import type { IHeading, IImg, IPage, ITable, IText } from "./pdf";
import type {
  ImagePreloaderWorkerApi,
  PageInstructionSetV3,
  PdfExportItem,
  PdfRendererWorkerApi,
  PreparedImage,
  TableInstructionV3,
  TextInstructionV3,
} from "./workers/pdf-worker-types";

interface ExportOptionsV3 {
  headerImg?: string;
  workerCount?: number;
  imageWorkerCount?: number;
}

interface PlannerContext {
  doc: jsPDF;
  pageWidth: number;
  pageHeight: number;
  margin: number;
  contentWidth: number;
  headerImage?: PreparedImage;
}

type WorkerRef<T> = {
  remote: Comlink.Remote<T>;
  instance: Worker;
};

const MARGIN = 20;
const SECTION_GAP = 14;
const TEXT_LINE_HEIGHT_RATIO = 1.35;
const HEADING_SIZES: Record<number, number> = {
  1: 24,
  2: 20,
  3: 18,
  4: 16,
  5: 14,
  6: 12,
};
const CATALOG_TITLE = "目录";
const CATALOG_TITLE_SIZE = 16;
const CATALOG_ITEM_SIZE = 12;

function getWorkerCount(input?: number): number {
  return Math.max(1, input ?? Math.min(navigator.hardwareConcurrency || 4, 4));
}

function getHeadingSize(level: number): number {
  return HEADING_SIZES[level] ?? 14;
}

function createPdfDoc(pageSize: string) {
  return new jsPDF("p", "px", pageSize);
}

async function disposeWorkers<T>(workers: WorkerRef<T>[]) {
  for (const worker of workers) {
    (worker.remote as unknown as { [Comlink.releaseProxy]?: () => void })[
      Comlink.releaseProxy
    ]?.();
    worker.instance.terminate();
  }
}

function createImagePreloaderWorkerRef(): WorkerRef<ImagePreloaderWorkerApi> {
  const instance = new Worker(
    new URL("./workers/image-preloader.worker.ts", import.meta.url),
    { type: "module" },
  );

  return {
    instance,
    remote: Comlink.wrap<ImagePreloaderWorkerApi>(instance),
  };
}

function createPdfRendererWorkerRef(): WorkerRef<PdfRendererWorkerApi> {
  const instance = new Worker(
    new URL("./workers/pdf-renderer.worker.ts", import.meta.url),
    { type: "module" },
  );

  return {
    instance,
    remote: Comlink.wrap<PdfRendererWorkerApi>(instance),
  };
}

async function preloadImagesV3(urls: string[], workerCount: number): Promise<Map<string, PreparedImage>> {
  const uniqueUrls = [...new Set(urls.filter(Boolean))];
  const imageMap = new Map<string, PreparedImage>();

  if (uniqueUrls.length === 0) {
    return imageMap;
  }

  const workers = Array.from({ length: Math.min(workerCount, uniqueUrls.length) }, () =>
    createImagePreloaderWorkerRef(),
  );

  const batchSize = Math.ceil(uniqueUrls.length / workers.length);
  const results = await Promise.all(
    workers.map(({ remote }, index) => {
      const batch = uniqueUrls.slice(index * batchSize, (index + 1) * batchSize);
      return batch.length > 0 ? remote.preloadImages(batch) : Promise.resolve([]);
    }),
  );

  await disposeWorkers(workers);

  for (const batch of results) {
    for (const image of batch) {
      imageMap.set(image.key, image);
    }
  }

  return imageMap;
}

function estimateTextHeight(lines: string[], fontSize: number) {
  return lines.length * fontSize * TEXT_LINE_HEIGHT_RATIO;
}

function estimateTableHeight(doc: jsPDF, instruction: TableInstructionV3, pageSize: string) {
  const probe = createPdfDoc(pageSize);
  autoTable(probe, {
    startY: instruction.startY,
    theme: "grid",
    head: instruction.head,
    body: instruction.body,
    headStyles: instruction.headStyles as Partial<Styles> | undefined,
    bodyStyles: instruction.bodyStyles as Partial<Styles> | undefined,
    columnStyles: instruction.columnStyles as
      | { [key: string]: Partial<Styles> }
      | undefined,
    margin: { left: MARGIN, right: MARGIN },
  });

  const finalY = ((probe as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ??
    instruction.startY) as number;

  doc.setPage(doc.getCurrentPageInfo().pageNumber);
  return finalY - instruction.startY;
}

function createHeaderInstruction(image: PreparedImage, pageWidth: number): { instruction: PageInstructionSetV3["items"][number]; height: number } {
  const width = pageWidth - 10;
  const ratio = image.width > 0 ? image.width / width : 1;
  const height = ratio > 0 ? image.height / ratio : 0;

  return {
    instruction: {
      type: "image",
      imageKey: image.key,
      x: 0,
      y: 10,
      width,
      height,
    },
    height,
  };
}

function createCatalogPage(
  chapters: Array<{ text: string; level: number; pageNum: number }>,
  pageWidth: number,
  measureDoc: jsPDF,
): PageInstructionSetV3 {
  const items: PageInstructionSetV3["items"] = [
    {
      type: "text",
      lines: [CATALOG_TITLE],
      x: pageWidth / 2,
      y: 80,
      fontSize: CATALOG_TITLE_SIZE,
      align: "center",
      maxWidth: pageWidth - 80,
    },
  ];

  let y = 90;
  for (const chapter of chapters) {
    const pageNumText = String(chapter.pageNum + 1);
    const indent = 40 + 12 * (chapter.level - 1);
    const rightBorder = 40;
    const textWidth = measureDoc.getTextWidth(chapter.text);
    const pageNumWidth = measureDoc.getTextWidth(pageNumText);
    const startX = indent + textWidth;
    const endX = pageWidth - rightBorder - pageNumWidth;
    const dotSpace = CATALOG_ITEM_SIZE - 3;
    const dotCount = Math.max(0, Math.floor((endX - startX) / dotSpace) - 2);

    items.push({
      type: "text",
      lines: [chapter.text],
      x: indent,
      y,
      fontSize: CATALOG_ITEM_SIZE,
      align: "left",
      maxWidth: pageWidth - 2 * indent,
    });

    items.push({
      type: "text",
      lines: [pageNumText],
      x: pageWidth - rightBorder,
      y,
      fontSize: CATALOG_ITEM_SIZE,
      align: "right",
      maxWidth: 40,
    });

    for (let index = 0; index < dotCount; index += 1) {
      items.push({
        type: "text",
        lines: ["."],
        x: endX - (index + 1) * dotSpace,
        y,
        fontSize: CATALOG_ITEM_SIZE - 3,
        align: "right",
        maxWidth: 10,
      });
    }

    y += CATALOG_ITEM_SIZE + 5;
  }

  return {
    pageIndex: 0,
    items,
  };
}

function buildInstructionPages(data: PdfExportItem[], imageMap: Map<string, PreparedImage>, options: ExportOptionsV3) {
  const pageSize = "a4";
  const doc = createPdfDoc(pageSize);
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN * 2;
  const headerImage = options.headerImg ? imageMap.get(options.headerImg) : undefined;
  const context: PlannerContext = {
    doc,
    pageWidth,
    pageHeight,
    margin: MARGIN,
    contentWidth,
    headerImage,
  };

  const pages: PageInstructionSetV3[] = [];
  const chapters: Array<{ text: string; level: number; pageNum: number }> = [];
  let current: PageInstructionSetV3 = { pageIndex: 0, items: [] };
  let y = MARGIN;
  let headingCounters: number[] = [];

  const startPage = () => {
    current = { pageIndex: pages.length, items: [] };
    y = MARGIN;

    if (context.headerImage) {
      const header = createHeaderInstruction(context.headerImage, context.pageWidth);
      current.items.push(header.instruction);
      y = header.height + 15;
    }
  };

  const finalizePage = () => {
    if (current.items.length > 0) {
      pages.push(current);
    }
  };

  const newPage = () => {
    finalizePage();
    startPage();
  };

  const ensureSpace = (height: number) => {
    if (current.items.length > 0 && y + height > context.pageHeight - context.margin) {
      newPage();
    }
  };

  startPage();

  for (const item of data) {
    if (item.type === "addPage") {
      newPage();
      continue;
    }

    if (item.type === "heading") {
      if (current.items.length > 0) {
        newPage();
      }

      headingCounters = headingCounters.slice(0, Math.max(0, item.data.level - 1));
      headingCounters[item.data.level - 1] = (headingCounters[item.data.level - 1] ?? 0) + 1;
      headingCounters = headingCounters.map((counter) => counter ?? 0).filter((counter) => counter > 0);
      const indexedTitle = `${headingCounters.join(".")} ${item.data.value}`;

      const fontSize = getHeadingSize(item.data.level);
      const lines = context.doc.splitTextToSize(indexedTitle, context.contentWidth) as string[];
      const height = estimateTextHeight(lines, fontSize);
      ensureSpace(height);

      const instruction: TextInstructionV3 = {
        type: "text",
        lines,
        x: item.data.level === 1 ? context.pageWidth / 2 : context.margin,
        y,
        fontSize,
        align: item.data.level === 1 ? "center" : "left",
        maxWidth: context.contentWidth,
      };

      current.items.push(instruction);
      chapters.push({
        text: indexedTitle,
        level: item.data.level,
        pageNum: pages.length + 1,
      });
      y += height + SECTION_GAP;
      continue;
    }

    if (item.type === "text") {
      const fontSize = 14;
      const lines = context.doc.splitTextToSize(item.data.value, context.contentWidth) as string[];
      const height = estimateTextHeight(lines, fontSize);
      ensureSpace(height);

      const instruction: TextInstructionV3 = {
        type: "text",
        lines,
        x: context.margin,
        y,
        fontSize,
        align: "left",
        maxWidth: context.contentWidth,
      };

      current.items.push(instruction);
      y += height + SECTION_GAP;
      continue;
    }

    if (item.type === "table") {
      if (item.data.title) {
        const titleLines = context.doc.splitTextToSize(item.data.title, context.contentWidth) as string[];
        const titleInstruction: TextInstructionV3 = {
          type: "text",
          lines: titleLines,
          x: context.margin,
          y,
          fontSize: 16,
          align: "left",
          maxWidth: context.contentWidth,
        };

        ensureSpace(estimateTextHeight(titleLines, 16));
        current.items.push(titleInstruction);
        y += estimateTextHeight(titleLines, 16) + 10;
      }

      const tableInstruction: TableInstructionV3 = {
        type: "table",
        startY: y,
        head: [item.data.value.head],
        body: item.data.value.body,
        headStyles: {
          fillColor: "#c00000",
          halign: "center",
          valign: "middle",
          ...(item.data.pdfOptions?.headStyles ?? {}),
        } as Partial<Styles>,
        bodyStyles: {
          halign: "center",
          valign: "middle",
          ...(item.data.pdfOptions?.bodyStyles ?? {}),
        } as Partial<Styles>,
        columnStyles: item.data.pdfOptions?.columnStyles as
          | { [key: string]: Partial<Styles> }
          | undefined,
      };

      const estimatedHeight = estimateTableHeight(context.doc, tableInstruction, pageSize);
      ensureSpace(estimatedHeight);
      tableInstruction.startY = y;
      current.items.push(tableInstruction);
      y += estimatedHeight + SECTION_GAP;
      continue;
    }

    if (item.type === "img") {
      const image = imageMap.get(item.data.value);

      if (!image) {
        continue;
      }

      const maxWidth = context.contentWidth;
      const requestedWidth = item.data.options?.width ?? maxWidth;
      const width = Math.min(requestedWidth, maxWidth);
      const ratio = image.width > 0 ? image.width / width : 1;
      const height = ratio > 0 ? image.height / ratio : image.height;
      ensureSpace(height);

      const x =
        item.data.options?.align === "center"
          ? (context.pageWidth - width) / 2
          : context.margin;

      current.items.push({
        type: "image",
        imageKey: image.key,
        x,
        y,
        width,
        height,
      });
      y += height + SECTION_GAP;
    }
  }

  finalizePage();

  if (chapters.length > 0) {
    const catalogPage = createCatalogPage(chapters, pageWidth, context.doc);
    return { pageSize, pages: [catalogPage, ...pages.map((page, index) => ({ ...page, pageIndex: index + 1 }))] };
  }

  return { pageSize, pages };
}

async function mergePdfBuffers(buffers: ArrayBuffer[]) {
  const finalDoc = await PDFDocument.create();

  for (const buffer of buffers) {
    const pdf = await PDFDocument.load(buffer);
    const pages = await finalDoc.copyPages(pdf, pdf.getPageIndices());
    for (const page of pages) {
      finalDoc.addPage(page);
    }
  }

  return finalDoc.save();
}

function downloadPdf(bytes: Uint8Array, name: string) {
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([arrayBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}

async function renderPagesWithWorkerPool(pageSize: string, pages: PageInstructionSetV3[], imageMap: Map<string, PreparedImage>, workerCount: number) {
  const workers = Array.from({ length: Math.min(workerCount, pages.length || 1) }, () =>
    createPdfRendererWorkerRef(),
  );

  const results = await Promise.all(
    pages.map((page, index) => {
      const imagesForPage = page.items.reduce<Record<string, PreparedImage>>((accumulator, instruction) => {
        if (instruction.type === "image") {
          const image = imageMap.get(instruction.imageKey);
          if (image) {
            accumulator[instruction.imageKey] = image;
          }
        }
        return accumulator;
      }, {});

      return workers[index % workers.length].remote.renderPage({
        pageSize,
        instructions: page.items,
        imageMap: imagesForPage,
      });
    }),
  );

  await disposeWorkers(workers);
  return results;
}

export async function exportPdfWithWorkerV3(
  data: (IHeading | ITable | IImg | IPage | IText)[],
  title: string,
  options: ExportOptionsV3 = {},
) {
  const imageUrls = data
    .filter((item): item is IImg => item.type === "img")
    .map((item) => item.data.value);

  if (options.headerImg) {
    imageUrls.push(options.headerImg);
  }

  console.log("\n========== [Worker V3 实验方案] 开始导出 PDF ==========");
  const imageMap = await preloadImagesV3(imageUrls, getWorkerCount(options.imageWorkerCount));
  const { pageSize, pages } = buildInstructionPages(data, imageMap, options);
  const buffers = await renderPagesWithWorkerPool(
    pageSize,
    pages,
    imageMap,
    getWorkerCount(options.workerCount),
  );
  const merged = await mergePdfBuffers(buffers);
  downloadPdf(merged, title);
  console.log("[Worker V3 实验方案] 导出完成");
}
