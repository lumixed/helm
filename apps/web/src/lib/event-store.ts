import type { AgentEvent } from '@helm/shared';

export interface StoredEvent extends AgentEvent {
  studentId: string;
  receivedAt: string;
}

/**
 * Phase 0 in-memory store (one process only). Phase 1 moves this to Postgres `agent_events`
 * with a unique (user_id, request_id/event_id) constraint.
 */
class MemoryEventStore {
  private events: StoredEvent[] = [];
  private keys = new Set<string>();

  add(studentId: string, events: AgentEvent[]): { accepted: number; duplicates: number } {
    let accepted = 0;
    let duplicates = 0;
    for (const e of events) {
      const key = `${studentId}:${e.eventId}`;
      if (this.keys.has(key)) {
        duplicates++;
        continue;
      }
      this.keys.add(key);
      this.events.push({ ...e, studentId, receivedAt: new Date().toISOString() });
      accepted++;
    }
    if (this.events.length > 5000) this.events.splice(0, this.events.length - 5000);
    return { accepted, duplicates };
  }

  list(studentId?: string, limit = 200): StoredEvent[] {
    const all = studentId ? this.events.filter((e) => e.studentId === studentId) : this.events;
    return all.slice(-limit).reverse();
  }
}

const g = globalThis as unknown as { __helmEvents?: MemoryEventStore };
export const eventStore = (g.__helmEvents ??= new MemoryEventStore());
