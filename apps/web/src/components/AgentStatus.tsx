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
    dot: 'bg-warn',
  },
  ready: { text: 'Awake', detail: 'Your agent is awake and ready.', dot: 'bg-ok' },
  asleep: {
    text: 'Asleep',
    detail: 'Your agent sleeps when idle and wakes for your brief, new emails and submissions.',
    dot: 'bg-accent',
  },
  error: { text: 'Needs attention', detail: 'Your agent could not start.', dot: 'bg-danger' },
  deleting: { text: 'Deleting', detail: 'Your agent is being removed.', dot: 'bg-muted' },
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
      <h2 className="text-[17px] font-semibold tracking-tight text-ink">Your agent</h2>
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
              <p className="mt-2 text-sm text-danger">{agent.lastError}</p>
            )}
            {agent.maritimeAgentId && (
              <p className="mt-3 text-xs text-muted">
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
