import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { agentTransport } from '@/lib/agent-transport';
import { connectGmail, verifyState } from '@/lib/gmail';
import { currentUser } from '@/lib/session';
import { maritimeOrNull } from '@/lib/student';

export const dynamic = 'force-dynamic';

/** Google → Helm. Checks the signed state belongs to the signed-in user, then connects. */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const back = (q: string) => Response.redirect(new URL(`/setup?gmail=${q}`, url), 302);
  const user = await currentUser();
  const stateUser = verifyState(url.searchParams.get('state') ?? '');
  if (!user || !stateUser || stateUser !== user.id) return back('error');
  if (url.searchParams.get('error')) return back('cancelled');
  const code = url.searchParams.get('code');
  if (!code) return back('error');
  const db = await getDb();
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.userId, user.id));
  const maritime = maritimeOrNull();
  const transport = agentTransport();
  if (!agent || !maritime || !transport) return back('error');
  try {
    await connectGmail(db, user, agent, maritime, transport, code);
    return back('connected');
  } catch (err) {
    console.error('[gmail] connect failed', String(err).slice(0, 300));
    return back('error');
  }
}
