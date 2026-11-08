import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BriefContent } from '@helm/shared';
import { connect, schema, type Db } from '@/db';
import type { User } from '@/db/schema';
import type { AgentTransport } from './agent-transport';
import { saveBrief } from './briefs';
import { addBlocksResult, requestAddBlocks } from './calendar-blocks';

const now = new Date('2026-11-09T20:00:00Z'); // 12:00 in Vancouver
const blocks = [
  {
    assignmentId: 'a1',
    title: 'Over',
    start: '2026-11-09T17:00:00.000Z',
    end: '2026-11-09T18:00:00.000Z',
  },
  {
    assignmentId: 'a2',
    title: 'Ahead',
    start: '2026-11-09T21:00:00.000Z',
    end: '2026-11-09T22:00:00.000Z',
  },
];
const brief = (b = blocks): BriefContent => ({
  forDate: '2026-11-09',
  summary: 'Hi',
  focus: [],
  dueSoon: [],
  changes: [],
  schedule: [],
  blocks: b,
  unplannedMinutes: 0,
  money: null,
  capacity: 'c',
  trigger: 'manual',
  writer: 'template',
});

let db: Db;
let user: User;
let sent: string[];
const transport = {
  send: async (_id: string, m: string) => {
    sent.push(m);
  },
} as unknown as AgentTransport;

beforeEach(async () => {
  db = await connect(undefined);
  sent = [];
  [user] = (await db
    .insert(schema.users)
    .values({
      email: 'c@x.edu',
      name: 'Maya',
      timezone: 'America/Vancouver',
      gmailAddress: 'c@x.edu',
    })
    .returning()) as [User];
  await db
    .insert(schema.agents)
    .values({ userId: user.id, agentTokenHash: 'h', maritimeAgentId: 'ag1', status: 'ready' });
});

describe('requestAddBlocks', () => {
  it('sends only today’s blocks still ahead to the person’s agent', async () => {
    await saveBrief(db, user.id, 'r1', brief());
    const r = await requestAddBlocks(db, user, transport, now);
    expect(r).toMatchObject({ count: 1 });
    expect(JSON.parse(sent[0]!)).toMatchObject({
      type: 'calendar.add_blocks',
      payload: { forDate: '2026-11-09', blocks: [{ title: 'Ahead' }] },
    });
  });

  it('refuses when Google is not connected or nothing is left', async () => {
    await saveBrief(db, user.id, 'r1', brief([blocks[0]!]));
    expect(await requestAddBlocks(db, user, transport, now)).toMatchObject({ status: 409 });
    const [noGoogle] = (await db
      .update(schema.users)
      .set({ gmailAddress: null })
      .where(eq(schema.users.id, user.id))
      .returning()) as [User];
    expect(await requestAddBlocks(db, noGoogle, transport, now)).toMatchObject({
      error: expect.stringMatching(/Connect Google/),
    });
    expect(sent).toHaveLength(0);
  });
});

describe('addBlocksResult', () => {
  const record = (u: string, type: 'calendar.blocks_added' | 'agent.error', reason: string) =>
    db.insert(schema.agentEvents).values({
      userId: u,
      eventId: `e-${type}`,
      requestId: 'calendar:blocks:1',
      type,
      reason,
      occurredAt: now,
    });

  it('is pending until the agent reports, then gives its answer', async () => {
    expect(await addBlocksResult(db, user, 'calendar:blocks:1')).toEqual({ done: false });
    await record(user.id, 'calendar.blocks_added', 'Added 2 work blocks');
    expect(await addBlocksResult(db, user, 'calendar:blocks:1')).toEqual({
      done: true,
      ok: true,
      message: 'Added 2 work blocks',
    });
  });

  it('never shows another person’s result', async () => {
    const [other] = (await db
      .insert(schema.users)
      .values({ email: 'o@x.edu', name: 'O', timezone: 'UTC' })
      .returning()) as [User];
    await record(other.id, 'agent.error', 'secret');
    expect(await addBlocksResult(db, user, 'calendar:blocks:1')).toEqual({ done: false });
  });
});
