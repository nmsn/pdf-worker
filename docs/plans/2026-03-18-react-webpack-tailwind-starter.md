# React Webpack Tailwind 脚手架计划

## 目标

在空仓库中创建前端应用脚手架，使用 React 19.2、Webpack 5、TypeScript、Tailwind CSS 4、React Router、ESLint、Prettier、路径别名和 `.env` 模板。

## 范围

- 初始化包元数据和脚本
- 配置 TypeScript、Webpack、ESLint、Prettier、PostCSS 和 Tailwind CSS 4
- 创建带有两个页面的最小路由应用
- 添加简单的设计基准和环境变量示例
- 使用 `pnpm lint` 和 `pnpm build` 验证配置

## 步骤

1. 创建 `package.json`，包含运行时和开发依赖，以及 `dev`、`build`、`serve` 和 `lint` 脚本
2. 添加 `tsconfig.json`，配置严格 TypeScript 设置，并将 `@/*` 路径别名映射到 `src/*`
3. 添加 `webpack.config.cjs`，支持 TypeScript、CSS、资源处理、HTML 生成、开发服务器和 `APP_` 环境变量注入
4. 添加 `postcss.config.mjs` 用于 Tailwind CSS 4 处理
5. 添加 `public/index.html` 作为 Webpack HTML 模板
6. 添加 `.gitignore`、`.env.example`、`.eslintrc.cjs` 和 `.prettierrc`
7. 添加 `src/main.tsx`、应用外壳文件、路由页面和 Tailwind 驱动的样式
8. 使用 `pnpm install` 安装依赖
9. 运行 `pnpm lint`
10. 运行 `pnpm build`

## 验证

- `pnpm lint` 成功退出
- `pnpm build` 在 `dist/` 目录输出生产构建产物