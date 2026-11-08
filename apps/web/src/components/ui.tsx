import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { AppNav } from './AppNav';

/**
 * Page frame. Signed-in pages get the app navigation; `nav={false}` for sign-in and setup.
 * Titles are large, light and tightly tracked; content sits in a calm single column.
 */
export function Shell({
  title,
  subtitle,
  children,
  actions,
  nav = true,
  wide = false,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  nav?: boolean;
  wide?: boolean;
}) {
  return (
    <>
      {nav && <AppNav />}
      <main
        className={`mx-auto flex w-full flex-col gap-6 px-5 pt-8 ${nav ? 'pb-28 sm:pb-16' : 'pb-16'} ${wide ? 'max-w-5xl' : 'max-w-2xl'}`}
      >
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h1 className="text-title font-normal tracking-tight text-ink sm:text-headline">
              {title}
            </h1>
            {subtitle && <p className="max-w-prose text-base text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
        {children}
      </main>
    </>
  );
}

/** Quiet container: white surface, thin border, 8px radius. */
export function Card({
  children,
  className = '',
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article';
}) {
  return (
    <Tag className={`rounded-card border border-line bg-surface p-5 sm:p-6 ${className}`}>
      {children}
    </Tag>
  );
}

export function CardTitle({
  children,
  aside,
  id,
}: {
  children: ReactNode;
  aside?: ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <h2 id={id} className="text-[17px] font-semibold tracking-tight text-ink">
        {children}
      </h2>
      {aside && <div className="shrink-0 text-sm text-muted">{aside}</div>}
    </div>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'ghost' | 'danger';

const BUTTON: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-white hover:bg-ink-soft disabled:bg-ink/40',
  secondary:
    'border border-line-strong bg-surface text-on-surface shadow-[0_1px_2px_rgba(16,24,40,0.05)] hover:bg-canvas',
  // `ghost` kept as an alias of secondary for older call sites.
  ghost:
    'border border-line-strong bg-surface text-on-surface shadow-[0_1px_2px_rgba(16,24,40,0.05)] hover:bg-canvas',
  tertiary: 'h-auto! rounded-none! px-0! text-ink underline-offset-4 hover:underline',
  danger: 'border border-danger/40 bg-surface text-danger hover:bg-danger-soft',
};

export function buttonClass(variant: ButtonVariant = 'primary', className = '') {
  return `inline-flex h-11 items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${BUTTON[variant]} ${className}`;
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button {...props} className={buttonClass(variant, className)} />;
}

/** Pill input, 44px tall, matching the secondary button. */
export const inputClass =
  'h-11 w-full rounded-full border border-line-strong bg-surface px-4 text-base text-on-surface placeholder:text-muted/70 disabled:bg-canvas';

/** File picker: a soft box with a pill "Choose file" button. */
export const fileInputClass =
  'w-full rounded-2xl border border-line-strong bg-surface p-1.5 text-sm text-muted file:mr-3 file:h-9 file:cursor-pointer file:rounded-full file:border-0 file:bg-ink file:px-4 file:text-sm file:font-semibold file:text-white hover:file:bg-ink-soft';

/** Demo-only controls: dashed border and a "Demo" label, never styled like an error. */
export const demoCardClass = 'border-dashed border-line-strong bg-surface/60';

/** Multi-line fields can't be pills; same border, softer radius. */
export const textareaClass =
  'w-full rounded-2xl border border-line-strong bg-surface px-4 py-3 text-base text-on-surface placeholder:text-muted/70 disabled:bg-canvas';

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
      <label htmlFor={htmlFor} className="text-sm font-semibold text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="px-1 text-sm text-muted">{hint}</p>}
    </div>
  );
}

export type Tone = 'neutral' | 'accent' | 'warn' | 'ok' | 'danger';

const CHIP: Record<Tone, string> = {
  neutral: 'border-line bg-surface text-ink-soft',
  accent: 'border-accent/20 bg-accent-soft text-accent',
  warn: 'border-warn/25 bg-warn-soft text-warn',
  ok: 'border-ok/25 bg-ok-soft text-ok',
  danger: 'border-danger/25 bg-danger-soft text-danger',
};

/** Small pill for status and metadata. Color is never the only signal: always has text. */
export function Chip({
  tone = 'neutral',
  children,
  className = '',
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex w-fit items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${CHIP[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

const BANNER: Record<Tone, string> = {
  neutral: 'border-line bg-surface text-ink-soft',
  accent: 'border-accent/20 bg-accent-soft text-ink',
  warn: 'border-warn/25 bg-warn-soft text-ink',
  ok: 'border-ok/25 bg-ok-soft text-ink',
  danger: 'border-danger/25 bg-danger-soft text-ink',
};

/** Inline message box. Use role="alert" for errors that need attention now. */
export function Banner({
  tone = 'neutral',
  children,
  role,
  className = '',
}: {
  tone?: Tone;
  children: ReactNode;
  role?: 'alert' | 'status';
  className?: string;
}) {
  return (
    <div role={role} className={`rounded-xl border px-4 py-3 text-sm ${BANNER[tone]} ${className}`}>
      {children}
    </div>
  );
}

/** Small uppercase-free eyebrow label for groups ("Focus today"). */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-sm font-medium text-muted">{children}</p>;
}
