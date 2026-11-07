import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BriefContent } from '@helm/shared';
import { connect, schema, type Db } from '@/db';
import type { User } from '@/db/schema';
import { saveIntakeResult, confirmAssignments, listAssignments } from './assignments';
import { agentState, saveBrief, todaysBrief } from './briefs';

let db: Db;
let user: User;
beforeEach(async () => {
  db = await connect(undefined);
  [user] = (await db
    .insert(schema.users)
    .values({ email: 'b@x.edu', name: 'Maya', timezone: 'America/Los_Angeles' })
    .returning()) as [User];
});

const brief = (o: Partial<BriefContent> = {}): BriefContent => ({
  forDate: '2026-11-09',
  summary: 'Hi',
  focus: [],
  dueSoon: [],
  changes: [],
  capacity: 'c',
  trigger: 'manual',
  writer: 'template',
  ...o,
});

describe('agentState', () => {
  it('only includes confirmed, open assignments', async () => {
    await saveIntakeResult(db, user.id, 'i', [
      {
        courseCode: 'X 1',
        title: 'Keep',
        dueAt: '2026-11-20T00:00:00.000Z',
        dueTimeAssumed: false,
        weightPct: 10,
        type: 'assignment',
        allowedFileTypes: [],
        confidence: 0.9,
      },
      {
        courseCode: 'X 1',
        title: 'Unconfirmed',
        dueAt: '2026-11-21T00:00:00.000Z',
        dueTimeAssumed: false,
        weightPct: 10,
        type: 'assignment',
        allowedFileTypes: [],
        confidence: 0.9,
      },
      {
        courseCode: 'X 1',
        title: 'Done',
        dueAt: '2026-11-22T00:00:00.000Z',
        dueTimeAssumed: false,
        weightPct: 10,
        type: 'assignment',
        allowedFileTypes: [],
        confidence: 0.9,
      },
    ]);
    const rows = await listAssignments(db, user.id, 'UTC', { review: true });
    const id = (t: string) => rows.find((r) => r.title === t)!.id;
    await confirmAssignments(db, user.id, [id('Keep'), id('Done')], []);
    await db
      .update(schema.assignments)
      .set({ status: 'done' })
      .where(eq(schema.assignments.id, id('Done')));
    const s = await agentState(db, user);
    expect(s.assignments.map((a) => a.title)).toEqual(['Keep']);
    expect(s).toMatchObject({
      name: 'Maya',
      timezone: 'America/Los_Angeles',
      briefTimeLocal: '07:30',
    });
    expect(s.assignments[0]?.courseCode).toBe('X 1');
  });
});

describe('saveBrief / todaysBrief', () => {
  it('stores once per request and returns the local-today brief', async () => {
    expect(await saveBrief(db, user.id, 'r1', brief())).not.toBeNull();
    expect(await saveBrief(db, user.id, 'r1', brief({ summary: 'dup' }))).toBeNull();
    // 2026-11-10 02:00 UTC is still Nov 9 in Los Angeles.
    const b = await todaysBrief(db, user, new Date('2026-11-10T02:00:00Z'));
    expect(b?.summary).toBe('Hi');
    expect(await todaysBrief(db, user, new Date('2026-11-11T12:00:00Z'))).toBeNull();
  });
});
