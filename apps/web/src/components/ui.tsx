import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function Shell({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 py-8 sm:max-w-2xl">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {actions}
      </header>
      {children}
    </main>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-2xl bg-white p-5 shadow-sm ring-1 ring-sea-100 dark:bg-sea-800 dark:ring-sea-600 ${className}`}
    >
      {children}
    </section>
  );
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const styles = {
    primary:
      'bg-sea-800 text-white hover:bg-sea-950 dark:bg-sea-100 dark:text-sea-950 dark:hover:bg-white',
    ghost:
      'bg-transparent text-sea-800 ring-1 ring-sea-600/40 hover:bg-sea-100 dark:text-sea-50 dark:hover:bg-sea-950',
    danger: 'bg-transparent text-flare ring-1 ring-flare/50 hover:bg-flare/10',
  }[variant];
  return (
    <button
      {...props}
      className={`min-h-11 rounded-xl px-4 py-2 font-medium transition focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-sea-600 disabled:cursor-not-allowed disabled:opacity-60 ${styles} ${className}`}
    />
  );
}

export const inputClass =
  'min-h-11 w-full rounded-xl border border-sea-600/40 bg-white px-3 py-2 text-base text-sea-950 focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-sea-600 dark:bg-sea-950 dark:text-sea-50';

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-sm text-sea-800/80 dark:text-sea-100/80">{hint}</p>}
    </div>
  );
}
