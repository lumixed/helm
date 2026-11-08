'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WebTaskView } from '@/lib/web-tasks';
import {
  Banner,
  Button,
  Card,
  CardTitle,
  Chip,
  Field,
  inputClass,
  textareaClass,
  buttonClass,
  type Tone,
} from './ui';

const STATUS: Record<string, { label: string; tone: Tone }> = {
  ready: { label: 'Ready to start', tone: 'neutral' },
  running: { label: 'Working', tone: 'accent' },
  approval: { label: 'Needs your yes', tone: 'warn' },
  needs_you: { label: 'Needs you', tone: 'warn' },
  done: { label: 'Finished', tone: 'ok' },
  failed: { label: 'Couldn’t finish', tone: 'danger' },
  stopped: { label: 'Stopped', tone: 'neutral' },
};
const ACTIVE = ['running', 'approval', 'needs_you'];

type Action =
  'start' | 'approve' | 'stop' | 'resume' | 'takeover' | { action: 'answer'; text: string };

/** Start a website task, follow it step by step, and answer when it stops to ask. */
export function WebTasksBoard({ initial, enabled }: { initial: WebTaskView[]; enabled: boolean }) {
  const [tasks, setTasks] = useState(initial);
  const [instruction, setInstruction] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const merge = useCallback((t: WebTaskView) => {
    setTasks((all) =>
      all.some((x) => x.id === t.id) ? all.map((x) => (x.id === t.id ? t : x)) : [t, ...all],
    );
  }, []);

  const current = tasks.find((t) => ACTIVE.includes(t.status));
  const currentId = current?.id;
  const currentStatus = current?.status;
  const stopped = useRef(false);

  // While a task runs, this page keeps it moving; each call does up to about 45 seconds of work.
  useEffect(() => {
    if (!currentId || currentStatus !== 'running') return;
    stopped.current = false;
    let failures = 0;
    void (async () => {
      while (!stopped.current) {
        const res = await fetch(`/api/tasks/${currentId}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'advance' }),
        }).catch(() => null);
        const body = res?.ok ? ((await res.json()) as { task: WebTaskView }) : null;
        if (stopped.current) return;
        if (body) {
          failures = 0;
          merge(body.task);
          if (body.task.status !== 'running') return;
        } else if (++failures >= 3) {
          setError('Lost touch with Helm. Your task carries on; refresh in a minute to see it.');
          return;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    })();
    return () => {
      stopped.current = true;
    };
  }, [currentId, currentStatus, merge]);

  async function respond(id: string, a: Action) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/tasks/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(typeof a === 'string' ? { action: a } : a),
    });
    const body = (await res.json().catch(() => ({}))) as { task?: WebTaskView; error?: string };
    setBusy(false);
    if (!res.ok || !body.task) {
      setError(body.error ?? 'That didn’t go through. Try again.');
      return;
    }
    merge(body.task);
  }

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instruction, url }),
    });
    const body = (await res.json().catch(() => ({}))) as { task?: WebTaskView; error?: string };
    setBusy(false);
    if (!res.ok || !body.task) {
      setError(body.error ?? 'Could not start that.');
      return;
    }
    merge(body.task);
    setInstruction('');
    setUrl('');
  }

  async function forgetDesktop() {
    if (!window.confirm('Delete your private tasks desktop and every site login on it?')) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/tasks/desktop', { method: 'DELETE' });
    const body = (await res.json().catch(() => ({}))) as { deleted?: boolean; error?: string };
    setBusy(false);
    setError(
      res.ok
        ? body.deleted
          ? 'Deleted.'
          : 'There was no desktop to delete.'
        : (body.error ?? 'Could not delete it.'),
    );
  }

  const ready = tasks.filter((t) => t.status === 'ready');
  const past = tasks.filter((t) => !ACTIVE.includes(t.status) && t.status !== 'ready');

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Banner role="alert" tone="warn">
          {error}
        </Banner>
      )}

      {current ? (
        <ActiveTask task={current} busy={busy} onRespond={(a) => respond(current.id, a)} />
      ) : !enabled ? (
        <Banner tone="neutral">Private desktops aren’t set up on this server yet.</Banner>
      ) : (
        <Card>
          <CardTitle>New task</CardTitle>
          <form onSubmit={start} className="flex flex-col gap-4">
            <Field label="What should Helm do?" htmlFor="task-instruction">
              <textarea
                id="task-instruction"
                required
                minLength={5}
                maxLength={1000}
                rows={3}
                className={textareaClass}
                placeholder="Renew the books that are due this week"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
              />
            </Field>
            <Field
              label="On which website?"
              htmlFor="task-url"
              hint="Helm stays on this site and asks before going anywhere else."
            >
              <input
                id="task-url"
                required
                className={inputClass}
                placeholder="mylibrary.org"
                autoCapitalize="none"
                autoCorrect="off"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </Field>
            <Button type="submit" disabled={busy} className="w-full sm:w-fit">
              Start
            </Button>
          </form>
        </Card>
      )}

      {ready.map((t) => (
        <Card key={t.id}>
          <div className="flex flex-col gap-2">
            <Chip>Asked for in chat</Chip>
            <p className="text-ink">{t.instruction}</p>
            <p className="text-sm text-muted">On {t.site}</p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || Boolean(current)} onClick={() => respond(t.id, 'start')}>
                Start
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => respond(t.id, 'stop')}>
                Don’t run
              </Button>
            </div>
          </div>
        </Card>
      ))}

      <Card>
        <CardTitle>How Helm keeps this safe</CardTitle>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
          <li>It works on its own private desktop, apart from your message apps.</li>
          <li>
            It asks before moving to another site, and before anything that pays, sends, submits or
            deletes.
          </li>
          <li>You type every password and card number yourself, on the private desktop.</li>
        </ul>
      </Card>

      {past.length > 0 && (
        <Card>
          <CardTitle>Earlier</CardTitle>
          <ul className="flex flex-col divide-y divide-line">
            {past.map((t) => (
              <li key={t.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 font-medium text-ink">{t.instruction}</p>
                  <Chip tone={STATUS[t.status]?.tone}>{STATUS[t.status]?.label ?? t.status}</Chip>
                </div>
                <p className="text-sm text-muted">
                  {t.site} · {t.createdLabel}
                </p>
                {t.result && <p className="text-sm">{t.result}</p>}
                {t.hasScreenshot && (
                  <a
                    className="text-sm font-medium underline underline-offset-4"
                    href={`/api/tasks/${t.id}/screenshot`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    See the last screen
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || Boolean(current)}
          onClick={forgetDesktop}
        >
          Delete tasks desktop and its logins
        </Button>
      </div>
    </div>
  );
}

function ActiveTask({
  task,
  busy,
  onRespond,
}: {
  task: WebTaskView;
  busy: boolean;
  onRespond: (a: Action) => void;
}) {
  const [answer, setAnswer] = useState('');
  const p = task.pending;
  const shot = `/api/tasks/${task.id}/screenshot?v=${task.steps.length}-${task.status}`;
  return (
    <Card>
      <div className="flex flex-col gap-3" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[17px] font-semibold tracking-tight text-ink">On {task.site}</h2>
          <Chip tone={STATUS[task.status]?.tone}>{STATUS[task.status]?.label}</Chip>
        </div>
        <p>{task.instruction}</p>

        {p?.kind === 'click' && (
          <Banner tone="warn">
            Helm is ready to click <strong>“{p.label}”</strong> on <strong>{p.host}</strong>.
            Nothing has been clicked yet. Check the screen below first.
          </Banner>
        )}
        {p?.kind === 'site' && (
          <Banner tone="warn">
            This went to <strong>{p.host}</strong>, which isn’t the site you named. Should Helm
            continue there?
          </Banner>
        )}
        {p?.kind === 'login' && (
          <Banner tone="warn">
            {p.reason} Open your private desktop, do this step, and click Done there. Then come back
            and tap the button below. The link works until {p.expiresLabel}.
          </Banner>
        )}
        {p?.kind === 'question' && <Banner tone="warn">Helm asks: {p.question}</Banner>}

        {task.hasScreenshot && task.status !== 'running' && (
          <img
            src={shot}
            alt="The screen Helm is asking about"
            className="w-full rounded-xl border border-line"
          />
        )}

        {p?.kind === 'question' && (
          <Field label="Your answer" htmlFor="task-answer">
            <input
              id="task-answer"
              className={inputClass}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            />
          </Field>
        )}

        <div className="flex flex-wrap gap-2">
          {p?.kind === 'click' && (
            <Button disabled={busy} onClick={() => onRespond('approve')}>
              Yes, click it
            </Button>
          )}
          {p?.kind === 'site' && (
            <Button disabled={busy} onClick={() => onRespond('approve')}>
              Yes, continue there
            </Button>
          )}
          {p?.kind === 'login' && (
            <>
              <a href={p.url} target="_blank" rel="noreferrer" className={buttonClass('primary')}>
                Open my desktop
              </a>
              <Button variant="secondary" disabled={busy} onClick={() => onRespond('resume')}>
                I’m done, carry on
              </Button>
            </>
          )}
          {p?.kind === 'question' && (
            <Button
              disabled={busy || !answer.trim()}
              onClick={() => onRespond({ action: 'answer', text: answer })}
            >
              Send
            </Button>
          )}
          {(p?.kind === 'click' || p?.kind === 'site') && (
            <Button variant="secondary" disabled={busy} onClick={() => onRespond('takeover')}>
              I’ll do it myself
            </Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={() => onRespond('stop')}>
            {p?.kind === 'click' || p?.kind === 'site' ? 'No, stop' : 'Stop'}
          </Button>
        </div>

        <div>
          <h3 className="font-medium">What Helm has done</h3>
          <ol className="mt-1 flex flex-col gap-1 text-sm">
            {task.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
            {task.status === 'running' && <li className="text-muted">Working…</li>}
          </ol>
        </div>
      </div>
    </Card>
  );
}
