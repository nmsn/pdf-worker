# Worker V3 导出模块架构文档

> **文档摘要**：本文档描述 `lib/pdf-worker-v3.ts` 的设计思路、核心组件与优势。该模块是 PDF 导出体系的**实验性方案**，通过预计算分页指令 + Worker 池并行渲染 + PDF 合并的三阶段架构，实现真正将 PDF 渲染工作卸载到多核 Worker。

---

## 一、模块定位与作用

`pdf-worker-v3.ts` 是整个 PDF 导出体系中的**实验方案**，核心目标是**彻底将 PDF 渲染工作从主线程剥离**，由 Worker 池并行完成。

**核心职责**：
- 图片并行预加载（Worker Pool）
- 预计算分页指令（主线程）
- Worker 池并行渲染各自页面
- PDF 合并与下载

**设计关键词**：`预计算指令` → `Worker池并行` → `pdf-lib合并`

---

## 二、设计思路

### 2.1 核心架构：三阶段流水线

```
阶段1: 预计算（主线程）     阶段2: 并行渲染（Worker池）     阶段3: 合并（主线程）
┌──────────────────────┐   ┌────────────────────────────┐   ┌─────────────────┐
│ buildInstructionPages│   │ PdfRenderer[0] ──► PDF Buf │   │ PDFDocument     │
│  ├─ 分析数据         │──►│ PdfRenderer[1] ──► PDF Buf │──►│ .merge()        │
│  ├─ 计算分页         │   │ PdfRenderer[2] ──► PDF Buf │   │  (pdf-lib)      │
│  ├─ 确定坐标/尺寸     │   │ ...                       │   └─────────────────┘
│  └─ 生成指令集       │   │ PdfRenderer[N] ──► PDF Buf │
│                      │   └────────────────────────────┘
│  imageMap (预加载)    │              │
└──────────────────────┘              │ 并行，各自渲染分配的页面
         │                            │ → ImageBitmap Transferable 零拷贝
         ▼                            ▼
  PageInstructionSetV3[]        Uint8Array[] (各页PDF)
```

**关键洞察**：传统方案和 Worker 方案的渲染仍是主线程执行。V3 将渲染粒度细化到**每页**，由不同 Worker 并行处理。

### 2.2 指令预计算（主线程）

`buildInstructionPages()` 在主线程完成所有布局计算：

```typescript
const { pageSize, pages } = buildInstructionPages(data, imageMap, options);
// pages: PageInstructionSetV3[]
// 每页包含 DrawInstructionV3[]（text | image | table 指令）
```

这个阶段将**数据**转换为**渲染指令**，包括：
- 每页包含哪些元素
- 每个元素的 x, y, width, height
- 文本的行分割（`splitTextToSize`）
- 表格高度估算（`estimateTableHeight`）
- 页面分页点（`ensureSpace`）

### 2.3 Worker 池并行渲染

```typescript
// 每个 Worker 独立执行
const buffers = await Promise.all(
  pages.map((page, index) =>
    workers[index % workers.length].remote.renderPage({
      pageSize,
      instructions: page.items,
      imageMap: imagesForPage,  // Transferable 零拷贝
    })
  )
);
```

- Worker 数量：`hardwareConcurrency - 1`（默认，保留一个核心给主线程）
- 负载均衡：Round-robin 分配页面
- 图片传输：`PreparedImage` 通过 `dataUrl` 传递（已预转换为 JPEG base64）

### 2.4 PDF 合并

```typescript
async function mergePdfBuffers(buffers: ArrayBuffer[]) {
  const finalDoc = await PDFDocument.create();
  for (const buffer of buffers) {
    const pdf = await PDFDocument.load(buffer);
    finalDoc.addPage(...pdf.getPageIndices());
  }
  return finalDoc.save();
}
```

使用 `pdf-lib` 而非 jsPDF 完成合并——jsPDF 无法将多个 PDF buffer 合并，pdf-lib 专为此而生。

---

## 三、核心组件

### 3.1 类型系统

V3 引入了一套独立的指令类型系统（与 jsPDF 解耦）：

```typescript
// 绘制指令
TextInstructionV3   { type:"text",   lines, x, y, fontSize, align, maxWidth }
ImageInstructionV3  { type:"image",  imageKey, x, y, width, height }
TableInstructionV3  { type:"table",  startY, head, body, styles }

// 页面指令集
PageInstructionSetV3 { pageIndex, items: DrawInstructionV3[] }

// 图片预加载结果
PreparedImage { key, width, height, mimeType, dataUrl }
```

**设计意图**：Worker 只需要指令和图片数据，不需要理解业务语义，实现了**渲染逻辑与 Worker 的彻底解耦**。

### 3.2 Worker 类型

| Worker | 职责 | 接口 |
|---|---|---|
| `ImagePreloaderWorker` | 并行加载图片，转 JPEG base64 | `preloadImages(urls[])` → `PreparedImage[]` |
| `PdfRendererWorker` | 执行页面渲染 | `renderPage(payload)` → `ArrayBuffer` |

### 3.3 核心函数

| 函数 | 职责 |
|---|---|
| `preloadImagesV3()` | 创建 ImagePreloader Worker 池，并行加载所有图片 |
| `buildInstructionPages()` | 预计算分页指令，确定每页内容与坐标 |
| `renderPagesWithWorkerPool()` | 分配页面到 Worker 池，并行渲染 |
| `mergePdfBuffers()` | 合并各 Worker 输出的 PDF buffer |

### 3.4 `TimingLoggerV3`

与 `pdf.ts` 的 `TimingLogger` 接口一致，但**已修复两个 bug**：

```typescript
// ✅ 已修复：start() 会 push 到 records
start(name: string): void {
  this.currentRecord = { name, startTime };
  this.records.push(this.currentRecord);  // ← 新增
}

// ✅ 已修复：新增 reset()，防止多次导出计时累积
reset(): void {
  this.records = [];
  this.currentRecord = null;
  this.counters.clear();
}
```

---

## 四、关键设计亮点

### 4.1 真正的主线程卸载

| 方案 | 主线程工作 |
|---|---|
| 传统方案 | 100%（渲染 + 图片加载 + 布局） |
| Worker 方案 | 图片加载并行，但渲染仍在主线程 |
| **V3 方案** | 仅预计算 + 合并，其他全部 Worker 并行 |

### 4.2 指令驱动的 Worker 渲染

Worker 不需要知道"这是什么内容"，只执行指令：

```typescript
// PdfRendererWorker 内部
async renderPage({ pageSize, instructions, imageMap }) {
  const doc = new jsPDF("p", "px", pageSize);
  for (const inst of instructions) {
    if (inst.type === "text") {
      doc.setFontSize(inst.fontSize);
      doc.text(inst.lines, inst.x, inst.y);
    }
    if (inst.type === "image") {
      const img = imageMap[inst.imageKey];
      doc.addImage(img.dataUrl, "JPEG", inst.x, inst.y, inst.width, inst.height);
    }
    // ...
  }
  return doc.output("arraybuffer");
}
```

### 4.3 表格高度预估算

表格高度在预计算阶段通过"探测文档"估算：

```typescript
function estimateTableHeight(doc: jsPDF, instruction: TableInstructionV3, pageSize: string) {
  const probe = createPdfDoc(pageSize);
  autoTable(probe, { ...instruction, startY: instruction.startY });
  const finalY = probe.lastAutoTable.finalY;
  return finalY - instruction.startY;  // 估算高度用于分页判断
}
```

### 4.4 动态 Worker 池大小

```typescript
function getWorkerCount(input?: number): number {
  if (input !== undefined) return Math.max(1, input);
  const cores = navigator.hardwareConcurrency || 4;
  return Math.max(1, cores - 1);  // 保留一个核心给主线程
}
```

---

## 五、与 Worker 方案、传统方案的对比

| 维度 | 传统方案 (pdf.ts) | Worker 方案 (pdf-worker.ts) | V3 Worker 方案 |
|---|---|---|---|
| 渲染线程 | 主线程 | 主线程 | **Worker 池并行** |
| 图片处理 | 主线程串行 | Worker 并行 | Worker 池并行 |
| 指令预计算 | 无 | 无 | **主线程预计算** |
| 分页策略 | jsPDF 自动 | jsPDF 自动 | 预计算后手动分页 |
| PDF 生成 | 单一 jsPDF 实例 | 单一 jsPDF 实例 | **多 Worker 各出一页 + pdf-lib 合并** |
| 适用场景 | 小文档 | 中等复杂度 | **大文档、高并发需求** |
| 兼容性 | 所有浏览器 | 现代浏览器 | 现代浏览器（需 ES Module Worker） |

---

## 六、待优化项

1. **表格高度估算误差**：探测文档生成的 autoTable 结果与正式渲染可能存在细微差异
2. **Worker 实例创建开销**：每次导出会创建/销毁 Worker 池，大文档频繁导出时可能有冷启动延迟
3. **dataUrl vs Transferable**：图片目前以 base64 dataUrl 传递（主线程→Worker 复制开销），可考虑改用 `ImageBitmap` + `Transferable` 零拷贝
4. **Worker 内存隔离**：各 Worker 独立加载字体，目前无字体复用机制
5. **目录页码精度**：目录生成时使用 `pages.length + 1` 估算，实际页码以最终合并结果为准

---

*文档生成时间：2026-04-16*
