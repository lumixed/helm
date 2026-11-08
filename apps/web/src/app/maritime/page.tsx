import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { Card, Chip, Shell, type Tone } from '@/components/ui';
import { getDb, schema } from '@/db';
import { requireProfile } from '@/lib/page-data';
import { buildScorecard, type RowStatus } from '@/lib/scorecard';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Under the hood' };

const STATUS: Record<RowStatus, { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'ok' },
  partial: { label: 'Partly active', tone: 'accent' },
  not_active: { label: 'Not active', tone: 'neutral' },
  unknown: { label: "Couldn't check", tone: 'warn' },
};

/** Judge-facing scorecard (PRD v2 section 6): live evidence for each Maritime feature Helm uses. */
export default async function MaritimePage() {
  await requireProfile();
  const user = (await currentUser())!;
  const db = await getDb();
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.userId, user.id));
  const rows = await buildScorecard(db, user, agent ?? null);
  const active = rows.filter((r) => r.status === 'active').length;
  const partial = rows.filter((r) => r.status === 'partial').length;

  return (
    <Shell
      wide
      title="Under the hood"
      subtitle="How Helm uses Maritime to keep your assistant private. Every row below is live data from your own agent; anything that isn't running says so."
    >
      <section aria-label="Summary" className="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <Card className="flex flex-col justify-center">
          <p className="text-sm text-muted">Maritime features in use</p>
          <p className="mt-1 text-[44px] leading-none font-normal tracking-tight text-ink">
            {active}
            <span className="text-2xl text-muted"> / {rows.length}</span>
          </p>
          <p className="mt-2 text-sm text-muted">
            {active} active{partial ? `, ${partial} partly active` : ''}, live from your agent.
          </p>
        </Card>
        <Card>
          <p className="mb-3 text-sm font-semibold text-ink">Isolation at every layer</p>
          <Layers />
        </Card>
      </section>

      <section aria-label="Features" className="grid gap-3 md:grid-cols-2">
        {rows.map((r) => (
          <Card key={r.id} as="article" className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-[17px] font-semibold tracking-tight text-ink">{r.feature}</h2>
              <Chip tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Chip>
            </div>
            <p className="text-sm text-ink-soft">{r.how}</p>
            <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-xl border border-line bg-canvas px-4 py-3 text-sm">
              {r.evidence.map((e) => (
                <div key={e.label} className="contents">
                  <dt className="text-muted">{e.label}</dt>
                  <dd className="min-w-0 font-mono text-[13px] break-words text-ink">{e.value}</dd>
                </div>
              ))}
            </dl>
            {r.note && <p className="text-sm text-muted">{r.note}</p>}
          </Card>
        ))}
      </section>

      <p className="text-sm text-muted">
        Read-only. Pulled from Maritime&apos;s API and Helm&apos;s own records when this page loads.
        Secret values are never read or shown.
      </p>
    </Shell>
  );
}

/** Simple nested-box diagram of the isolation layers. Decorative text is real content (readable). */
function Layers() {
  const box = 'rounded-xl border px-3 py-2';
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <div className={`${box} border-line bg-canvas`}>
        <p className="font-semibold text-ink">You</p>
        <p className="text-muted">Approve hand-ins, take over for logins</p>
      </div>
      <div className={`${box} border-line bg-canvas`}>
        <p className="font-semibold text-ink">Helm app</p>
        <p className="text-muted">Keeps dates and receipts, never your files or passwords</p>
      </div>
      <div className={`${box} border-accent/30 bg-accent-soft`}>
        <p className="font-semibold text-ink">Your private agent on Maritime</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {['Own VM + /data', 'Encrypted secrets', 'Network allowlist', 'Spend & wake caps'].map(
            (t) => (
              <span
                key={t}
                className="rounded-lg border border-accent/20 bg-surface px-2 py-1.5 text-center text-ink"
              >
                {t}
              </span>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
