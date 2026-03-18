# React Webpack Tailwind Starter Plan

## Goal

Create a front-end application scaffold in an empty repository using React 19.2, Webpack 5, TypeScript, Tailwind CSS 4, React Router, ESLint, Prettier, path aliases, and an `.env` template.

## Scope

- Initialize package metadata and scripts.
- Configure TypeScript, Webpack, ESLint, Prettier, PostCSS, and Tailwind CSS 4.
- Create a minimal routed application with two pages.
- Add a simple design baseline and environment variable example.
- Verify the setup with `pnpm lint` and `pnpm build`.

## Steps

1. Create `package.json` with runtime and development dependencies plus `dev`, `build`, `serve`, and `lint` scripts.
2. Add `tsconfig.json` with strict TypeScript settings and the `@/*` path alias mapped to `src/*`.
3. Add `webpack.config.cjs` that supports TypeScript, CSS, asset handling, HTML generation, a dev server, and `APP_` environment variable injection.
4. Add `postcss.config.mjs` for Tailwind CSS 4 processing.
5. Add `public/index.html` as the Webpack HTML template.
6. Add `.gitignore`, `.env.example`, `.eslintrc.cjs`, and `.prettierrc`.
7. Add `src/main.tsx`, app shell files, routed pages, and Tailwind-driven styles.
8. Install dependencies with `pnpm install`.
9. Run `pnpm lint`.
10. Run `pnpm build`.

## Verification

- `pnpm lint` exits successfully.
- `pnpm build` emits a production bundle in `dist/`.
