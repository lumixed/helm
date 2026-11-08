import { AppNav } from './AppNav';

/**
 * Shown while a page's server data loads (Next.js loading.tsx). Keeps the navigation in place,
 * mirrors the page layout, and tells screen readers what is happening.
 */
export function PageSkeleton({
  title,
  cards = 3,
  wide = false,
  nav = true,
}: {
  title: string;
  cards?: number;
  wide?: boolean;
  nav?: boolean;
}) {
  return (
    <>
      {nav && <AppNav />}
      <main
        id="main"
        aria-busy="true"
        className={`mx-auto flex w-full flex-col gap-6 px-5 pt-8 pb-28 sm:pb-16 ${wide ? 'max-w-5xl' : 'max-w-2xl'}`}
      >
        <p className="sr-only" role="status">
          Loading {title}…
        </p>
        <div aria-hidden className="flex flex-col gap-3">
          <div className="h-9 w-48 animate-pulse rounded-full bg-line sm:h-11 sm:w-64" />
          <div className="h-4 w-72 max-w-full animate-pulse rounded-full bg-line/70" />
        </div>
        <div aria-hidden className={`grid gap-3 ${wide ? 'md:grid-cols-2' : ''}`}>
          {Array.from({ length: cards }, (_, i) => (
            <div
              key={i}
              className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5 sm:p-6"
            >
              <div className="h-4 w-40 animate-pulse rounded-full bg-line" />
              <div className="h-3 w-full animate-pulse rounded-full bg-line/70" />
              <div className="h-3 w-5/6 animate-pulse rounded-full bg-line/70" />
              <div className="h-3 w-2/3 animate-pulse rounded-full bg-line/70" />
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
