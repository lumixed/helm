import { randomUUID } from 'node:crypto';
import { encodeAgentMessage } from '@helm/shared';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { agentTransport } from '@/lib/agent-transport';
import { fail, json } from '@/lib/http';
import { recordSent } from '@/lib/maritime-webhooks';
import { egressAllowlist } from '@/lib/network';
import { currentUser } from '@/lib/session';
import { maritimeOrNull } from '@/lib/student';

export const dynamic = 'force-dynamic';

/** A real host that is NOT on the allowlist, so a block comes from the policy, not from DNS. */
const TARGET = 'https://example.com/exfiltrate';

/**
 * DEMO ONLY: red-team SIMULATION (PRD v2 WP-5). Asks the student's agent to try an outbound
 * request to a non-allowlisted host, and runs Maritime's own host-side network test for the
 * same host and for the backend. Both results are logged on the timeline.
 */
export async function POST(): Promise<Response> {
  if (process.env.DEMO_MODE !== 'true') return new Response('Not found', { status: 404 });
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  const db = await getDb();
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.userId, user.id));
  if (!agent?.maritimeAgentId) return fail(409, 'Your agent is still being set up.');

  const requestId = `redteam:${randomUUID()}`;
  const transport = agentTransport();
  await transport?.send(
    agent.maritimeAgentId,
    encodeAgentMessage({
      v: 1,
      type: 'redteam.egress',
      requestId,
      studentId: user.id,
      payload: { url: TARGET },
    }),
  );
  await recordSent(db, user.id, agent.maritimeAgentId, requestId, 'redteam.egress');

  const maritime = maritimeOrNull();
  const tests = [];
  if (maritime && agent.maritimeAgentId !== 'local') {
    const backendHost = process.env.APP_BASE_URL
      ? new URL(process.env.APP_BASE_URL).hostname
      : null;
    for (const dest of ['example.com:443', ...(backendHost ? [`${backendHost}:443`] : [])]) {
      try {
        const r = await maritime.testNetwork(agent.maritimeAgentId, dest);
        tests.push(r);
        await db.insert(schema.maritimeEvents).values({
          userId: user.id,
          maritimeAgentId: agent.maritimeAgentId,
          kind: 'helm.network_test',
          deliveryId: `nettest:${requestId}:${dest}`,
          payloadJson: {
            destination: dest,
            reached: r.reached,
            reason: r.reason,
            summary: r.reached
              ? `Maritime network test: ${dest} reachable`
              : `Maritime network test: ${dest} refused (${r.reason ?? 'blocked'})`,
          },
          occurredAt: new Date(),
        });
      } catch (err) {
        tests.push({ destination: dest, reached: null, reason: String(err).slice(0, 200) });
      }
    }
  }
  return json({ requestId, target: TARGET, allowlist: egressAllowlist(), tests }, 202);
}
