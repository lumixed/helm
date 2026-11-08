'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HelmMark, IconAdd, IconHandIn, IconSettings, IconTimeline, IconToday } from './icons';

const ITEMS = [
  { href: '/today', label: 'Today', Icon: IconToday },
  { href: '/intake', label: 'Add', Icon: IconAdd },
  { href: '/submissions', label: 'Hand in', Icon: IconHandIn },
  { href: '/timeline', label: 'Timeline', Icon: IconTimeline },
  { href: '/setup', label: 'Settings', Icon: IconSettings },
] as const;

/**
 * App navigation: a quiet top bar on wider screens, a bottom tab bar on phones (thumb reach).
 * The current page is marked with aria-current.
 */
export function AppNav() {
  const path = usePathname();
  const isActive = (href: string) =>
    path === href ||
    path.startsWith(`${href}/`) ||
    (href === '/intake' && path.startsWith('/review'));
  return (
    <>
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-line/80 bg-canvas/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-5">
          <Link
            href="/today"
            className="flex items-center gap-2 text-ink"
            aria-label="Helm, go to Today"
          >
            <HelmMark />
            <span className="text-[17px] font-semibold tracking-tight">Helm</span>
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-7 sm:flex">
            {[...ITEMS, { href: '/maritime', label: 'Under the hood' }].map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                aria-current={isActive(href) ? 'page' : undefined}
                className={`text-sm transition-colors ${isActive(href) ? 'font-medium text-ink' : 'text-muted hover:text-ink'}`}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
      >
        <ul className="mx-auto grid max-w-md grid-cols-5">
          {ITEMS.map(({ href, label, Icon }) => {
            const active = isActive(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${active ? 'text-ink' : 'text-muted'}`}
                >
                  <Icon width={22} height={22} strokeWidth={active ? 2 : 1.6} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
