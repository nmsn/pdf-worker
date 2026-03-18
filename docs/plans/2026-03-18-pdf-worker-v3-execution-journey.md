# `lib/pdf-worker-v3.ts` 执行历程梳理

这份文档说明 `lib/pdf-worker-v3.ts` 的完整执行过程，重点阐述 V3 版本相较于之前版本的架构改进、模块化设计和核心实现。

## 1. 这份文件要解决什么问题

V3 版本在 V2 基础上进行了全面的模块化重构，解决以下问题：

- **Worker 代码维护困难**：V2 版本使用内联字符串创建 Worker，代码难以维护和调试。
- **类型定义分散**：指令类型、Worker API 定义散落在主文件中，缺乏统一管理。
- **职责边界模糊**：图片预处理、PDF 渲染、类型定义混在一起。
- **代码复用性差**：Worker 逻辑无法被其他模块复用。

V3 的核心改进是将架构拆分为独立模块：

```
lib/
├── pdf-worker-v3.ts          # 主入口：协调各模块
├── pdf.ts                     # 业务类型定义
└── workers/
    ├── pdf-worker-types.ts    # 统一类型定义
    ├── image-preloader.worker.ts  # 图片预加载 Worker
    └── pdf-renderer.worker.ts     # PDF 渲染 Worker
```

## 2. 整体设计思路

### 2.1 模块化架构

V3 采用了"核心协调器 + 专用 Worker"的架构：

| 模块 | 职责 | 文件位置 |
|------|------|----------|
| 协调器 | 图片预加载调度、布局计算、Worker 池管理、PDF 合并 | `pdf-worker-v3.ts` |
| 图片预加载器 | 并行 fetch 图片、解码、格式标准化 | `workers/image-preloader.worker.ts` |
| PDF 渲染器 | 单页 PDF 渲染，返回 ArrayBuffer | `workers/pdf-renderer.worker.ts` |
| 类型系统 | 统一类型定义，Worker API 契约 | `workers/pdf-worker-types.ts` |

### 2.2 数据流设计

```
业务数据 (PdfExportItem[])
       ↓
   [主线程] 布局规划
       ↓
页面指令集 (PageInstructionSetV3[])
       ↓
   [Worker 池] 并行渲染
       ↓
页面二进制 (ArrayBuffer[])
       ↓
   [主线程] 合并下载
       ↓
最终 PDF 文件
```

### 2.3 Worker 通信协议

V3 使用 [Comlink](https://github.com/GoogleChromeLabs/comlink) 库简化 Worker 通信：

```typescript
// 定义 Worker API 接口
interface ImagePreloaderWorkerApi {
  preloadImages(urls: string[]): Promise<PreparedImage[]>;
}

interface PdfRendererWorkerApi {
  renderPage(payload: PageRenderPayloadV3): Promise<ArrayBuffer>;
}

// 使用 Comlink.wrap 创建代理
const remote = Comlink.wrap<ImagePreloaderWorkerApi>(worker);

// 直接调用，无需 postMessage
const result = await remote.preloadImages(urls);
```

## 3. 入口执行链路

对外入口是 `exportPdfWithWorkerV3` 函数，执行流程如下：

```
exportPdfWithWorkerV3()                    [主入口]
       ↓
preloadImagesV3()                          [图片预加载]
       ↓
buildInstructionPages()                    [布局规划]
       ↓
renderPagesWithWorkerPool()                [并行渲染]
       ↓
mergePdfBuffers()                          [合并 PDF]
       ↓
downloadPdf()                              [下载文件]
```

## 4. 分阶段执行过程

### 4.1 阶段一：图片预加载

**入口函数**：`preloadImagesV3(urls, workerCount)`

**执行步骤**：

1. 收集所有图片 URL，去重过滤空值
2. 创建图片预加载 Worker 池
3. 按 Worker 数量分批处理 URL
4. 并行调用 `remote.preloadImages(batch)`
5. 合并结果到 `Map<string, PreparedImage>`
6. 释放 Worker 资源

**Worker 内部处理** (`image-preloader.worker.ts`)：

```
fetch(url)
    ↓
blob = response.blob()
    ↓
bitmap = createImageBitmap(blob)
    ↓
OffscreenCanvas 重绘 (解决 EXIF 旋转问题)
    ↓
canvas.convertToBlob({ type: "image/jpeg" })
    ↓
FileReader → dataUrl
    ↓
返回 { key, width, height, mimeType, dataUrl }
```

**关键设计**：

- 使用 `OffscreenCanvas` 重新栅格化图片，确保 EXIF 方向和 JPEG 特性被正确处理
- 统一转换为 JPEG 格式，减少格式兼容性问题
- 返回 `dataUrl` 而非 `ArrayBuffer`，直接可被 `jsPDF.addImage` 使用

### 4.2 阶段二：布局规划

**入口函数**：`buildInstructionPages(data, imageMap, options)`

**核心概念**：

- **PlannerContext**：布局上下文，包含页面尺寸、边距、测量用 jsPDF 实例
- **PageInstructionSetV3**：单页指令集，包含页码和绘制指令数组

**执行步骤**：

```
创建测量用 jsPDF 实例
       ↓
初始化布局状态 (y 坐标、章节计数器、当前页)
       ↓
遍历 PdfExportItem[]
  ├── heading → 计算标题高度、添加章节记录
  ├── text    → 分行计算、添加文本指令
  ├── table   → 估算表格高度、添加表格指令
  ├── img     → 计算图片尺寸、添加图片指令
  └── addPage → 结束当前页、开启新页
       ↓
生成目录页 (如有章节)
       ↓
返回 { pageSize, pages: PageInstructionSetV3[] }
```

**分页逻辑** (`ensureSpace`)：

```typescript
const ensureSpace = (height: number) => {
  // 当前页已有内容 且 剩余空间不足
  if (current.items.length > 0 && y + height > pageHeight - margin) {
    newPage();  // 结束当前页，开启新页
  }
};
```

**目录页生成** (`createCatalogPage`)：

- 标题居中显示
- 章节项按层级缩进
- 动态计算点号填充
- 页码右对齐

### 4.3 阶段三：并行渲染

**入口函数**：`renderPagesWithWorkerPool(pageSize, pages, imageMap, workerCount)`

**执行步骤**：

1. 创建 PDF 渲染 Worker 池（数量 = min(workerCount, pages.length)）
2. 为每页收集相关图片（只传递该页用到的图片）
3. 按轮询方式分配 Worker：`pages[index % workers.length]`
4. 并行调用 `remote.renderPage(payload)`
5. 收集所有 `ArrayBuffer` 结果
6. 释放 Worker 资源

**Worker 内部处理** (`pdf-renderer.worker.ts`)：

```typescript
async renderPage(payload) {
  // 1. 创建独立的 jsPDF 实例
  const doc = new jsPDF("p", "px", payload.pageSize);

  // 2. 遍历指令，逐个渲染
  for (const instruction of payload.instructions) {
    if (instruction.type === "text") {
      doc.text(lines, x, y, { align, maxWidth });
    }
    if (instruction.type === "image") {
      doc.addImage(dataUrl, format, x, y, width, height);
    }
    if (instruction.type === "table") {
      autoTable(doc, { startY, head, body, ... });
    }
  }

  // 3. 输出 ArrayBuffer
  const result = doc.output("arraybuffer");

  // 4. 使用 Transferable 传输，避免拷贝
  return Comlink.transfer(result, [result]);
}
```

**关键设计**：

- **按页并行**：每页独立渲染，天然无依赖
- **一页一实例**：每个 Worker 创建独立的 jsPDF，避免状态冲突
- **Transferable 传输**：使用 `Comlink.transfer` 零拷贝传输 ArrayBuffer
- **按需传图**：只传递该页用到的图片数据，减少传输开销

### 4.4 阶段四：合并与下载

**合并函数**：`mergePdfBuffers(buffers)`

```typescript
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
```

**下载函数**：`downloadPdf(bytes, name)`

- 创建 Blob URL
- 触发 `<a>` 下载
- 释放 Blob URL

## 5. 类型系统设计

### 5.1 指令类型

```typescript
// 文本指令
interface TextInstructionV3 {
  type: "text";
  lines: string[];    // 支持多行
  x: number;
  y: number;
  fontSize: number;
  align?: "left" | "center" | "right";
  maxWidth?: number;
}

// 图片指令
interface ImageInstructionV3 {
  type: "image";
  imageKey: string;   // 图片 URL 作为 key
  x: number;
  y: number;
  width: number;
  height: number;
}

// 表格指令
interface TableInstructionV3 {
  type: "table";
  startY: number;
  head: (string | number | boolean)[][];
  body: (string | number | boolean)[][];
  headStyles?: Record<string, unknown>;
  bodyStyles?: Record<string, unknown>;
  columnStyles?: Record<string, unknown>;
}

// 联合类型
type DrawInstructionV3 = TextInstructionV3 | ImageInstructionV3 | TableInstructionV3;
```

### 5.2 预处理图片类型

```typescript
interface PreparedImage {
  key: string;        // 原 URL
  width: number;      // 宽度
  height: number;     // 高度
  mimeType: "image/jpeg" | "image/png";
  dataUrl: string;    // Base64 Data URL
}
```

### 5.3 Worker API 契约

```typescript
interface ImagePreloaderWorkerApi {
  preloadImages(urls: string[]): Promise<PreparedImage[]>;
}

interface PdfRendererWorkerApi {
  renderPage(payload: PageRenderPayloadV3): Promise<ArrayBuffer>;
}
```

## 6. V3 相较于 V2 的改进

### 6.1 架构改进

| 方面 | V2 | V3 |
|------|----|----|
| Worker 代码 | 内联字符串 | 独立文件，支持热更新 |
| 类型定义 | 分散在主文件 | 统一 `pdf-worker-types.ts` |
| Worker 通信 | 原生 postMessage | Comlink 封装 |
| 代码复用 | 困难 | Worker 可独立导入使用 |

### 6.2 Worker 创建方式

**V2**：内联字符串

```typescript
const workerCode = `
  // 代码作为字符串...
`;
const blob = new Blob([workerCode], { type: 'application/javascript' });
const worker = new Worker(URL.createObjectURL(blob));
```

**V3**：模块化导入

```typescript
const instance = new Worker(
  new URL("./workers/image-preloader.worker.ts", import.meta.url),
  { type: "module" }
);
```

### 6.3 图片数据传递

**V2**：`Uint8Array` → base64 转换

**V3**：直接使用 `dataUrl`，减少转换开销

### 6.4 指令设计

**V2**：使用 `imageIndex` 数字索引

**V3**：使用 `imageKey` 字符串 key，更直观，避免索引管理

## 7. 关键难点与解决方案

### 7.1 难点一：Worker 状态隔离

**问题**：`jsPDF` 实例有状态，不能跨线程共享

**解决**：采用"一页一实例"设计，Worker 内创建独立 jsPDF

### 7.2 难点二：图片数据传输

**问题**：大图片传输开销高

**解决**：
- 图片预处理阶段统一压缩为 JPEG
- 只传递每页用到的图片
- 使用 Transferable 传输 ArrayBuffer

### 7.3 难点三：表格高度估算

**问题**：表格需要渲染才能知道高度

**解决**：创建临时 jsPDF 实例进行预渲染，获取 `lastAutoTable.finalY`

```typescript
function estimateTableHeight(doc, instruction, pageSize) {
  const probe = createPdfDoc(pageSize);
  autoTable(probe, { ... });
  const finalY = probe.lastAutoTable?.finalY ?? instruction.startY;
  return finalY - instruction.startY;
}
```

### 7.4 难点四：目录页码一致性

**问题**：目录页插入后，后续页码需要调整

**解决**：在布局完成后生成目录，统一处理页码偏移

```typescript
if (chapters.length > 0) {
  const catalogPage = createCatalogPage(chapters, pageWidth, doc);
  return {
    pageSize,
    pages: [catalogPage, ...pages.map((p, i) => ({ ...p, pageIndex: i + 1 }))]
  };
}
```

## 8. 设计亮点

### 8.1 亮点一：模块化设计清晰

职责分离明确：
- 类型定义独立文件
- Worker 逻辑独立文件
- 主文件只做协调

### 8.2 亮点二：Comlink 简化通信

无需手动处理 `postMessage` / `onmessage`，代码更简洁：

```typescript
// V2 方式
worker.postMessage({ type: 'render', data });
worker.onmessage = (e) => { ... };

// V3 方式
const result = await remote.renderPage(payload);
```

### 8.3 亮点三：Transferable 优化

渲染结果使用 Transferable 传输，零拷贝：

```typescript
return Comlink.transfer(result, [result]);
```

### 8.4 亮点四：按需传图

每页只传递用到的图片，减少 Worker 通信开销：

```typescript
const imagesForPage = page.items.reduce((acc, inst) => {
  if (inst.type === "image") {
    const img = imageMap.get(inst.imageKey);
    if (img) acc[inst.imageKey] = img;
  }
  return acc;
}, {});
```

### 8.5 亮点五：支持热更新

Worker 使用模块导入，开发时支持热模块替换：

```typescript
new Worker(
  new URL("./workers/pdf-renderer.worker.ts", import.meta.url),
  { type: "module" }
);
```

## 9. 执行逻辑图

```
exportPdfWithWorkerV3()
       │
       ├─── 收集图片 URL
       │
       ▼
preloadImagesV3()
       │
       ├─── 创建 Worker 池
       ├─── 分批调用 remote.preloadImages()
       ├─── 合并结果 → Map<url, PreparedImage>
       └─── 释放 Worker
       │
       ▼
buildInstructionPages()
       │
       ├─── 遍历 data[]
       │    ├── heading → ensureSpace() → addTextInstruction
       │    ├── text    → ensureSpace() → addTextInstruction
       │    ├── table   → estimateTableHeight() → addTableInstruction
       │    ├── img     → ensureSpace() → addImageInstruction
       │    └── addPage → finalizePage() → startPage()
       │
       ├─── 生成目录页 (如有章节)
       └─── 返回 { pageSize, pages }
       │
       ▼
renderPagesWithWorkerPool()
       │
       ├─── 创建 Worker 池
       ├─── 为每页收集图片
       ├─── 轮询分配 Worker
       ├─── 并行调用 remote.renderPage()
       ├─── 收集 ArrayBuffer[]
       └─── 释放 Worker
       │
       ▼
mergePdfBuffers()
       │
       ├─── PDFDocument.create()
       ├─── 逐个 copyPages()
       └─── finalDoc.save()
       │
       ▼
downloadPdf()
       │
       ├─── 创建 Blob URL
       ├─── 触发下载
       └─── 释放 URL
```

## 10. 文件依赖关系

```
pdf-worker-v3.ts
    ├── imports
    │     ├── comlink
    │     ├── pdf-lib
    │     ├── jspdf
    │     ├── jspdf-autotable
    │     ├── ./pdf (业务类型)
    │     └── ./workers/pdf-worker-types
    │
    └── creates workers via
          ├── ./workers/image-preloader.worker.ts
          └── ./workers/pdf-renderer.worker.ts

workers/pdf-worker-types.ts
    └── imports
          └── ../pdf (业务类型)

workers/image-preloader.worker.ts
    └── imports
          ├── comlink
          └── ./pdf-worker-types

workers/pdf-renderer.worker.ts
    └── imports
          ├── comlink
          ├── jspdf
          ├── jspdf-autotable
          └── ./pdf-worker-types
```

## 11. 一句话总结

`lib/pdf-worker-v3.ts` 是 V2 版本的模块化重构，核心改进是将 Worker 代码从内联字符串拆分为独立模块，使用 Comlink 简化通信协议，统一类型定义，实现了更清晰的职责分离和更好的开发体验。

真正的亮点在于：
- **模块化**：Worker 独立文件，支持热更新
- **类型安全**：统一类型定义，Worker API 契约化
- **通信简化**：Comlink 封装，无需手动 postMessage
- **按需传图**：减少 Worker 通信开销
- **Transferable**：渲染结果零拷贝传输
