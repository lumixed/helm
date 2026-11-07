'use client';

import { useEffect, useState } from 'react';
import { Card } from './ui';

interface Ev {
  id: string;
  type: string;
  reason: string;
  occurredAt: string;
  atLabel: string;
  payload: Record<string, unknown>;
}

const ICON: Record<string, string> = {
  'agent.woke': '☀︎',
  'agent.pong': '↔︎',
  'agent.error': '⚠︎',
  'intake.parsed': '📄',
  'brief.generated': '✎',
  'brief.failed': '⚠︎',
  'inbox.classified': '✉︎',
  'change.detected': '?',
  'change.applied': '↻',
  'egress.blocked': '⛔︎',
  'egress.allowed': '✓',
  'sandbox.created': '▢',
  'sandbox.command': '›',
  'sandbox.ended': '▣',
  'maritime:agent.woken': '⏻',
  'maritime:agent.sleeping': '☾',
  'maritime:agent.deployed': '⇪',
  'maritime:agent.error': '⚠︎',
  'maritime:agent.llm_limit_reached': '⏸︎',
  'maritime:end_user.created': '+',
  'maritime:helm.network_test': '⛨',
};

const SOURCE: Record<string, string> = {
  scheduled: 'platform cron',
  webhook: 'webhook',
  cli: 'API',
  front_door: 'chat',
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
      <ol aria-live="polite" className="flex flex-col divide-y divide-sea-100 dark:divide-sea-600">
        {events.map((e) => {
          const src =
            typeof e.payload.source === 'string'
              ? (SOURCE[e.payload.source] ?? e.payload.source)
              : null;
          const ms = typeof e.payload.ms === 'number' ? e.payload.ms : null;
          return (
            <li key={e.id} className="flex gap-3 py-3">
              <span aria-hidden className="w-6 shrink-0 text-center">
                {ICON[e.type] ?? '•'}
              </span>
              <div className="min-w-0">
                <p
                  className={
                    e.type.endsWith('error') ||
                    e.type.endsWith('failed') ||
                    e.type === 'egress.blocked' ||
                    e.payload.injectionSuspected === true
                      ? 'font-medium text-flare'
                      : 'font-medium'
                  }
                >
                  {e.reason}
                </p>
                <p className="text-sm text-sea-800/80 dark:text-sea-100/80">
                  <time dateTime={e.occurredAt}>{e.atLabel}</time>
                  {e.type.startsWith('maritime:') && ' · Maritime lifecycle event'}
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
