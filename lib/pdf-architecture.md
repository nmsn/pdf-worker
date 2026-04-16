# PDF 导出模块架构文档

> **文档摘要**：本文档描述 `lib/pdf.ts` 的设计思路、核心组件与优势。该模块通过 `PDF` 类封装 jsPDF，提供声明式数据模型、统一类型接口、自动分页、目录生成、计时埋点等能力，实现业务数据到 PDF 文件的高效转换。

---

## 一、模块定位与作用

`pdf.ts` 是整个 PDF 导出体系中的**基础方案**（又称"传统方案"），不依赖 Web Worker，在主线程完成所有渲染工作。

**核心职责**：
- 将业务数据（标题、文本、图片、表格、换页）渲染为 PDF 文件
- 维护 PDF 文档状态（坐标、页码、章节序号）
- 自动处理内容分页、图片缩放、目录生成
- 提供完整的耗时追踪，供性能对比分析

---

## 二、设计思路

### 2.1 分层架构

模块分为三层，从底向上依赖：

```
┌─────────────────────────────────────────┐
│  exportPdf()  · 顶层导出函数            │  ← 编排层：接收数据数组，驱动渲染流程
├─────────────────────────────────────────┤
│  PDF 类  · 文档状态封装                 │  ← 抽象层：封装 jsPDF 实例，管理坐标/章节/样式
│  ├─ addChapter()  addText()             │
│  ├─ addImage()   addTable()             │
│  └─ addCatalog()  save()                │
├─────────────────────────────────────────┤
│  drawText()  drawImg()  drawTable()     │  ← 原子层：直接操作 jsPDF API，完成具体绘制
│  urlToBase64Async()  transformImage...  │  ← 工具层：图片格式转换、序号计算
│  TimingLogger                            │  ← 基础设施：耗时追踪
└─────────────────────────────────────────┘
```

**分层原则**：
- **原子层**：纯函数，无状态，只做一件事（绘制文本/图片/表格）
- **抽象层**：`PDF` 类持有状态，将原子层函数组合为业务语义（添加章节/添加图片）
- **编排层**：`exportPdf()` 统一调度，按数据顺序驱动整个渲染流水线

### 2.2 声明式数据模型

调用方不需要感知 PDF 的内部坐标，只需传递声明式数据：

```typescript
const data: (IHeading | ITable | IImg | IPage | IText)[] = [
  { type: 'heading', data: { value: '第一章', level: 1 } },
  { type: 'text',    data: { value: '正文内容...' } },
  { type: 'img',     data: { value: '/img/demo.png', options: { width: 300 } } },
  { type: 'table',   data: { title: '数据表', value: { head: [...], body: [...] } } },
  { type: 'addPage' },
];
exportPdf(data, '导出文档');
```

每种数据类型对应一种渲染动作，扩展类型只需添加新的 `type` 分支。

### 2.3 自动分页与坐标管理

`PDF` 类实例持有当前光标位置 `this.y`，每个绘制函数返回 `endY`，下一个元素从 `endY + padding` 继续绘制。当剩余空间不足以容纳内容时：

- **图片**：`drawImg` 内部判断是否需要新建页面或缩放图片（三种分支：超出整页/超出当前页/正常）
- **页面**：通过 `await pdf.addPage()` 主动换页
- **表格**：`jspdf-autotable` 自行处理跨页

### 2.4 序号栈（SerialStack）

章节、图片、表格的编号依赖于嵌套层级关系。例如：

```
第 1 章（level=1）
  1.1 节（level=2）
    图片 1.1.1
    图片 1.1.2
  1.2 节（level=2）
    图片 1.2.1
```

`SerialStack` 以**栈**的数据结构维护当前嵌套路径：
- `setSerial(level)` 根据标题级别 push/pop 更新路径
- `getSerial()` 返回形如 `1.1.2` 的章节编号
- `getImgSerial()` / `getTableSerial()` 返回图片/表格在当前章节下的编号

---

## 三、核心组件

### 3.1 `PDF` 类

| 属性/方法 | 说明 |
|---|---|
| `this.pdf` | jsPDF 实例 |
| `this.y` / `this.x` | 当前光标坐标 |
| `this.headerHeight` | 页眉图片高度 |
| `this.chapter[]` | 收集的章节数据（用于生成目录） |
| `this.serialStack` | 序号栈实例 |
| `addChapter()` | 添加带编号的章节标题 |
| `addText()` | 添加文本段落 |
| `addImage()` | 添加图片（自动缩放/分页） |
| `addTable()` | 添加表格 |
| `addCatalog()` | 在首页插入目录页 |
| `save()` | 触发文件下载 |

### 3.2 类型定义

```typescript
IHeading  { type:'heading',  data:{ value, level } }    // 1-6 级标题
ITable    { type:'table',   data:{ value:{ head, body }, title, pdfOptions } }
IImg      { type:'img',     data:{ value, options } }
IPage     { type:'addPage' }
IText     { type:'text',    data:{ value, options } }
```

### 3.3 `TimingLogger`

每次操作记录起止时间与调用次数，导出完成后 `summary()` 汇总输出：

```
========== [传统方案] 执行时间汇总 ==========
  初始化 PDF:    12.34ms
  渲染内容:     234.56ms
  添加目录:      45.67ms
  保存文件:      89.01ms
  总计:         381.58ms
各操作调用次数:
  transformImage: 3 次
  drawText:        7 次
  drawImg:         2 次
  drawTable:       1 次
```

---

## 四、关键设计亮点

### 4.1 状态与渲染分离

`PDF` 类只负责**状态管理**（当前坐标、章节列表），具体的绘制逻辑委托给底层的 `drawText`/`drawImg`/`drawTable`。这样做的好处：
- 原子函数可独立测试
- 同一绘制逻辑可在类内外复用
- 状态管理逻辑清晰，不混入绘图代码

### 4.2 多格式图片兼容

`transformImageToBase64AndImg` 统一处理四种图片来源：

| 输入类型 | 处理方式 |
|---|---|
| `string` (URL) | `loadImage` → `imageToBase64` |
| `string` (base64) | 直接使用，不重复转换 |
| `HTMLImageElement` | `imageToBase64` |
| `Blob` | `blobToBase64Async` |
| `Promise<string>` | 递归 await 后再处理 |

### 4.3 灵活的图片排版

`drawImg` 根据配置和可用空间自动选择三种渲染策略：

1. **超出整页**：缩放图片至页面宽度，新建页面放置
2. **超出当前页**：缩放图片填满当前页剩余空间
3. **正常**：直接放置在当前坐标位置

### 4.4 目录自动生成

渲染阶段收集所有 `chapter` 到 `this.chapter[]`，导出结束时 `addCatalog()` 在首页插入带省略号引导线的目录：

```
第一章 标题 ........................ 1
  1.1 子标题 ...................... 2
```

---

## 五、与 Worker 方案的对比

| 维度 | 传统方案 (pdf.ts) | Worker 优化方案 | Worker V3 方案 |
|---|---|---|---|
| 渲染线程 | 主线程 | Worker 线程 | Worker 池 |
| 图片处理 | 主线程串行 | Worker 并行 | Worker 池并行 |
| 指令预计算 | 无 | 无 | buildInstructionPages 阶段分离 |
| 分页策略 | jsPDF 内部自动 | jsPDF 内部自动 | 预计算后并行渲染 |
| 适用场景 | 小文档、简单排版 | 中等复杂度 | 大文档、高并发需求 |

---

## 六、待优化项

1. **`TimingLogger` 存在 `records.push` 缺失 bug**：`start()` 未将记录 push 到 `records` 数组，`summary()` 总计值始终为 0（已修复于 pdf-worker-v3.ts，传统方案待修复）
2. **TimingLogger 无 `reset()` 方法**：多次导出时计时会累积（已修复于 pdf-worker-v3.ts，传统方案待修复）
3. **字体样式定制能力有限**：依赖默认字体，暂无自定义字体加载
4. **表格跨页处理**：依赖 jspdf-autotable 自动处理，无手动控制

---

*文档生成时间：2026-04-16*
