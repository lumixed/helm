import Link from 'next/link';
import { HelmMark } from '@/components/icons';
import { buttonClass } from '@/components/ui';

export default function NotFound() {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 px-5 text-center"
    >
      <HelmMark width={32} height={32} className="text-ink" />
      <h1 className="text-title font-normal tracking-tight text-ink">This page isn&apos;t here</h1>
      <p className="text-muted">
        The link may be old, or the page moved. Your list and your agent are fine.
      </p>
      <Link href="/today" className={buttonClass('primary')}>
        Go to Today
      </Link>
    </main>
  );
}
