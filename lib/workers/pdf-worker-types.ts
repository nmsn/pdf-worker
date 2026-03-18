import type { IHeading, IImg, IPage, ITable, IText } from "../pdf";

export type PdfExportItem = IHeading | ITable | IImg | IPage | IText;

export interface PreparedImage {
  key: string;
  width: number;
  height: number;
  mimeType: "image/jpeg" | "image/png";
  dataUrl: string;
}

export interface TextInstructionV3 {
  type: "text";
  lines: string[];
  x: number;
  y: number;
  fontSize: number;
  align?: "left" | "center" | "right";
  maxWidth?: number;
}

export interface ImageInstructionV3 {
  type: "image";
  imageKey: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TableInstructionV3 {
  type: "table";
  startY: number;
  head: (string | number | boolean)[][];
  body: (string | number | boolean)[][];
  headStyles?: Record<string, unknown>;
  bodyStyles?: Record<string, unknown>;
  columnStyles?: Record<string, unknown>;
}

export type DrawInstructionV3 =
  | TextInstructionV3
  | ImageInstructionV3
  | TableInstructionV3;

export interface PageInstructionSetV3 {
  pageIndex: number;
  items: DrawInstructionV3[];
}

export interface PageRenderPayloadV3 {
  pageSize: string;
  instructions: DrawInstructionV3[];
  imageMap: Record<string, PreparedImage>;
}

export interface ImagePreloaderWorkerApi {
  preloadImages(urls: string[]): Promise<PreparedImage[]>;
}

export interface PdfRendererWorkerApi {
  renderPage(payload: PageRenderPayloadV3): Promise<ArrayBuffer>;
}
