# `lib/pdf.ts` 执行历程梳理（传统方案）

这份文档说明 `lib/pdf.ts` 的完整执行过程，这是 PDF 导出的**传统方案**，所有操作都在主线程同步执行。

## 1. 方案概述

### 1.1 核心特点

传统方案是**单线程同步执行**的 PDF 导出实现：

- 所有操作在主线程执行
- 边布局边渲染
- 使用 `jsPDF` 直接绘制
- 无 Worker 并行优化

### 1.2 适用场景

- 小规模文档导出
- 兼容性要求高的环境
- 快速原型开发

## 2. 整体设计思路

### 2.1 类结构设计

```typescript
class PDF {
  // 页面配置
  border: number;       // 页面边距
  padding: number;      // 内容间距
  pageSize: string;     // 页面尺寸
  headerImg: string;    // 页眉图片

  // 状态追踪
  x: number;            // 当前 x 坐标
  y: number;            // 当前 y 坐标
  chapter: Chapter[];   // 章节记录（用于生成目录）
  serialStack: SerialStack;  // 序号管理器

  // jsPDF 实例
  pdf: JsPdf;
}
```

### 2.2 执行流程

```
exportPdf(data, title, options)
       ↓
    初始化 PDF 实例
       ↓
    遍历 data[]
  ├── heading → addChapter()
  ├── text    → addText()
  ├── table   → addTable()
  ├── img     → addImage()
  └── addPage → addPage()
       ↓
    addCatalog()  插入目录页
       ↓
    save()  保存并下载
```

## 3. 核心组件

### 3.1 序号管理器 `SerialStack`

管理章节编号、图片编号、表格编号：

```typescript
interface SerialStack {
  setSerial(level: number): string;   // 设置标题级别，返回序号
  getSerial(): string;                 // 获取当前标题序号
  getImgSerial(): string;              // 获取图片序号
  getTableSerial(): string;            // 获取表格序号
}
```

**编号规则**：

- 一级标题：`Chap One`、`Chap Two` ...
- 二级及以下：`1.1`、`1.2`、`2.1` ...
- 图片：`1.1`、`1.2`（在当前章节内递增）
- 表格：`1.1`、`1.2`（在当前章节内递增）

### 3.2 时间记录器 `TimingLogger`

记录各阶段执行时间，便于性能分析：

```typescript
class TimingLogger {
  start(name: string): void;
  end(name: string): number;
  increment(name: string): number;
  summary(): void;
}
```

## 4. 核心方法详解

### 4.1 文本绘制 `drawText`

```typescript
function drawText(pdf: JsPdf, text: string, config?: TextConfig): TextResult
```

**功能**：

- 计算文本位置（支持左对齐、居中、右对齐）
- 处理自动换行
- 支持首行缩进

**参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| x | number | 指定 x 坐标 |
| y | number | 指定 y 坐标 |
| fontSize | number | 字体大小 |
| align | 'left' \| 'center' \| 'right' | 对齐方式 |
| maxWidth | number | 最大宽度（用于换行） |
| indent | boolean | 是否首行缩进 |

### 4.2 图片绘制 `drawImg`

```typescript
async function drawImg(pdf: JsPdf, imgUrl: string, config?: ImgConfig): Promise<ImgResult>
```

**功能**：

- 加载图片并转换为 base64
- 自动计算图片位置和尺寸
- 处理分页逻辑（图片超出页面、图片在页面底部空间不足）
- 支持底部文字说明

**图片处理流程**：

```
imgUrl
    ↓
transformImageToBase64AndImg()
    ├── loadImage()      加载图片
    └── imageToBase64()  转换为 base64
    ↓
计算尺寸和位置
    ↓
pdf.addImage()  绘制到 PDF
```

**分页策略**：

1. **图片超出整页**：缩放图片填满整页
2. **图片超出当前页剩余空间**：
   - 若剩余空间 >= 页面高度的 80%：缩放图片适应剩余空间
   - 否则：换到新页面绘制

### 4.3 表格绘制 `drawTable`

```typescript
function drawTable(pdf: JsPdf, tableConfig?: TableConfig, config?: DrawTableConfig): TableResult
```

**功能**：

- 使用 `jspdf-autotable` 插件绘制表格
- 支持自定义表头、表体样式
- 支持表格标题

**样式配置**：

```typescript
{
  headStyles: { fillColor: '#c00000', halign: 'center', valign: 'middle' },
  bodyStyles: { halign: 'center', valign: 'middle' },
  columnStyles: { ... }
}
```

### 4.4 目录生成 `addCatalog`

```typescript
addCatalog(pageNum = 1): void
```

**功能**：

- 在指定页码插入目录页
- 显示所有章节标题和对应页码
- 使用点号连接标题和页码

**目录格式**：

```
目录

Chap One 前言 ........................... 1
  1.1 背景 .............................. 2
  1.2 目的 .............................. 3
Chap Two 正文 ........................... 4
```

## 5. 入口函数 `exportPdf`

```typescript
export async function exportPdf(
  data: (IHeading | ITable | IImg | IPage | IText)[],
  title: string,
  options?: ExportOptions
): Promise<void>
```

### 5.1 数据类型

```typescript
interface IHeading {
  type: 'heading';
  data: { value: string; level: number };
}

interface IText {
  type: 'text';
  data: { value: string; options?: TextConfig };
}

interface IImg {
  type: 'img';
  data: { value: string; options?: ImgConfig };
}

interface ITable {
  type: 'table';
  data: { value: { head, body }; title: string; pdfOptions? };
}

interface IPage {
  type: 'addPage';
}
```

### 5.2 执行过程

```typescript
async function exportPdf(data, title, options) {
  // 1. 初始化 PDF 实例
  const pdf = new PDF(options);

  // 2. 遍历数据，逐个渲染
  for (const item of data) {
    switch (item.type) {
      case 'heading':
        if (!isEmptyPage) await pdf.addPage();
        await pdf.addChapter(item.data.value, item.data.level);
        break;
      case 'text':
        pdf.addText(item.data.value, item.data.options);
        break;
      case 'img':
        await pdf.addImage(item.data.value, item.data.options);
        break;
      case 'table':
        pdf.addTable(item.data.value, item.data.title);
        break;
      case 'addPage':
        await pdf.addPage();
        break;
    }
  }

  // 3. 插入目录页
  pdf.addCatalog();

  // 4. 保存并下载
  pdf.save(title);
}
```

## 6. 性能分析

### 6.1 性能瓶颈

传统方案的主要性能瓶颈：

| 操作 | 耗时占比 | 说明 |
|------|----------|------|
| 图片加载 | 30-50% | 网络 IO + 解码 |
| base64 转换 | 20-30% | Canvas 绘制 + 编码 |
| PDF 绘制 | 20-30% | jsPDF 渲染 |
| 其他 | 5-10% | 布局计算、目录生成 |

### 6.2 主线程阻塞

由于所有操作在主线程执行：

- 导出期间页面无响应
- 大图加载时卡顿明显
- 多页文档导出时间长

## 7. 与其他方案对比

| 特性 | 传统方案 (pdf.ts) | Worker 方案 (pdf-worker.ts) | V3 方案 (pdf-worker-v3.ts) |
|------|-------------------|----------------------------|----------------------------|
| 执行方式 | 主线程同步 | Worker 并行 | Worker 并行 |
| 图片处理 | 主线程 | Worker 预处理 | Worker 预处理 |
| 页面渲染 | 顺序渲染 | 并行渲染 | 并行渲染 |
| 模块化 | 单文件 | 内联 Worker | 独立 Worker 文件 |
| 类型安全 | 内部类型 | 分散定义 | 统一类型定义 |
| 开发体验 | 简单直接 | 调试困难 | 支持 HMR |
| 兼容性 | 最好 | 需要降级 | 需要降级 |

## 8. 优缺点总结

### 8.1 优点

1. **实现简单**：无需 Worker 通信，代码直观
2. **兼容性好**：不依赖现代浏览器特性
3. **调试方便**：所有代码在同一上下文
4. **体积小**：无需额外 Worker 代码

### 8.2 缺点

1. **主线程阻塞**：导出期间页面无法交互
2. **性能瓶颈**：图片处理耗时最长
3. **扩展性差**：难以添加并行优化
4. **用户体验**：大文档导出卡顿明显

## 9. 执行逻辑图

```
exportPdf()
       │
       ├─── new PDF() 初始化
       │
       ▼
遍历 data[]
       │
       ├── heading → addChapter()
       │               ├── 序号管理
       │               ├── 记录章节
       │               └── drawText() 绘制标题
       │
       ├── text → addText()
       │             └── drawText()
       │
       ├── img → addImage()
       │             ├── transformImageToBase64AndImg()
       │             │     ├── loadImage()
       │             │     └── imageToBase64()
       │             ├── 分页判断
       │             └── drawImg()
       │
       ├── table → addTable()
       │              ├── 序号管理
       │              └── drawTable()
       │
       └── addPage → addPage()
                       ├── pdf.addPage()
                       └── addHeader()
       │
       ▼
addCatalog()
       │
       ├── pdf.insertPage()
       └── drawSection() 绘制目录项
       │
       ▼
save()
       │
       ├── pdf.save()
       └── 触发下载
```

## 10. 一句话总结

`lib/pdf.ts` 是 PDF 导出的**传统单线程方案**，所有操作在主线程同步执行，实现简单但性能受限于主线程阻塞，适合小规模文档或兼容性要求高的场景。

核心特点：
- **单线程同步**：所有操作在主线程
- **边布局边渲染**：无预收集阶段
- **功能完整**：支持章节、目录、表格、图片
- **易于调试**：代码逻辑直观
