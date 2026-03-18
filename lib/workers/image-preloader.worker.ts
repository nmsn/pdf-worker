import * as Comlink from "comlink";

import type { ImagePreloaderWorkerApi, PreparedImage } from "./pdf-worker-types";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to convert blob to data URL"));
    reader.readAsDataURL(blob);
  });
}

async function normalizeImageBlob(blob: Blob): Promise<{
  blob: Blob;
  width: number;
  height: number;
}> {
  if (
    typeof createImageBitmap !== "function" ||
    typeof OffscreenCanvas === "undefined"
  ) {
    return {
      blob,
      width: 0,
      height: 0,
    };
  }

  const bitmap = await createImageBitmap(blob);

  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Failed to get 2d context from OffscreenCanvas");
    }

    // Re-rasterize the decoded bitmap so EXIF orientation and source-specific
    // JPEG quirks are baked into stable pixel data before passing to jsPDF.
    context.drawImage(bitmap, 0, 0);

    const normalizedBlob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: 0.85,
    });

    return {
      blob: normalizedBlob,
      width: bitmap.width,
      height: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
}

async function loadImageBytes(url: string): Promise<PreparedImage> {
  const absoluteUrl = new URL(url, self.location.origin).toString();
  const response = await fetch(absoluteUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${url}`);
  }

  const sourceBlob = await response.blob();
  const normalized = await normalizeImageBlob(sourceBlob);
  const dataUrl = await blobToDataUrl(normalized.blob);

  return {
    key: url,
    width: normalized.width,
    height: normalized.height,
    mimeType: "image/jpeg",
    dataUrl,
  };
}

const api: ImagePreloaderWorkerApi = {
  async preloadImages(urls) {
    return Promise.all(urls.map((url) => loadImageBytes(url)));
  },
};

Comlink.expose(api);
