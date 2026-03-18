# PDF Worker V3 验证计划

## 目标

添加双轨制 `pdf-worker-v3` 实验，验证 Webpack 5 模块化 Worker 重构路径，不替换当前的 `lib/pdf-worker.ts` 实现。

## 非目标

- 不重写或移除现有的 `exportPdfWithWorker` 流程
- 不更改当前 PDF 页面按钮的旧版 Worker 路径行为
- 不对现有 `lib/pdf-worker.ts` 进行完整的行为清理

## 验证范围

- 保留当前 Worker 实现可用
- 添加新的 `exportPdfWithWorkerV3` 入口
- 将实验性 Worker 逻辑移至独立 Worker 文件
- 在模块化 Worker 内使用 npm 管理的依赖
- 使用 Comlink 作为 Worker API
- 支持当前页面示例内容：标题、文本、表格、图片和显式分页

## 文件

- `lib/pdf-worker-v3.ts`
- `lib/workers/image-preloader.worker.ts`
- `lib/workers/pdf-renderer.worker.ts`
- `lib/workers/pdf-worker-types.ts`
- `src/pages/PdfPage.tsx`

## 验证项

1. 现有 `传统方案导出` 按钮保持不变
2. 现有 `Worker方案导出` 按钮保持不变
3. 新的 `Worker V3 方案导出` 按钮仅调用实验路径
4. `pnpm build` 构建成功
5. 旧版路由和导入仍然可用