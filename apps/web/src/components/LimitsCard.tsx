import type { PolicySummary } from '@/lib/limits';
import { Card, CardTitle } from './ui';

/** Per-person limits set on Maritime (PRD v2 WP-3). Read-only. */
export function LimitsCard({ p }: { p: PolicySummary }) {
  const rows: [string, string][] = [
    ['Monthly AI budget', p.capCents != null ? `$${(p.capCents / 100).toFixed(2)}` : 'none'],
    ['Wake-ups per hour', p.wakesPerHour != null ? String(p.wakesPerHour) : 'platform default'],
    [
      'Sleeps after idle',
      p.idleSleepSeconds != null
        ? `${Math.round(p.idleSleepSeconds / 60)} min`
        : 'platform default',
    ],
    ['Machine size', p.machine ?? 'platform default'],
    [
      'Awake this month',
      p.awakeMinutesThisMonth != null ? `${p.awakeMinutesThisMonth} min` : 'not reported yet',
    ],
  ];
  return (
    <Card>
      <CardTitle aside="Set on Maritime">Limits</CardTitle>
      <p className="mb-3 text-sm text-ink-soft">
        Your agent has its own limits, so it can&apos;t run up costs or wake endlessly, even if
        something goes wrong.
      </p>
      <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-xl border border-line bg-canvas px-4 py-3 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      {!p.capCoversLlm && (
        <p className="mt-2 text-sm text-muted">
          The AI budget applies to Maritime&apos;s own AI service. Your agent currently uses Gemini
          directly, so the budget doesn&apos;t limit it yet.
        </p>
      )}
    </Card>
  );
}
