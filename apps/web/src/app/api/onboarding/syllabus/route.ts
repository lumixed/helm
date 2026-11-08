import { randomUUID } from 'node:crypto';
import { encodeAgentMessage } from '@helm/shared';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { agentTransport } from '@/lib/agent-transport';
import { recordSent } from '@/lib/maritime-webhooks';
import { fail, json } from '@/lib/http';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(['pdf', 'docx', 'txt', 'md']);

/**
 * Upload a syllabus (file or pasted text). The file goes straight to the student's own agent;
 * the backend keeps no copy (PRD M3 and section 9). The agent reads it and reports back.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const db = await getDb();
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.userId, user.id));
  if (!agent?.maritimeAgentId)
    return fail(409, 'Your agent is still being set up. Try again in a minute.');
  const transport = agentTransport();
  if (!transport) return fail(503, 'Agents are not configured on this server.');

  let bytes: Uint8Array;
  let fileName: string;
  let courseHint: string | undefined;
  const type = req.headers.get('content-type') ?? '';
  if (type.startsWith('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return fail(400, 'Choose a file to upload.');
    if (file.size === 0) return fail(400, 'That file is empty.');
    if (file.size > MAX_BYTES) return fail(413, 'That file is larger than 10 MB.');
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED.has(ext)) return fail(415, 'Helm can read PDF, DOCX and TXT files.');
    bytes = new Uint8Array(await file.arrayBuffer());
    fileName = file.name;
    courseHint =
      String(form.get('courseHint') ?? '')
        .trim()
        .slice(0, 100) || undefined;
  } else {
    const body = (await req.json().catch(() => null)) as {
      text?: unknown;
      courseHint?: unknown;
    } | null;
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (text.length < 40) return fail(400, 'Paste the full text (at least a few lines).');
    if (text.length > 200_000) return fail(413, 'That text is too long.');
    bytes = new TextEncoder().encode(text);
    fileName = 'pasted-text.txt';
    courseHint =
      typeof body?.courseHint === 'string'
        ? body.courseHint.trim().slice(0, 100) || undefined
        : undefined;
  }

  const intakeId = randomUUID();
  const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
  const agentPath = `/data/inbox/syllabi/${intakeId}-${safe}`;
  try {
    await transport.putFile(agent.maritimeAgentId, agentPath, bytes);
    await transport.send(
      agent.maritimeAgentId,
      encodeAgentMessage({
        v: 1,
        type: 'intake.parse',
        requestId: `intake:${intakeId}`,
        studentId: user.id,
        payload: { intakeId, filePath: agentPath, fileName, ...(courseHint ? { courseHint } : {}) },
      }),
    );
  } catch (err) {
    console.error('[syllabus] hand-off to agent failed', err);
    return fail(502, 'Could not reach your agent. Try again in a moment.');
  }
  await recordSent(db, user.id, agent.maritimeAgentId, `intake:${intakeId}`, 'intake.parse');
  return json({ intakeId, fileName }, 202);
}
