'use client';

import { useEffect, useState } from 'react';
import { Card } from './ui';

export interface AgentInfo {
  status: 'provisioning' | 'ready' | 'asleep' | 'error' | 'deleting';
  maritimeAgentId: string | null;
  lastError: string | null;
  lastSeenAt: string | null;
  settingsSynced: boolean;
}

const LABEL: Record<AgentInfo['status'], { text: string; detail: string; dot: string }> = {
  provisioning: {
    text: 'Setting up',
    detail: 'Your private agent is starting. This takes about a minute.',
    dot: 'bg-amber-500',
  },
  ready: { text: 'Awake', detail: 'Your agent is awake and ready.', dot: 'bg-emerald-600' },
  asleep: {
    text: 'Asleep',
    detail: 'Your agent sleeps when idle and wakes for your brief, new emails and submissions.',
    dot: 'bg-sky-600',
  },
  error: { text: 'Needs attention', detail: 'Your agent could not start.', dot: 'bg-flare' },
  deleting: { text: 'Deleting', detail: 'Your agent is being removed.', dot: 'bg-slate-500' },
};

/** Shows the student's agent and polls while it is starting. Status changes are announced. */
export function AgentStatus({ initial }: { initial: AgentInfo | null }) {
  const [agent, setAgent] = useState(initial);

  useEffect(() => {
    if (agent && agent.status !== 'provisioning' && agent.settingsSynced) return;
    const t = setInterval(async () => {
      const res = await fetch('/api/me', { cache: 'no-store' });
      if (res.ok) setAgent(((await res.json()) as { agent: AgentInfo | null }).agent);
    }, 5000);
    return () => clearInterval(t);
  }, [agent]);

  const s = agent ? LABEL[agent.status] : null;
  return (
    <Card>
      <h2 className="text-lg font-semibold">Your agent</h2>
      <div aria-live="polite" className="mt-2">
        {!agent || !s ? (
          <p>Not set up yet. It starts automatically after sign-in.</p>
        ) : (
          <>
            <p className="flex items-center gap-2 font-medium">
              <span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-full ${s.dot}`} />
              {s.text}
            </p>
            <p className="mt-1 text-sm">{s.detail}</p>
            {agent.status === 'error' && agent.lastError && (
              <p className="mt-2 text-sm text-flare">{agent.lastError}</p>
            )}
            {agent.maritimeAgentId && (
              <p className="mt-3 text-xs text-sea-800/70 dark:text-sea-100/70">
                Runs in its own isolated Maritime VM ·{' '}
                <span className="font-mono">{agent.maritimeAgentId.slice(0, 8)}</span>
              </p>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
