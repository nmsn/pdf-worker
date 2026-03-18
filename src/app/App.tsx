import { Link, Outlet } from "react-router-dom";

const appTitle = "PDF Worker";

export function App() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#f3efe5,transparent_38%),linear-gradient(180deg,#fbf8f2_0%,#f3eee2_100%)] text-stone-900">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-8">
        <header className="flex flex-col gap-6 rounded-[2rem] border border-stone-900/10 bg-white/70 px-6 py-5 shadow-[0_20px_60px_rgba(82,55,24,0.08)] backdrop-blur md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-700">
              React 19.2 Starter
            </p>
            <h1 className="mt-2 font-['Georgia'] text-3xl font-semibold tracking-tight text-stone-950">
              {appTitle}
            </h1>
          </div>

          <nav className="flex items-center gap-3 text-sm font-medium">
            <Link className="nav-link" to="/">
              Home
            </Link>
            <Link className="nav-link" to="/about">
              About
            </Link>
            <Link className="nav-link" to="/pdf">
              PDF
            </Link>
          </nav>
        </header>

        <main className="flex-1 py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
