'use client';

import { useEffect, useState } from 'react';
import { Card } from './ui';
import {
  IconAdd,
  IconAlert,
  IconBolt,
  IconBell,
  IconBox,
  IconCheck,
  IconHandIn,
  IconMail,
  IconMoon,
  IconPen,
  IconShield,
  IconToday,
} from './icons';

interface Ev {
  id: string;
  type: string;
  reason: string;
  occurredAt: string;
  atLabel: string;
  payload: Record<string, unknown>;
}

type Tone = 'bad' | 'good' | 'maritime' | 'neutral';

/** Icon and tone per event type. Tone is never the only signal: the text says what happened. */
function look(
  type: string,
  payload: Record<string, unknown>,
): { Icon: typeof IconToday; tone: Tone } {
  const bad =
    type.endsWith('error') ||
    type.endsWith('failed') ||
    type === 'egress.blocked' ||
    type.endsWith('llm_limit_reached') ||
    (type === 'maritime:helm.network_test' && payload.reached === false) ||
    payload.injectionSuspected === true ||
    payload.critical === true;
  const tone: Tone = bad
    ? 'bad'
    : type === 'submission.submitted' || type === 'egress.allowed'
      ? 'good'
      : type.startsWith('maritime:') ||
          (type === 'reminder.fired' && payload.firedBy === 'maritime_cron')
        ? 'maritime'
        : 'neutral';
  if (type === 'egress.blocked' || type === 'egress.allowed' || type.includes('network_test'))
    return { Icon: IconShield, tone };
  if (bad) return { Icon: IconAlert, tone };
  if (type.endsWith('sleeping')) return { Icon: IconMoon, tone };
  if (type.endsWith('woke') || type.endsWith('woken')) return { Icon: IconToday, tone };
  if (type.startsWith('intake')) return { Icon: IconAdd, tone };
  if (type.startsWith('brief') || type.startsWith('review')) return { Icon: IconPen, tone };
  if (type.startsWith('inbox') || type.startsWith('change') || type.startsWith('followup'))
    return { Icon: IconMail, tone };
  if (type === 'submission.submitted') return { Icon: IconCheck, tone };
  if (type.startsWith('submission') || type === 'alert.sent') return { Icon: IconHandIn, tone };
  if (type.startsWith('sandbox')) return { Icon: IconBox, tone };
  if (type.startsWith('reminder')) return { Icon: IconBell, tone };
  return { Icon: IconBolt, tone };
}

const TONE: Record<Tone, string> = {
  bad: 'bg-danger-soft text-danger border-danger/20',
  good: 'bg-ok-soft text-ok border-ok/20',
  maritime: 'bg-accent-soft text-accent border-accent/20',
  neutral: 'bg-canvas text-ink border-line',
};

const SOURCE: Record<string, string> = {
  scheduled: 'platform cron',
  webhook: 'webhook',
  cli: 'API',
  front_door: 'chat',
  helm: 'Helm scheduler',
};

/** Everything the agent did and why. Polls while open; new items are announced politely. */
export function Timeline() {
  const [events, setEvents] = useState<Ev[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const res = await fetch('/api/timeline', { cache: 'no-store' });
      if (res.ok && alive) setEvents(((await res.json()) as { events: Ev[] }).events);
    };
    void load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (!events) return <p aria-live="polite">Loading…</p>;
  if (events.length === 0)
    return (
      <Card>
        <p>Nothing yet. Your agent logs every wake-up and action here.</p>
      </Card>
    );
  return (
    <Card>
      <ol aria-live="polite" className="flex flex-col divide-y divide-line">
        {events.map((e) => {
          const src =
            typeof e.payload.source === 'string'
              ? (SOURCE[e.payload.source] ?? e.payload.source)
              : null;
          const ms = typeof e.payload.ms === 'number' ? e.payload.ms : null;
          return (
            <li key={e.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
              <span
                aria-hidden
                className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${TONE[look(e.type, e.payload).tone]}`}
              >
                {(() => {
                  const { Icon } = look(e.type, e.payload);
                  return <Icon width={16} height={16} />;
                })()}
              </span>
              <div className="min-w-0">
                <p
                  className={
                    look(e.type, e.payload).tone === 'bad'
                      ? 'font-medium text-danger'
                      : 'font-medium text-ink'
                  }
                >
                  {e.reason}
                </p>
                <p className="text-sm text-muted">
                  <time dateTime={e.occurredAt}>{e.atLabel}</time>
                  {e.type.startsWith('maritime:') && ' · from Maritime'}
                  {src && ` · via ${src}`}
                  {typeof e.payload.latencyMs === 'number' &&
                    ` · woke ${(e.payload.latencyMs / 1000).toFixed(1)}s after the trigger`}
                  {ms !== null && ` · ${(ms / 1000).toFixed(1)}s`}
                  {typeof e.payload.writer === 'string' && ` · written by ${e.payload.writer}`}
                  {typeof e.payload.model === 'string' && ` · ${e.payload.model}`}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
