import type { AgentMessage } from '@helm/shared';
import type { Emitter } from './emit';
import type { Dedupe } from './dedupe';

export interface HandlerContext {
  emitter: Emitter;
  dedupe: Dedupe;
  /** Maritime's `source` field: "scheduled", "cli", "front_door", "telegram", webhook, ... */
  source: string;
}

const WAKE_REASONS: Record<AgentMessage['type'], string> = {
  ping: 'Woke for a connectivity check',
  'brief.generate': 'Woke to write the morning brief',
  heartbeat: 'Woke for the safety-net check',
  'intake.parse': 'Woke to read a new syllabus',
  'inbox.message': 'Woke for a new email',
  'submission.hold_notice': 'Woke to send a last-chance hold notice',
  'submission.run': 'Woke to submit homework',
};

/**
 * Scheduled prompts are static strings, so the same requestId arrives on every fire.
 * Make it unique per occurrence so dedupe does not swallow tomorrow's brief.
 */
export function effectiveRequestId(msg: AgentMessage, source: string, now = new Date()): string {
  if (source !== 'scheduled') return msg.requestId;
  const minute = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
  return `${msg.requestId}@${minute}`;
}

export async function handleMessage(msg: AgentMessage, ctx: HandlerContext): Promise<string> {
  const requestId = effectiveRequestId(msg, ctx.source);
  if (ctx.dedupe.has(requestId)) {
    return `Already handled ${msg.type} ${requestId}.`;
  }

  const woke = ctx.emitter.event({
    eventId: `${requestId}:woke`,
    requestId,
    type: 'agent.woke',
    reason: WAKE_REASONS[msg.type],
    payload: { messageType: msg.type, source: ctx.source },
  });

  let reply: string;
  switch (msg.type) {
    case 'ping': {
      const pong = ctx.emitter.event({
        eventId: `${requestId}:pong`,
        requestId,
        type: 'agent.pong',
        reason: msg.payload.note ? `Pong: ${msg.payload.note}` : 'Pong',
        payload: {
          source: ctx.source,
          node: process.version,
          uptimeS: Math.round(process.uptime()),
        },
      });
      const r = await ctx.emitter.emit(woke, pong);
      reply = `pong (${r.delivered} events delivered, ${r.queued} queued)`;
      break;
    }
    default: {
      // Phase 0: the wake is recorded; real handlers land in later phases (PRD section 17).
      await ctx.emitter.emit(woke);
      reply = `Received ${msg.type}. Not implemented yet.`;
    }
  }

  ctx.dedupe.add(requestId);
  return reply;
}
