# Webpack 5 Worker 重构实验方案

这份文档用于指导一个新的 Webpack 5 实验项目，验证如何把 `pdf-work.ts` 中当前使用的“字符串 + Blob 创建 Worker + importScripts(CDN)”方案，重构为“独立 Worker 文件 + npm 依赖 + Comlink”方案。

目标不是一次性优化所有细节，而是验证这条路径是否能稳定替代当前实现，并解决以下问题：

- Worker 内反复 `importScripts` 引入 CDN 资源
- 主线程依赖和 Worker 依赖分离，存在版本漂移风险
- 字符串 Worker 可维护性差
- Worker 代码无法纳入 Webpack 模块图

## 1. 重构目标

### 1.1 需要保留的能力

新方案需要保留当前 `pdf-work.ts` 的核心能力：

- 主线程负责收集页面绘制指令
- Worker 负责单页 PDF 渲染
- 图片预处理可放到单独 Worker
- 支持 Worker 池
- 支持通过 `pdf-lib` 合并多个页面 PDF

### 1.2 需要替换的部分

重点替换的是当前这种模式：

```ts
const workerCode = `
  importScripts('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  importScripts('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js');
  importScripts('https://cdn.jsdelivr.net/npm/comlink/dist/umd/comlink.min.js');
  ...
`

const blob = new Blob([workerCode], { type: 'application/javascript' });
const workerUrl = URL.createObjectURL(blob);
const worker = new Worker(workerUrl);
```

替换为真正的 Worker 模块文件：

```ts
const worker = new Worker(
  new URL('./workers/pdf-renderer.worker.ts', import.meta.url),
  { type: 'module' }
);
```

## 2. 核心设计

### 2.1 文件职责拆分

建议把结构拆成三层：

#### 1. `pdf-work.ts`

只保留调度职责：

- 收集文本、图片、表格指令
- 管理分页
- 创建 Worker 池
- 调用 Worker API
- 合并 PDF
- 触发下载

不再在这里拼接 Worker 字符串。

#### 2. `workers/pdf-renderer.worker.ts`

只负责单页 PDF 渲染：

- 接收单页绘制指令
- `import { jsPDF } from 'jspdf'`
- `import autoTable from 'jspdf-autotable'`
- 渲染文本、图片、表格
- 返回当前页 `ArrayBuffer`

#### 3. `workers/image-preloader.worker.ts`

只负责图片预处理：

- 拉取图片
- 解码图片
- 转换格式
- 返回尺寸信息和可复用图片数据

### 2.2 Comlink 的角色

`Comlink` 不是用来替代 Worker 文件的，而是用来替代手写消息协议的。

在这个方案里，`Comlink` 的角色是：

- 主线程里通过 `wrap()` 获取远程 API
- Worker 内通过 `expose()` 暴露方法
- 避免大量手写 `postMessage` / `onmessage`
- 让渲染 Worker 和预处理 Worker 的调用方式统一

也就是说：

- Worker 文件负责“依赖加载和执行环境”
- Comlink 负责“调用方式和 API 暴露”

## 3. 推荐目录结构

```txt
src/
  lib/
    pdf-work.ts
    workers/
      pdf-renderer.worker.ts
      image-preloader.worker.ts
    types/
      pdf-worker-types.ts
```

推荐把 Worker 输入输出类型单独抽到 `types`，避免主线程和 Worker 各写一份接口。

## 4. 数据流设计

### 4.1 主线程流程

主线程执行顺序建议保持为：

1. 接收业务数据
2. 收集绘制指令
3. 收集图片索引
4. 调用图片预处理 Worker
5. 将每页指令分发给 PDF 渲染 Worker
6. 收集每页 `ArrayBuffer`
7. 用 `pdf-lib` 合并
8. 下载

### 4.2 Worker 之间的边界

#### 图片 Worker 输出

建议输出：

- `width`
- `height`
- `Uint8Array` 或 `ArrayBuffer`

#### PDF 渲染 Worker 输入

建议输入：

- 当前页绘制指令数组
- `pageSize`
- 当前页使用到的图片数据映射

注意：不要让 PDF Worker 再去拉原始图片 URL。否则图片处理链路会重新回到 Worker 渲染阶段，失去预处理的意义。

## 5. 实验方案对比

建议在新项目里只验证下面两种版本，不要一开始做太多变体。

### 方案 A：独立 Worker 文件 + Comlink

主线程：

```ts
import * as Comlink from 'comlink';

const worker = new Worker(
  new URL('./workers/pdf-renderer.worker.ts', import.meta.url),
  { type: 'module' }
);

const api = Comlink.wrap<PDFRendererWorkerAPI>(worker);
```

Worker：

```ts
import * as Comlink from 'comlink';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const api = {
  async renderPage(instructions, pageSize, imageDataMap) {
    const doc = new jsPDF('p', 'px', pageSize);
    ...
    return doc.output('arraybuffer');
  },
};

Comlink.expose(api);
```

这是推荐实验路径。

优点：

- 结构清晰
- 最符合 Webpack 5 模块化方式
- 便于后续拆分和测试
- 依赖完全由 npm + Webpack 管理

缺点：

- 初次改造成本高于字符串 Worker

### 方案 B：独立 Worker 文件，不使用 Comlink

主线程用 `postMessage`，Worker 用 `onmessage`。

优点：

- 依赖更少
- 更接近底层机制

缺点：

- 接口扩展性差
- 多个方法时协议会变乱
- 类型边界不好维护

如果这是一个需要持续演进的 PDF 管线，不建议选这个方案作为长期方案。

## 6. 为什么这个方案优于字符串 Worker

### 6.1 消除 CDN 依赖

原方案每个 Worker 都需要在运行时 `importScripts` 拉取外部资源。

新方案中：

- `jspdf`
- `jspdf-autotable`
- `comlink`

全部由 npm 安装，并由 Webpack 打包进 Worker chunk。

这样带来的变化是：

- 不再依赖外网
- 版本一致
- 本地开发和生产环境更稳定
- 错误更容易定位

### 6.2 Worker 代码进入模块图

字符串 Worker 最大的问题不是“难看”，而是它完全绕开了构建系统。

独立 Worker 文件的好处：

- 支持 TypeScript
- 支持 lint
- 支持模块拆分
- 支持 source map
- 支持正常重构

### 6.3 更容易做 Worker 池

当 Worker 变成真正的模块文件后，Worker 池管理会更清晰：

- 创建逻辑固定
- 生命周期固定
- 资源回收也更容易统一管理

## 7. 实验时需要重点关注的风险

### 7.1 `jspdf-autotable` 在 Worker 里的挂载方式

这是实验里的第一个重点。

需要确认在 Worker 模块中采用下面哪种方式可用：

```ts
import autoTable from 'jspdf-autotable';
autoTable(doc, options);
```

还是：

```ts
import 'jspdf-autotable';
(doc as any).autoTable(...)
```

这取决于该库在当前版本下的导出方式和 Worker 环境兼容性。

### 7.2 Worker 内能否直接使用图片相关 API

需要验证的 API：

- `fetch`
- `createImageBitmap`
- `OffscreenCanvas`

如果实验环境不完整支持这些能力，需要保留降级路径。

### 7.3 主线程和 Worker 仍然不会共享同一个 `jspdf` 实例

这点要明确。

即使改成独立 Worker 文件，主线程和 Worker 也仍然是两个运行时。

优化的目标不是“共享实例”，而是：

- 不再运行时请求 CDN
- 不再把 Worker 依赖放在字符串里手工维护
- 让 Worker 模块进入构建系统

### 7.4 如果主线程也 import `jspdf`，最终 bundle 仍可能重复

这是正常现象。

如果想进一步压缩体积，最有效的策略是：

- 让 `jspdf` 尽量只存在于 Worker 侧
- 主线程只保留布局和调度逻辑

## 8. 最小实验范围

建议新项目里只做最小闭环，不要一开始就完整迁移原工程。

### 第一阶段

只验证：

- 一个 `pdf-renderer.worker.ts`
- 一页文本渲染
- 一页表格渲染
- 返回 `ArrayBuffer`

### 第二阶段

加入：

- 图片渲染
- 图片预处理 Worker
- 多页并行渲染

### 第三阶段

再补：

- Worker 池
- 目录页
- 合并 PDF
- 性能计时

这样能尽快确定：

- Worker 模块化方案是否可行
- `jspdf` / `autotable` 在 Worker 中是否稳定
- Comlink 接口设计是否合适

## 9. 建议的实验结论标准

新方案如果满足下面几点，就说明值得迁移：

- 不再出现 `importScripts(CDN)`
- Worker 文件可以正常通过 Webpack 5 打包
- `jspdf` 与 `jspdf-autotable` 能在 Worker 中稳定工作
- 单页渲染结果和旧方案一致
- 多页并行渲染结果稳定
- Worker 池可复用

## 10. 推荐结论

如果目的是验证 `pdf-work.ts` 的 Worker 改造方向，推荐结论很明确：

- 不继续优化字符串 Worker
- 直接转向“独立 Worker 文件 + Comlink + npm 依赖”
- 用 Webpack 5 的模块 Worker 能力承接 Worker 构建

这条路径的真正收益不是只减少一次 `importScripts`，而是把整个 Worker 层重新纳入正常的工程体系。

## 11. 后续实验顺序建议

建议按下面顺序开展实验：

1. 建一个新的 Webpack 5 最小项目
2. 创建 `pdf-renderer.worker.ts`
3. 用 `Comlink.expose()` 暴露一个 `renderPage()` 方法
4. 在主线程里用 `Comlink.wrap()` 调用
5. 验证 `jspdf` 文本输出
6. 验证 `jspdf-autotable`
7. 再引入图片 Worker
8. 最后再决定是否把原项目完整迁移

这会比直接在现有复杂工程里改造安全得多。
