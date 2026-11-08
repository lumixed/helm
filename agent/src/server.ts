import { Hono } from 'hono';
import {
  MaritimeChatBody,
  parseInbound,
  dailyCron,
  encodeAgentMessage,
  type ScheduleEntry,
} from '@helm/shared';
import { config, runtime } from './config';
import { Emitter } from './emit';
import { Dedupe } from './dedupe';
import { handleChat, handleMessage, type HandlerDeps } from './handlers';

export function buildSchedules(): ScheduleEntry[] {
  const rt = runtime();
  // Without a student there is nobody to brief; publish nothing rather than a broken schedule.
  if (!rt.studentId) return [];
  const studentId = rt.studentId;
  return [
    {
      id: 'morning-brief',
      cron: dailyCron(rt.briefTime),
      tz: rt.timezone,
      prompt: encodeAgentMessage({
        v: 1,
        type: 'brief.generate',
        requestId: 'cron:brief',
        studentId,
        payload: { trigger: 'cron' },
      }),
      enabled: true,
    },
    {
      id: 'heartbeat',
      cron: rt.heartbeatCron,
      tz: 'UTC',
      prompt: encodeAgentMessage({
        v: 1,
        type: 'heartbeat',
        requestId: 'cron:heartbeat',
        studentId,
      }),
      enabled: true,
    },
  ];
}

export function createApp(
  deps: { emitter?: Emitter; dedupe?: Dedupe; handlerDeps?: Partial<HandlerDeps> } = {},
) {
  const emitter = deps.emitter ?? new Emitter();
  const dedupe = deps.dedupe ?? new Dedupe();
  const app = new Hono();

  // Health must be fast and side-effect free (Maritime contract).
  app.get('/health', (c) => c.json({ ok: true }));

  app.get('/', (c) => {
    const rt = runtime();
    return c.json({
      agent: 'helm',
      version: config.version,
      studentId: rt.studentId || null,
      configSource: rt.source,
      configError: rt.error ?? null,
      backendConfigured: emitter.configured,
    });
  });

  app.get('/schedules', (c) => c.json(buildSchedules()));

  app.post('/chat', async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    const body = MaritimeChatBody.safeParse(raw);
    if (!body.success) return c.json({ error: 'message is required' }, 400);

    const source = body.data.source ?? 'unknown';
    console.log(`[chat] source=${source} len=${body.data.message.length}`);
    if (config.debugInbound) {
      // Spike aid: shows how Maritime wraps webhook/cron bodies. Off by default (may contain email text).
      console.log(
        `[chat:debug] keys=${Object.keys(raw as object).join(',')} message=${body.data.message.slice(0, 600)}`,
      );
    }
    const inbound = parseInbound(body.data.message);

    // Retry anything left in the outbox from a previous wake.
    void emitter.flush();

    if (inbound.kind === 'invalid') {
      await emitter.emit(
        emitter.event({
          type: 'agent.error',
          reason: 'Received a malformed message and ignored it',
          payload: { error: inbound.error.slice(0, 1000), source },
        }),
      );
      return c.json({ response: `Ignored malformed message: ${inbound.error}` });
    }

    if (inbound.kind === 'text') {
      // In-app chat (PRD S2): answered from the person's own plan; read-only.
      const conversationId = body.data.conversation_id ?? body.data.conversationId ?? 'default';
      const answer = handleChat(inbound.text, conversationId, {
        emitter,
        dedupe,
        source,
        deps: deps.handlerDeps,
      });
      const got = await Promise.race([
        answer,
        new Promise<null>((r) => setTimeout(() => r(null), config.replyBudgetMs)),
      ]).catch(() => null);
      if (got === null)
        answer.catch((err: unknown) => console.error('[chat] late answer failed', err));
      return c.json({ response: got ?? 'Still thinking about that. Ask me again in a moment.' });
    }

    const work = handleMessage(inbound.message, {
      emitter,
      dedupe,
      source,
      deps: deps.handlerDeps,
    });
    const winner = await Promise.race([
      work.then((reply) => ({ reply })),
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), config.replyBudgetMs)),
    ]).catch((err: unknown) => ({ error: err }));

    if (winner === 'timeout') {
      work.catch((err: unknown) => console.error('[chat] background work failed', err));
      return c.json({
        response: `Working on ${inbound.message.type}; results go to the Helm app.`,
      });
    }
    if ('error' in winner) {
      console.error('[chat] handler failed', winner.error);
      await emitter.emit(
        emitter.event({
          requestId: inbound.message.requestId,
          type: 'agent.error',
          reason: `Failed while handling ${inbound.message.type}`,
          payload: { error: String(winner.error).slice(0, 1000) },
        }),
      );
      return c.json({ response: `Error handling ${inbound.message.type}` });
    }
    return c.json({ response: winner.reply });
  });

  return app;
}
