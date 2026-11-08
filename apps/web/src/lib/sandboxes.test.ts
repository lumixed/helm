import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { connect, schema, type Db } from '@/db';
import type { User } from '@/db/schema';
import { endSandbox, leaseSandbox, type SandboxClient } from './sandboxes';

let db: Db;
let maya: User;
let other: User;
let log: string[];
const client: SandboxClient = {
  create: async (name) => {
    log.push(`create ${name.split('-').slice(0, 2).join('-')}`);
    return { id: 'sbx-1', dataPlaneUrl: 'https://api-sbx-1.h2.sb.mtm.sh/v1', secret: 's' };
  },
  end: async (id) => {
    log.push(`end ${id}`);
  },
};

beforeEach(async () => {
  log = [];
  db = await connect(undefined);
  [maya, other] = (await db
    .insert(schema.users)
    .values([{ email: 'm@x.edu' }, { email: 'o@x.edu' }])
    .returning()) as [User, User];
});

describe('sandboxes', () => {
  it('leases a sandbox for one person, then ends it and logs both on the timeline', async () => {
    const lease = await leaseSandbox(db, maya.id, client, 'parse_document', 'syllabus.pdf');
    expect(lease).toEqual({ sandboxId: 'sbx-1', dataPlaneUrl: expect.any(String), secret: 's' });
    expect(
      await endSandbox(db, maya.id, 'sbx-1', client, {
        ok: true,
        summary: 'PDF, 1,234 characters, 1.2 s',
      }),
    ).toBe(true);
    expect(log).toEqual(['create helm-parse', 'end sbx-1']);
    const [run] = await db.select().from(schema.sandboxRuns);
    expect(run).toMatchObject({ status: 'ended', resultSummary: 'PDF, 1,234 characters, 1.2 s' });
    const types = (
      await db.select().from(schema.agentEvents).where(eq(schema.agentEvents.userId, maya.id))
    ).map((e) => e.type);
    expect(types.sort()).toEqual(['sandbox.created', 'sandbox.ended']);
  });

  it("won't end someone else's sandbox", async () => {
    await leaseSandbox(db, maya.id, client, 'parse_document', 'a.pdf');
    expect(await endSandbox(db, other.id, 'sbx-1', client, { ok: true, summary: 'x' })).toBe(false);
    expect(log).toEqual(['create helm-parse']);
  });

  it('is safe to end twice (one timeline entry)', async () => {
    await leaseSandbox(db, maya.id, client, 'parse_document', 'a.pdf');
    await endSandbox(db, maya.id, 'sbx-1', client, { ok: false, summary: 'pdf rejected' });
    await endSandbox(db, maya.id, 'sbx-1', client, { ok: false, summary: 'pdf rejected' });
    const ended = await db
      .select()
      .from(schema.agentEvents)
      .where(eq(schema.agentEvents.type, 'sandbox.ended'));
    expect(ended).toHaveLength(1);
    expect((await db.select().from(schema.sandboxRuns))[0]!.status).toBe('failed');
  });
});
