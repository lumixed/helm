import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { calendarItems, parseIcs, type CalendarItem } from '@helm/shared';
import { connect, schema, type Db } from '@/db';
import type { AgentRow, User } from '@/db/schema';
import type { AgentTransport } from './agent-transport';
import { confirmAssignments, listAssignments } from './assignments';
import {
  connectCalendar,
  demoFeedIcs,
  demoFeedToken,
  saveCalendarResult,
  verifyDemoFeedToken,
} from './calendar';
import type { MaritimeClient } from './maritime';
import { createSubmission, scheduleSubmission } from './submissions';

process.env.AUTH_SECRET ??= 'test-secret-test-secret-123';
process.env.DEMO_MODE = 'false';

let db: Db;
let maya: User;
const now = new Date('2026-11-08T18:00:00Z');
const item = (o: Partial<CalendarItem> = {}): CalendarItem => ({
  uid: 'event-assignment-101',
  courseCode: 'DATA 210',
  title: 'Assignment 5',
  dueAt: '2026-11-14T06:59:00.000Z',
  dueTimeAssumed: false,
  type: 'assignment',
  ...o,
});

beforeEach(async () => {
  db = await connect(undefined);
  [maya] = (await db
    .insert(schema.users)
    .values({ email: 'm@x.edu', timezone: 'America/Vancouver' })
    .returning()) as [User];
});

describe('saveCalendarResult', () => {
  it('sends new items to review, and a repeat sync changes nothing', async () => {
    expect(await saveCalendarResult(db, maya, [item()], now)).toEqual({
      added: 1,
      moved: 0,
      unchanged: 0,
    });
    const [row] = await listAssignments(db, maya.id, maya.timezone, { review: true });
    expect(row).toMatchObject({
      title: 'Assignment 5',
      courseCode: 'DATA 210',
      source: 'ics',
      confirmed: false,
    });
    expect(await saveCalendarResult(db, maya, [item()], now)).toEqual({
      added: 0,
      moved: 0,
      unchanged: 1,
    });
    expect(await listAssignments(db, maya.id, maya.timezone)).toHaveLength(1);
  });

  it('applies a Canvas date move to a confirmed item, with provenance, and the hand-in follows', async () => {
    await saveCalendarResult(db, maya, [item()], now);
    const [row] = await listAssignments(db, maya.id, maya.timezone, { review: true });
    await confirmAssignments(db, maya.id, [row!.id], []);
    const transport: AgentTransport = {
      kind: 'local',
      putFile: async () => {},
      send: async () => {},
    };
    const s = await createSubmission(
      db,
      maya,
      'agent-1',
      transport,
      { assignmentId: row!.id, fileName: 'A5_Maya.pdf', bytes: new TextEncoder().encode('%PDF x') },
      now,
    );
    await scheduleSubmission(db, maya.id, s.id, { ackWarnings: true }, now);

    const r = await saveCalendarResult(
      db,
      maya,
      [item({ dueAt: '2026-11-16T06:59:00.000Z' })],
      now,
    );
    expect(r).toEqual({ added: 0, moved: 1, unchanged: 0 });
    const [a] = await db
      .select()
      .from(schema.assignments)
      .where(eq(schema.assignments.id, row!.id));
    expect(a!.dueAt?.toISOString()).toBe('2026-11-16T06:59:00.000Z');
    const [c] = await db.select().from(schema.assignmentChanges);
    expect(c).toMatchObject({ source: 'Canvas calendar', status: 'applied', field: 'due_at' });
    const [sub] = await db.select().from(schema.submissions).where(eq(schema.submissions.id, s.id));
    expect(sub!.submitAt?.toISOString()).toBe('2026-11-16T04:59:00.000Z'); // still 2 h before
  });
});

describe('connectCalendar', () => {
  it('puts the feed link only in the agent env (encrypted), and keeps just the host', async () => {
    process.env.APP_BASE_URL = 'https://helm.test';
    const [agent] = (await db
      .insert(schema.agents)
      .values({ userId: maya.id, agentTokenHash: 'h', maritimeAgentId: 'mt_1', status: 'ready' })
      .returning()) as [AgentRow];
    const env = new Map<string, { v: string; secret: boolean }>();
    const maritime = {
      setEnv: async (_id: string, k: string, v: string, secret: boolean) => {
        env.set(k, { v, secret });
      },
      reloadEnv: async () => {},
    } as unknown as MaritimeClient;
    const sent: string[] = [];
    const transport: AgentTransport = {
      kind: 'maritime',
      putFile: async () => {},
      send: async (_a, m) => {
        sent.push(m);
      },
    };
    const url = 'https://demo-school.instructure.com/feeds/calendars/user_SECRETTOKEN.ics';
    await connectCalendar(db, maya, agent, maritime, transport, url);
    expect(env.get('CANVAS_ICS_URL')).toEqual({ v: url, secret: true });
    expect(JSON.parse(sent[0]!)).toMatchObject({
      type: 'calendar.sync',
      payload: { reason: 'connected' },
    });
    expect(sent[0]).not.toContain('SECRETTOKEN'); // the link never travels in a message
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, maya.id));
    expect(u!.calendarHost).toBe('demo-school.instructure.com');
    expect(JSON.stringify(u)).not.toContain('SECRETTOKEN');
    await expect(
      connectCalendar(db, maya, agent, maritime, transport, 'https://evil.example/feed.ics'),
    ).rejects.toThrow(/Canvas calendar feed/);
    delete process.env.APP_BASE_URL;
  });
});

describe('demo feed', () => {
  it('has an unguessable per-person link and parses like a Canvas feed', () => {
    const t = demoFeedToken(maya.id);
    expect(verifyDemoFeedToken(t)).toBe(maya.id);
    expect(verifyDemoFeedToken(`${t.slice(0, -1)}${t.endsWith('A') ? 'B' : 'A'}`)).toBeNull();
    const items = calendarItems(
      parseIcs(demoFeedIcs(maya.id, now), maya.timezone),
      maya.timezone,
      now,
    );
    expect(items.map((i) => [i.courseCode, i.type])).toEqual([
      ['DEMO 101', 'assignment'],
      ['DEMO 101', 'assignment'],
      ['DEMO 101', 'quiz'],
      ['DEMO 101', 'assignment'],
    ]);
  });
});
