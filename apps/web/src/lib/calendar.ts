import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  encodeAgentMessage,
  isCalendarFeedUrl,
  type CalendarItem,
  type CalendarResultResponse,
} from '@helm/shared';
import type { Db } from '@/db';
import { schema } from '@/db';
import type { AgentRow, User } from '@/db/schema';
import type { AgentTransport } from './agent-transport';
import { normalizeCourseCode, saveIntakeResult } from './assignments';
import { formatWhen } from './format';
import type { MaritimeClient } from './maritime';
import { recordSent } from './maritime-webhooks';
import { onAssignmentDueChanged } from './submissions';
import { sendToUser } from './telegram';

/**
 * Canvas calendar import (PRD S3). The feed link is a secret (anyone with it can read the
 * calendar), so it goes only into the person's agent as an encrypted Maritime env var; the backend
 * keeps the host name. The agent fetches the feed and reports deadlines here.
 */
export const CALENDAR_ENV = 'CANVAS_ICS_URL';

const appHost = () => {
  try {
    return process.env.APP_BASE_URL ? new URL(process.env.APP_BASE_URL).hostname : null;
  } catch {
    return null;
  }
};

export function acceptableFeed(url: string) {
  const host = appHost();
  return isCalendarFeedUrl(url, [
    ...(host ? [host] : []),
    ...(process.env.VERCEL ? [] : ['127.0.0.1']),
  ]);
}

const isLocal = (agent: AgentRow) => agent.maritimeAgentId === 'local';

/** Connect a feed: into the agent's encrypted env (local dev: kept server-side), then sync. */
export async function connectCalendar(
  db: Db,
  user: User,
  agent: AgentRow,
  maritime: MaritimeClient | null,
  transport: AgentTransport,
  url: string,
) {
  if (!acceptableFeed(url))
    throw new CalendarError('Paste your Canvas calendar feed link (it ends in .ics).');
  if (!agent.maritimeAgentId) throw new CalendarError('Your agent is still being set up.');
  if (isLocal(agent)) {
    // Development only: there is no Maritime env on this machine.
    await db
      .insert(schema.appSecrets)
      .values({ key: `calendar:${user.id}`, value: url })
      .onConflictDoUpdate({ target: schema.appSecrets.key, set: { value: url } });
  } else {
    if (!maritime) throw new CalendarError('Agents are not configured on this server.');
    await maritime.setEnv(agent.maritimeAgentId, CALENDAR_ENV, url, true);
    await maritime.reloadEnv(agent.maritimeAgentId);
  }
  await db
    .update(schema.users)
    .set({ calendarHost: new URL(url).hostname, calendarConnectedAt: new Date() })
    .where(eq(schema.users.id, user.id));
  await requestCalendarSync(db, user, agent, transport, 'connected');
}

export async function requestCalendarSync(
  db: Db,
  user: User,
  agent: AgentRow,
  transport: AgentTransport,
  reason: 'connected' | 'manual',
) {
  let feedUrl: string | undefined;
  if (isLocal(agent)) {
    const [s] = await db
      .select()
      .from(schema.appSecrets)
      .where(eq(schema.appSecrets.key, `calendar:${user.id}`));
    feedUrl = s?.value;
  }
  const requestId = `calendar:${reason}:${Date.now()}`;
  await transport.send(
    agent.maritimeAgentId!,
    encodeAgentMessage({
      v: 1,
      type: 'calendar.sync',
      requestId,
      studentId: user.id,
      payload: { reason, ...(feedUrl ? { feedUrl } : {}) },
    }),
  );
  await recordSent(db, user.id, agent.maritimeAgentId!, requestId, 'calendar.sync');
  return requestId;
}

export async function disconnectCalendar(
  db: Db,
  user: User,
  agent: AgentRow | null,
  maritime: MaritimeClient | null,
) {
  if (agent?.maritimeAgentId && !isLocal(agent) && maritime) {
    await maritime.deleteEnv(agent.maritimeAgentId, CALENDAR_ENV).catch(() => {});
    await maritime.reloadEnv(agent.maritimeAgentId).catch(() => {});
  }
  await db.delete(schema.appSecrets).where(eq(schema.appSecrets.key, `calendar:${user.id}`));
  await db
    .update(schema.users)
    .set({ calendarHost: null, calendarConnectedAt: null, calendarSyncedAt: null })
    .where(eq(schema.users.id, user.id));
}

export class CalendarError extends Error {}

/**
 * Agent → backend: deadlines in the feed. Matched by event UID: new ones go to review
 * (unconfirmed), a confirmed one whose due time changed is updated with "Canvas calendar" as the
 * source (and its scheduled hand-in follows), unconfirmed ones are refreshed in place.
 */
export async function saveCalendarResult(
  db: Db,
  user: User,
  items: CalendarItem[],
  now = new Date(),
): Promise<CalendarResultResponse> {
  const r = { added: 0, moved: 0, unchanged: 0 };
  for (const it of items) {
    const ref = `ics:${it.uid}`;
    const [row] = await db
      .select()
      .from(schema.assignments)
      .where(and(eq(schema.assignments.userId, user.id), eq(schema.assignments.sourceRef, ref)));
    const due = new Date(it.dueAt);
    if (!row) {
      await saveIntakeResult(
        db,
        user.id,
        ref,
        [
          {
            courseCode: normalizeCourseCode(it.courseCode),
            title: it.title,
            dueAt: it.dueAt,
            dueTimeAssumed: it.dueTimeAssumed,
            assumption: it.dueTimeAssumed
              ? 'Canvas gave a day but no time; assumed 11:59 pm.'
              : 'From your Canvas calendar.',
            weightPct: null,
            type: it.type,
            allowedFileTypes: [],
            confidence: it.dueTimeAssumed ? 0.8 : 0.95,
          },
        ],
        'ics',
      );
      r.added++;
      continue;
    }
    const same = row.dueAt && Math.abs(row.dueAt.getTime() - due.getTime()) < 60_000;
    if (same) {
      r.unchanged++;
      continue;
    }
    if (!row.confirmed) {
      await db
        .update(schema.assignments)
        .set({ dueAt: due, title: it.title })
        .where(eq(schema.assignments.id, row.id));
      r.unchanged++;
      continue;
    }
    // A confirmed deadline moved in Canvas: apply it, with provenance, and let hand-ins follow.
    await db.insert(schema.assignmentChanges).values({
      userId: user.id,
      assignmentId: row.id,
      kind: 'deadline_changed',
      field: 'due_at',
      oldValue: row.dueAt?.toISOString() ?? null,
      newValue: due.toISOString(),
      source: 'Canvas calendar',
      evidence: it.url ?? null,
      confidence: 1,
      applied: true,
      status: 'applied',
      reason: 'Canvas calendar changed it.',
      decidedAt: now,
    });
    await db
      .update(schema.assignments)
      .set({ dueAt: due, version: row.version + 1 })
      .where(eq(schema.assignments.id, row.id));
    await onAssignmentDueChanged(db, user.id, row.id, due, now);
    await sendToUser(
      db,
      user.id,
      `Canvas moved "${row.title}" to ${formatWhen(due, user.timezone)}. Helm updated your plan.`,
    );
    r.moved++;
  }
  await db.update(schema.users).set({ calendarSyncedAt: now }).where(eq(schema.users.id, user.id));
  return r;
}

/** Demo portal calendar feed: an unguessable per-person link, like Canvas's. */
function feedKey(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error('AUTH_SECRET must be set (16+ chars)');
  return createHmac('sha256', s).update('helm-demo-portal:feed').digest('base64url');
}
export const demoFeedToken = (userId: string) =>
  `${userId.replace(/-/g, '')}${createHmac('sha256', feedKey()).update(userId).digest('base64url').slice(0, 24)}`;

export function verifyDemoFeedToken(token: string): string | null {
  const m = /^([0-9a-f]{32})([A-Za-z0-9_-]{24})$/.exec(token);
  if (!m) return null;
  const h = m[1]!;
  const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  const want = Buffer.from(demoFeedToken(id).slice(32));
  const got = Buffer.from(m[2]!);
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}

/** A Canvas-shaped feed for the demo course, with dates relative to today. */
export function demoFeedIcs(userId: string, now = new Date()): string {
  const day = (n: number, hh: number, mm: number) => {
    const d = new Date(now.getTime() + n * 86_400_000);
    d.setUTCHours(hh, mm, 0, 0);
    return d
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
  };
  const date = (n: number) =>
    new Date(now.getTime() + n * 86_400_000).toISOString().slice(0, 10).replace(/-/g, '');
  const ev = (uid: string, start: string, summary: string, allDay = false) =>
    [
      'BEGIN:VEVENT',
      `UID:${uid}`,
      allDay ? `DTSTART;VALUE=DATE:${start}` : `DTSTART:${start}`,
      `SUMMARY:${summary}`,
      `URL;VALUE=URI:${process.env.APP_BASE_URL ?? ''}/mock-portal`,
      'END:VEVENT',
    ].join('\r\n');
  const u = userId.slice(0, 8);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Helm//Demo portal feed//EN',
    'X-WR-CALNAME:Demo portal (Helm demo)',
    ev(`event-assignment-demo-${u}-1`, day(1, 6, 59), 'Reading response 3 [DEMO 101]'),
    ev(`event-assignment-demo-${u}-2`, day(3, 6, 59), 'Lab report 2 [DEMO 101]'),
    ev(`event-assignment-demo-${u}-3`, date(5), 'Quiz 4 [DEMO 101]', true),
    ev(`event-assignment-demo-${u}-4`, day(10, 6, 59), 'Project milestone 1 [DEMO 101]'),
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
