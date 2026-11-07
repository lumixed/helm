import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { AgentEvent, type AgentEventInput, type AgentEventsRequest } from '@helm/shared';
import { config, paths } from './config';

/**
 * Sends timeline events to the backend. If the backend is unreachable, events are queued on
 * /data and retried on the next wake, so nothing is lost while the VM sleeps (PRD section 7).
 */
export class Emitter {
  constructor(
    private readonly opts = {
      backendUrl: config.backendUrl,
      token: config.agentToken,
      studentId: config.studentId,
      outbox: paths.outbox,
      fetch: globalThis.fetch,
    },
  ) {}

  get configured(): boolean {
    return Boolean(this.opts.backendUrl && this.opts.token && this.opts.studentId);
  }

  event(
    input: Omit<AgentEventInput, 'eventId' | 'occurredAt'> & Partial<AgentEventInput>,
  ): AgentEvent {
    return AgentEvent.parse({
      eventId: input.eventId ?? randomUUID(),
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      ...input,
    });
  }

  /** Queue then flush. Never throws: failures stay in the outbox. */
  async emit(...events: AgentEvent[]): Promise<{ delivered: number; queued: number }> {
    for (const e of events) console.log(`[event] ${e.type} ${e.reason}`);
    this.append(events);
    await this.flush();
    // Another flush may have delivered them first, so count by what is still queued.
    const still = new Set(this.read().map((e) => e.eventId));
    const queued = events.filter((e) => still.has(e.eventId)).length;
    return { delivered: events.length - queued, queued };
  }

  /** Flushes are serialized so two wakes never send the same queued event twice. */
  flush(): Promise<{ sent: number; queued: number }> {
    const run = this.flushing.then(() => this.flushOnce());
    this.flushing = run.catch(() => undefined);
    return run;
  }

  private flushing: Promise<unknown> = Promise.resolve();

  private async flushOnce(): Promise<{ sent: number; queued: number }> {
    const pending = this.read();
    if (pending.length === 0) return { sent: 0, queued: 0 };
    if (!this.configured) return { sent: 0, queued: pending.length };

    let sent = 0;
    for (let i = 0; i < pending.length; i += 100) {
      const batch = pending.slice(i, i + 100);
      const body: AgentEventsRequest = { studentId: this.opts.studentId, events: batch };
      try {
        const res = await this.opts.fetch(`${this.opts.backendUrl}/api/agent/events`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.opts.token}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(8000),
        });
        // 4xx other than 429 will never succeed; drop it so one bad event can't block the queue.
        if (!res.ok && (res.status === 429 || res.status >= 500)) break;
        if (!res.ok)
          console.error(`[emit] backend rejected batch: ${res.status} ${await res.text()}`);
        sent += batch.length;
      } catch (err) {
        console.error(
          `[emit] backend unreachable, keeping ${pending.length - sent} queued:`,
          String(err),
        );
        break;
      }
    }
    this.write(pending.slice(sent));
    return { sent, queued: pending.length - sent };
  }

  private append(events: AgentEvent[]) {
    fs.appendFileSync(this.opts.outbox, events.map((e) => JSON.stringify(e) + '\n').join(''));
  }

  private read(): AgentEvent[] {
    let text: string;
    try {
      text = fs.readFileSync(this.opts.outbox, 'utf8');
    } catch {
      return [];
    }
    const out: AgentEvent[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = AgentEvent.safeParse(JSON.parse(line));
        if (parsed.success) out.push(parsed.data);
      } catch {
        /* skip a torn line */
      }
    }
    return out;
  }

  private write(events: AgentEvent[]) {
    const tmp = `${this.opts.outbox}.tmp`;
    fs.writeFileSync(tmp, events.map((e) => JSON.stringify(e) + '\n').join(''));
    fs.renameSync(tmp, this.opts.outbox);
  }
}
