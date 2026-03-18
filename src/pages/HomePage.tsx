import { FeatureCard } from "@/components/FeatureCard";

const features = [
  {
    title: "Typed from the entry point",
    description:
      "React 19.2 and TypeScript are wired together with a strict tsconfig and clean alias imports.",
  },
  {
    title: "Webpack kept explicit",
    description:
      "You can see exactly how CSS, HTML, assets, environment variables, and route fallbacks are configured.",
  },
  {
    title: "Tailwind CSS 4 ready",
    description:
      "The setup uses the v4 CSS-first workflow so tokens and utility composition live in your stylesheet, not legacy config.",
  },
];

export function HomePage() {
  return (
    <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
      <div className="rounded-[2rem] border border-stone-900/10 bg-white px-6 py-8 shadow-[0_20px_60px_rgba(82,55,24,0.08)]">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-700">
          Frontend Scaffold
        </p>
        <h2 className="mt-3 max-w-3xl font-['Georgia'] text-4xl font-semibold leading-tight tracking-tight text-stone-950">
          Build on a deliberate baseline instead of a pile of defaults.
        </h2>
        <p className="mt-4 max-w-2xl text-base leading-7 text-stone-600">
          Start with routing, linting, environment variables, and a styling
          system that stays close to the code you ship.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {features.map((feature) => (
            <FeatureCard
              key={feature.title}
              title={feature.title}
              description={feature.description}
            />
          ))}
        </div>
      </div>

      <aside className="rounded-[2rem] border border-amber-950/10 bg-[linear-gradient(180deg,#1c1917_0%,#292524_100%)] px-6 py-8 text-stone-100 shadow-[0_20px_60px_rgba(28,25,23,0.28)]">
        <p className="text-sm uppercase tracking-[0.24em] text-amber-300">
          Next Steps
        </p>
        <ol className="mt-5 space-y-4 text-sm leading-6 text-stone-300">
          <li>Replace the example pages in `src/pages`.</li>
          <li>Add API calls using `process.env.APP_API_BASE_URL`.</li>
          <li>Layer in state, data fetching, or a design system only when needed.</li>
        </ol>
      </aside>
    </section>
  );
}
