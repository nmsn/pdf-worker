# `lib/pdf-worker.ts` 执行历程梳理（Worker 方案 V2）

这份文档说明 `lib/pdf-worker.ts` 的完整执行过程，这是 PDF 导出的 **Worker 并行方案 V2**，采用内联字符串创建 Worker。

## 1. 方案概述

### 1.1 核心特点

Worker V2 方案是**多线程并行执行**的 PDF 导出实现：

- 主线程负责布局计算和指令收集
- Worker 负责单页 PDF 渲染
- 使用内联字符串创建 Worker
- 支持 `OffscreenCanvas` 优化路径和降级路径

### 1.2 解决的问题

传统方案的主要问题：

- 主线程长时间阻塞
- 图片处理耗时最长
- 多页 PDF 无法并行渲染
- 功能完整性不能牺牲

### 1.3 核心思想

**先布局，后渲染**：

1. 主线程收集所有页面绘制指令
2. Worker 并行渲染每页 PDF
3. 主线程合并所有页面

## 2. 整体架构

### 2.1 模块结构

```
lib/pdf-worker.ts
├── 浏览器能力检测
├── 时间记录工具
├── 指令类型定义
├── 图片预加载器 (ImagePreloader)
├── 图片 Worker Pool (ImageWorkerPool)
├── 序号管理器
├── 指令收集函数
└── PDFWorkerV2 类
```

### 2.2 类结构设计

```typescript
class PDFWorkerV2 {
  // 页面配置
  border: number;
  padding: number;
  pageSize: string;
  headerImg: string;

  // 状态追踪
  x: number;
  y: number;
  chapter: Chapter[];
  serialStack: SerialStack;

  // 指令收集
  allInstructions: DrawInstructionV2[][];
  currentPageInstructions: DrawInstructionV2[];

  // 图片管理
  imageInfos: PreloadImageInfo[];
  nextImageIndex: number;

  // Worker Pool
  imageWorkerPool: ImageWorkerPool | null;
  imagePreloader: ImagePreloader | null;
}
```

## 3. 执行流程

### 3.1 入口函数

```typescript
exportPdfWithWorker(data, title, options)
```

**执行顺序**：

```
exportPdfWithWorker()
       ↓
检测浏览器能力
       ↓
初始化 PDFWorkerV2 实例
       ↓
遍历数据，收集指令
  ├── addChapter()
  ├── addText()
  ├── addImage() → registerImage()
  ├── addTable()
  └── addPage()
       ↓
预加载图片 (preloadImages)
       ↓
调用 save()
       ↓
renderWithWorkers() 并行渲染
       ↓
mergePDFs() 合并页面
       ↓
下载 PDF
```

### 3.2 浏览器能力检测

```typescript
const SUPPORTS_OFFSCREEN_CANVAS = typeof OffscreenCanvas !== 'undefined';
const SUPPORTS_IMAGE_BITMAP = typeof createImageBitmap !== 'undefined';
const SUPPORTS_WORKER_OPTIMIZATION = SUPPORTS_OFFSCREEN_CANVAS && SUPPORTS_IMAGE_BITMAP;
```

根据检测结果选择执行路径：

- **优化路径**：使用 `OffscreenCanvas` 和 `ImageBitmap`
- **降级路径**：主线程加载图片，转 base64

## 4. 核心组件详解

### 4.1 指令类型定义

```typescript
// 文本指令
interface TextInstruction {
  type: 'text';
  content: string;
  x: number;
  y: number;
  fontSize: number;
  align?: 'left' | 'center' | 'right';
  maxWidth?: number;
}

// 图片指令（使用索引引用预加载图片）
interface ImageInstructionV2 {
  type: 'image';
  imageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

// 表格指令
interface TableInstruction {
  type: 'table';
  head: (string | number | boolean)[][];
  body: (string | number | boolean)[][];
  startY: number;
  headStyles?: Record<string, unknown>;
  bodyStyles?: Record<string, unknown>;
  columnStyles?: Record<string, unknown>;
}

// 页面指令集
interface PageInstructionsV2 {
  pageIndex: number;
  items: DrawInstructionV2[];
}
```

### 4.2 图片预加载器 `ImagePreloader`

使用内联字符串创建 Worker，并行处理图片：

```typescript
class ImagePreloader {
  private cache: Map<string, Uint8Array> = new Map();
  private workers: Comlink.Remote<ImageProcessor>[];

  constructor(workerCount: number) {
    // 内联 Worker 代码
    const workerCode = `
      importScripts('https://cdn.jsdelivr.net/npm/comlink/dist/umd/comlink.min.js');

      const imageProcessor = {
        async processImage(url) {
          const response = await fetch(url);
          const blob = await response.blob();
          const bitmap = await createImageBitmap(blob);

          // 转换为 JPEG Uint8Array
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(bitmap, 0, 0);

          const jpegBlob = await canvas.convertToBlob({
            type: 'image/jpeg',
            quality: 0.85
          });

          return new Uint8Array(await jpegBlob.arrayBuffer());
        },
        // ...
      };

      Comlink.expose(imageProcessor);
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));
    // ...
  }

  async preload(urls: string[]): Promise<void>;
  get(url: string): Uint8Array | null;
}
```

**Worker 内处理流程**：

```
fetch(url)
    ↓
response.blob()
    ↓
createImageBitmap(blob)
    ↓
OffscreenCanvas 重绘
    ↓
canvas.convertToBlob({ type: 'image/jpeg' })
    ↓
返回 Uint8Array
```

### 4.3 图片 Worker Pool `ImageWorkerPool`

备用的图片处理 Worker 池，用于兼容性场景：

```typescript
class ImageWorkerPool {
  private workers: Worker[];
  private availableWorkers: Worker[];
  private taskQueue: Array<(worker: Worker) => void>;

  async preloadImages(images: Array<{ url: string; index: number }>): Promise<{
    bitmaps: (ImageBitmap | null)[];
    infos: PreloadImageInfo[];
  }>;
}
```

### 4.4 PDFWorkerV2 类

核心渲染协调器：

```typescript
class PDFWorkerV2 {
  // 注册图片 URL，返回索引
  registerImage(url: string): number;

  // 预加载所有图片
  async preloadImages(): Promise<void>;

  // 添加各种内容
  async addChapter(title: string, level: number): Promise<void>;
  addText(text: string, config?: TextConfig): void;
  async addImage(img: string, config?: ImgConfig): Promise<void>;
  addTable(tableMessage: TableConfig, title: string): void;
  async addPage(): Promise<{ y: number }>;

  // 生成目录
  addCatalog(pageNum?: number): void;

  // 保存并导出
  async save(name: string): Promise<void>;
}
```

## 5. 并行渲染机制

### 5.1 `renderWithWorkers`

```typescript
async function renderWithWorkers(
  allInstructions: DrawInstructionV2[][],
  pageSize: string
): Promise<ArrayBuffer[]>
```

**执行步骤**：

```
创建 PDF 渲染 Worker 池
       ↓
为每页收集使用的图片索引
       ↓
从 imagePreloader 获取图片数据
       ↓
并行调用 Worker.renderPage()
       ↓
收集 ArrayBuffer 结果
       ↓
释放 Worker 资源
```

### 5.2 Worker 内渲染

Worker 内创建独立的 jsPDF 实例：

```typescript
// Worker 内代码
async function renderPage(instructions, pageSize, imageDataMap) {
  const doc = new jsPDF('p', 'px', pageSize);

  for (const instruction of instructions) {
    if (instruction.type === 'text') {
      doc.text(instruction.content, instruction.x, instruction.y);
    }
    if (instruction.type === 'image') {
      const imageData = imageDataMap[instruction.imageIndex];
      doc.addImage(imageData, 'JPEG', instruction.x, instruction.y, ...);
    }
    if (instruction.type === 'table') {
      autoTable(doc, { ... });
    }
  }

  return doc.output('arraybuffer');
}
```

**关键设计**：

- **一页一实例**：每页独立 jsPDF，避免状态冲突
- **按页并行**：天然无依赖，并行度高
- **数据隔离**：Worker 间无共享状态

## 6. PDF 合并

使用 `pdf-lib` 合并所有页面：

```typescript
async function mergePDFs(pdfBuffers: ArrayBuffer[]): Promise<Uint8Array> {
  const finalDoc = await PDFDocument.create();

  for (const buffer of pdfBuffers) {
    const pdf = await PDFDocument.load(buffer);
    const pages = await finalDoc.copyPages(pdf, pdf.getPageIndices());
    for (const page of pages) {
      finalDoc.addPage(page);
    }
  }

  return finalDoc.save();
}
```

## 7. 降级路径

当浏览器不支持 `OffscreenCanvas` 或 `createImageBitmap` 时：

```typescript
async preloadImages(): Promise<void> {
  if (!SUPPORTS_WORKER_OPTIMIZATION) {
    // 降级方案：主线程加载图片
    for (const info of this.imageInfos) {
      const img = await loadImage(info.url);
      info.width = img.width;
      info.height = img.height;
    }
  }
}
```

渲染时：

```typescript
// 主线程转 base64
const base64Images = await Promise.all(
  urls.map(url => urlToBase64Async(url))
);

// Worker 使用 base64 渲染
```

## 8. 性能对比

### 8.1 时间分布

| 阶段 | 传统方案 | Worker V2 方案 |
|------|----------|----------------|
| 图片加载 | 主线程阻塞 | Worker 并行 |
| 布局计算 | 即时 | 即时 |
| PDF 渲染 | 顺序 | Worker 并行 |
| 主线程阻塞 | 100% | 约 20% |

### 8.2 性能收益

- **图片预处理**：移到 Worker，主线程不阻塞
- **并行渲染**：多核 CPU 并行处理
- **用户体验**：导出期间页面可交互

## 9. 与其他方案对比

| 特性 | 传统方案 | Worker V2 | Worker V3 |
|------|----------|-----------|-----------|
| 执行方式 | 主线程同步 | Worker 并行 | Worker 并行 |
| Worker 创建 | - | 内联字符串 | 独立文件 |
| 依赖管理 | npm | CDN importScripts | npm |
| 类型安全 | 内部 | 分散 | 统一定义 |
| 调试体验 | 好 | 差 | 好 |
| HMR 支持 | - | 否 | 是 |
| 代码维护 | 容易 | 困难 | 容易 |

## 10. 存在的问题

### 10.1 Worker 代码维护困难

```typescript
// 内联字符串，无语法高亮、无类型检查
const workerCode = `
  importScripts('https://cdn.jsdelivr.net/npm/comlink/...');
  // 大量代码...
`;
```

问题：

- 无 IDE 支持（语法高亮、自动补全）
- 无 TypeScript 类型检查
- 修改容易出错

### 10.2 CDN 依赖风险

```typescript
importScripts('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
importScripts('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/...');
importScripts('https://cdn.jsdelivr.net/npm/comlink/...');
```

问题：

- 依赖外网，离线不可用
- 版本可能漂移
- 主线程和 Worker 版本可能不一致

### 10.3 类型定义分散

指令类型、Worker API 定义散落在主文件中，难以复用。

## 11. 执行逻辑图

```
exportPdfWithWorker()
       │
       ├─── 浏览器能力检测
       │
       ▼
new PDFWorkerV2()
       │
       ├─── 初始化 jsPDF 实例（测量用）
       ├─── 初始化状态（坐标、章节、指令数组）
       └─── 创建 ImageWorkerPool（如果支持）
       │
       ▼
遍历 data[]，收集指令
       │
       ├── heading → registerImage() + collectTextInstructions()
       ├── text    → collectTextInstructions()
       ├── img     → registerImage() + collectImageInstructionsV2()
       ├── table   → collectTableInstructions()
       └── addPage → finalizePage() + startPage()
       │
       ▼
preloadImages()
       │
       ├── [优化路径]
       │     └── ImagePreloader.preload()
       │           └── Worker: fetch → createImageBitmap → OffscreenCanvas
       │
       └── [降级路径]
             └── 主线程: loadImage()
       │
       ▼
save()
       │
       ▼
renderWithWorkers()
       │
       ├─── 创建 Worker 池
       ├─── 为每页收集图片数据
       ├─── 并行调用 renderPage()
       │     └── Worker: new jsPDF → 渲染指令 → output('arraybuffer')
       ├─── 收集 ArrayBuffer[]
       └─── 释放 Worker
       │
       ▼
mergePDFs()
       │
       └── pdf-lib: PDFDocument.create → copyPages → save
       │
       ▼
download()
       │
       └── Blob URL → <a> 下载
```

## 12. 一句话总结

`lib/pdf-worker.ts` 是 PDF 导出的 **Worker 并行方案 V2**，核心改进是将 PDF 渲染移到 Worker 并行执行，但使用内联字符串创建 Worker 导致维护困难，为 V3 的模块化重构提供了基础。

核心特点：
- **先布局后渲染**：主线程收集指令，Worker 渲染
- **按页并行**：每页独立渲染，天然并行
- **内联 Worker**：代码作为字符串，维护困难
- **CDN 依赖**：运行时加载，存在版本漂移风险
- **降级兼容**：不支持现代 API 时回退到主线程处理