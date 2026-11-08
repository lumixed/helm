'use client';

import { useRef, useState } from 'react';
import { Button, Card, textareaClass } from './ui';

interface Msg {
  role: 'you' | 'helm';
  text: string;
  /** Which model answered, e.g. "gpt-5-mini via Maritime LLM". */
  meta?: string;
}
interface Token {
  token: string;
  agentId: string;
  expiresAt: string;
  apiUrl: string;
}

const SUGGESTIONS = [
  "What's due this week?",
  'What should I do first today?',
  "I'm sick today. What can wait?",
  'Remind me to pay rent on the 1st',
  "Remember that I don't work on Sundays",
  'What do you remember about me?',
  'Send me my brief',
];
const CONVERSATION = 'app';

/**
 * Chat with your private agent. Direct path: a 15-minute chat-only token, straight from this
 * browser to the agent on Maritime. If the browser can't reach Maritime (its address isn't
 * allowed for browsers yet), Helm relays the message with the same kind of token.
 */
export function ChatPanel({ name }: { name: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'direct' | 'relay' | null>(null);
  const token = useRef<Token | null>(null);

  async function getToken(): Promise<Token | null> {
    if (token.current && Date.parse(token.current.expiresAt) - Date.now() > 60_000)
      return token.current;
    const res = await fetch('/api/chat/token', { method: 'POST' });
    const out = (await res.json().catch(() => ({}))) as Partial<Token> & { mode?: string };
    if (!res.ok || out.mode !== 'direct' || !out.token) return null;
    token.current = out as Token;
    return token.current;
  }

  async function direct(message: string): Promise<string | null> {
    const t = await getToken();
    if (!t) return null;
    try {
      const res = await fetch(`${t.apiUrl}/api/agents/${encodeURIComponent(t.agentId)}/chat`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${t.token}`,
          'content-type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ message, conversation_id: CONVERSATION }),
      });
      if (res.status === 401 || res.status === 403) {
        token.current = null;
        return null;
      }
      const j = (await res.json()) as { response?: string | null };
      return j.response ?? null;
    } catch {
      // Blocked by the browser (CORS) or the network: use the relay from now on.
      return null;
    }
  }

  async function relay(message: string): Promise<string> {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, conversationId: CONVERSATION }),
    });
    const j = (await res.json().catch(() => ({}))) as { response?: string; error?: string };
    return j.response ?? j.error ?? 'Could not reach your agent.';
  }

  async function send(message: string) {
    const m = message.trim();
    if (!m || busy) return;
    setText('');
    setMsgs((x) => [...x, { role: 'you', text: m }]);
    setBusy(true);
    let answer: string | null = null;
    if (mode !== 'relay') {
      answer = await direct(m);
      if (answer !== null) setMode('direct');
    }
    if (answer === null) {
      setMode('relay');
      answer = await relay(m);
    }
    setMsgs((x) => [...x, { role: 'helm', text: answer! }]);
    setBusy(false);
    // Label the answer with the model that wrote it (from the agent's timeline event).
    const asked = Date.now() - 2000;
    for (let i = 0; i < 3; i++) {
      const r = await fetch('/api/chat/meta', { cache: 'no-store' }).catch(() => null);
      const j = r?.ok
        ? ((await r.json()) as {
            latest: { at: string; model: string | null; via: string | null } | null;
          })
        : null;
      if (j?.latest?.model && Date.parse(j.latest.at) >= asked - 60_000) {
        const label = `${j.latest.model} via ${j.latest.via}`;
        setMsgs((x) => {
          const copy = [...x];
          for (let k = copy.length - 1; k >= 0; k--)
            if (copy[k]!.role === 'helm') {
              copy[k] = { ...copy[k]!, meta: label };
              break;
            }
          return copy;
        });
        break;
      }
      await new Promise((res) => setTimeout(res, 1500));
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <ol aria-live="polite" className="flex flex-col gap-3">
        {msgs.length === 0 && (
          <li className="text-ink-soft">
            Hi{name ? ` ${name}` : ''}. Ask about your deadlines and what to do first, or tell me
            something to add, remind you of, or remember. I never send anything without you.
          </li>
        )}
        {msgs.map((m, i) => (
          <li
            key={i}
            className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${m.role === 'you' ? 'self-end bg-ink text-white' : 'self-start border border-line bg-canvas text-ink'}`}
          >
            <span className="sr-only">{m.role === 'you' ? 'You: ' : 'Helm: '}</span>
            {m.text}
            {m.meta && <span className="mt-1 block text-xs text-muted">{m.meta}</span>}
          </li>
        ))}
        {busy && (
          <li className="self-start text-sm text-muted" role="status">
            Your agent is thinking…
          </li>
        )}
      </ol>
      {msgs.length === 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Suggestions">
          {SUGGESTIONS.map((s) => (
            <Button
              key={s}
              variant="secondary"
              className="h-9! px-4! text-xs"
              onClick={() => send(s)}
            >
              {s}
            </Button>
          ))}
        </div>
      )}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <label htmlFor="chat-input" className="sr-only">
          Message to your agent
        </label>
        <textarea
          id="chat-input"
          rows={2}
          className={textareaClass}
          value={text}
          placeholder="Ask your agent…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(text);
            }
          }}
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted">
            {mode === 'direct'
              ? 'Straight to your private agent with a 15-minute key.'
              : mode === 'relay'
                ? 'Passed to your agent through Helm with a short-lived key; not stored.'
                : 'Only your agent can read this.'}
          </p>
          <Button type="submit" disabled={busy || !text.trim()}>
            Send
          </Button>
        </div>
      </form>
    </Card>
  );
}
