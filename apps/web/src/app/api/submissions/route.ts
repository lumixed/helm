import { MAX_SUBMISSION_BYTES, localToUtc } from '@helm/shared';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { agentTransport } from '@/lib/agent-transport';
import { fail, json } from '@/lib/http';
import { currentUser } from '@/lib/session';
import {
  SubmissionError,
  createSubmission,
  listSubmissions,
  tick,
  tickDepsFor,
} from '@/lib/submissions';

export const dynamic = 'force-dynamic';

/** The student's submission queue. Also advances the scheduler for them (open page = precise). */
export async function GET(): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const db = await getDb();
  await tick(db, tickDepsFor(db, agentTransport()), user.id).catch((err: unknown) =>
    console.error('[scheduler] tick failed', err),
  );
  return json({ submissions: await listSubmissions(db, user) });
}

/**
 * Upload finished homework (multipart: file, assignmentId, submitAt?). The file goes to the
 * student's own agent; checks run now and again before submitting.
 */
export async function POST(req: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const db = await getDb();
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.userId, user.id));
  if (!agent?.maritimeAgentId) return fail(409, 'Your agent is still being set up.');
  const transport = agentTransport();
  if (!transport) return fail(503, 'Agents are not configured on this server.');
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, 'Expected a file upload.');
  }
  const file = form.get('file');
  if (!(file instanceof File)) return fail(400, 'Choose your finished file.');
  if (file.size > MAX_SUBMISSION_BYTES)
    return fail(413, `Files up to ${MAX_SUBMISSION_BYTES / 1048576} MB for now.`);
  const rawAt = String(form.get('submitAt') ?? '');
  let submitAt: Date | null = null;
  if (rawAt === 'demo-90s' && process.env.DEMO_MODE === 'true')
    submitAt = new Date(Date.now() + 90_000);
  else if (rawAt && rawAt !== 'default') {
    // Local wall time in the student's timezone ("2026-11-12T15:00"), converted here.
    try {
      submitAt = localToUtc(rawAt, user.timezone);
    } catch {
      return fail(400, 'Invalid submit time.');
    }
  }
  try {
    const s = await createSubmission(db, user, agent.maritimeAgentId, transport, {
      assignmentId: String(form.get('assignmentId') ?? ''),
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      submitAt,
    });
    return json({ id: s.id, status: s.status }, 201);
  } catch (err) {
    if (err instanceof SubmissionError) return fail(err.status, err.message);
    console.error('[submissions] upload failed', err);
    return fail(502, 'Could not hand the file to your agent. Try again.');
  }
}
