import { z } from 'zod';
import { getDb } from '@/db';
import { agentTransport } from '@/lib/agent-transport';
import { fail, json } from '@/lib/http';
import { currentUser } from '@/lib/session';
import {
  SubmissionError,
  cancelSubmission,
  holdSubmission,
  releaseSubmission,
  scheduleSubmission,
  submitNow,
  tick,
  tickDepsFor,
} from '@/lib/submissions';

export const dynamic = 'force-dynamic';

const Body = z.object({ ackWarnings: z.boolean().default(false) }).default({ ackWarnings: false });

/** State changes the student makes (PRD 10): schedule (consent), hold, release, cancel, submit-now. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const { id, action } = await ctx.params;
  const body = Body.parse(await req.json().catch(() => ({})));
  const db = await getDb();
  try {
    let row;
    switch (action) {
      case 'schedule':
        row = await scheduleSubmission(db, user.id, id, body);
        break;
      case 'hold':
        row = await holdSubmission(db, user.id, id);
        break;
      case 'release':
        row = await releaseSubmission(db, user.id, id);
        break;
      case 'cancel':
        row = await cancelSubmission(db, user.id, id);
        break;
      case 'submit-now':
        row = await submitNow(db, user.id, id);
        break;
      default:
        return fail(404, 'Unknown action');
    }
    // Act right away (e.g. a hold notice that is already due, or Submit now).
    await tick(db, tickDepsFor(db, agentTransport()), user.id).catch(() => {});
    return json({ id: row.id, status: row.status });
  } catch (err) {
    if (err instanceof SubmissionError) return fail(err.status, err.message);
    throw err;
  }
}
