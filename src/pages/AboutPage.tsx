export function AboutPage() {
  return (
    <section className="grid gap-6 md:grid-cols-[1.25fr_0.75fr]">
      <div className="rounded-[2rem] border border-stone-900/10 bg-white px-6 py-8 shadow-[0_20px_60px_rgba(82,55,24,0.08)]">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-700">
          About This Stack
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-950">
          A clean baseline without locking you into a UI library.
        </h2>
        <p className="mt-4 max-w-2xl text-base leading-7 text-stone-600">
          This starter keeps the runtime small and the configuration explicit.
          You get routing, TypeScript path aliases, Tailwind CSS 4, environment
          variables, and linting from day one.
        </p>
      </div>

      <div className="rounded-[2rem] border border-stone-900/10 bg-stone-950 px-6 py-8 text-stone-100 shadow-[0_20px_60px_rgba(28,25,23,0.24)]">
        <p className="text-sm uppercase tracking-[0.24em] text-amber-300">
          Included
        </p>
        <ul className="mt-4 space-y-3 text-sm leading-6 text-stone-300">
          <li>Webpack 5 dev/build pipeline</li>
          <li>React Router application shell</li>
          <li>Tailwind CSS 4 CSS-first setup</li>
          <li>ESLint and Prettier defaults</li>
          <li>`APP_` environment variable exposure</li>
        </ul>
      </div>
    </section>
  );
}
