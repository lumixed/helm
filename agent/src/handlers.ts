import {
  AgentState,
  utcToLocal,
  type AgentMessage,
  InboxResultResponse,
  type BriefRequest,
  type InboxResultRequest,
  type IntakeResultRequest,
} from '@helm/shared';
import { z } from 'zod';
import { DATA_DIR, runtime } from './config';
import { geminiJson, LlmError, llmFromEnv } from './llm/gemini';
import { buildBrief, wordingPrompt, type WordFn } from './tools/brief';
import { getBackend, postBackend } from './backend';
import { extractDeadlines, type ExtractOutput } from './tools/extract';
import {
  classifyEmail,
  type ClassifyContext,
  type ClassifyOutput,
  type InboundEmail,
} from './tools/classify-email';
import { DocumentError, readDocumentText, resolveInside } from './tools/read-document';
import type { Emitter } from './emit';
import type { Dedupe } from './dedupe';

export interface HandlerContext {
  emitter: Emitter;
  dedupe: Dedupe;
  /** Maritime's `source` field: "scheduled", "cli", "front_door", "telegram", webhook, ... */
  source: string;
  /** Swappable for tests. */
  deps?: Partial<HandlerDeps>;
}

export interface HandlerDeps {
  extract: (
    text: string,
    ctx: { timezone: string; today: string; courseHint?: string },
  ) => Promise<ExtractOutput>;
  post: (path: string, body: unknown) => Promise<Response>;
  get: (path: string) => Promise<Response>;
  classify: (email: InboundEmail, ctx: ClassifyContext) => Promise<ClassifyOutput>;
  word: WordFn;
  now: () => Date;
  dataDir: string;
}

const defaultDeps = (): HandlerDeps => ({
  extract: (text, ctx) => extractDeadlines(text, ctx, llmFromEnv()),
  post: (path, body) => postBackend(path, body),
  get: (path) => getBackend(path),
  classify: (email, ctx) => classifyEmail(email, ctx, { ...llmFromEnv(), timeoutMs: 30_000 }),
  word: async (draft) => {
    const llm = llmFromEnv();
    const p = wordingPrompt(draft);
    const r = await geminiJson(
      { ...llm, timeoutMs: 20_000 },
      {
        system: p.system,
        user: p.user,
        schemaName: 'brief_opener',
        jsonSchema: {
          type: 'object',
          required: ['summary'],
          properties: { summary: { type: 'string' } },
        },
        zod: z.object({ summary: z.string().min(1).max(800) }),
      },
    );
    return { summary: r.data.summary, writer: r.model };
  },
  now: () => new Date(),
  dataDir: DATA_DIR,
});

const WAKE_REASONS: Record<AgentMessage['type'], string> = {
  ping: 'Woke for a connectivity check',
  'brief.generate': 'Woke to write your brief',
  heartbeat: 'Woke for the safety-net check',
  'intake.parse': 'Woke to read a new syllabus',
  'inbox.message': 'Woke for a new email',
  'submission.hold_notice': 'Woke to send a last-chance hold notice',
  'submission.run': 'Woke to submit homework',
  'redteam.egress': 'Woke for a red-team simulation',
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
    case 'brief.generate': {
      reply = await handleBrief(msg, requestId, woke, ctx);
      break;
    }
    case 'redteam.egress': {
      reply = await handleRedteam(msg, requestId, woke, ctx);
      break;
    }
    case 'heartbeat': {
      // Safety net for submissions (built with M7). Stays quiet so the timeline isn't flooded.
      reply = 'ok';
      break;
    }
    case 'intake.parse': {
      reply = await handleIntake(msg, requestId, woke, ctx);
      break;
    }
    case 'inbox.message': {
      reply = await handleInbox(msg, requestId, woke, ctx);
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

async function handleIntake(
  msg: Extract<AgentMessage, { type: 'intake.parse' }>,
  requestId: string,
  woke: ReturnType<Emitter['event']>,
  ctx: HandlerContext,
): Promise<string> {
  const deps = { ...defaultDeps(), ...ctx.deps };
  const { intakeId, fileName, courseHint } = msg.payload;
  const fail = async (reason: string, detail?: string) => {
    await ctx.emitter.emit(
      woke,
      ctx.emitter.event({
        eventId: `${requestId}:error`,
        requestId,
        type: 'agent.error',
        reason,
        payload: {
          intakeId,
          fileName,
          stage: 'intake',
          ...(detail ? { detail: detail.slice(0, 500) } : {}),
        },
      }),
    );
    return reason;
  };

  const filePath = resolveInside(deps.dataDir, msg.payload.filePath);
  if (!filePath) return fail(`Refused to read "${fileName}": it is outside the agent's storage.`);

  const started = Date.now();
  let out: ExtractOutput;
  try {
    const text = await readDocumentText(filePath);
    const rt = runtime();
    out = await deps.extract(text, {
      timezone: rt.timezone,
      today: utcToLocal(new Date(), rt.timezone).slice(0, 10),
      courseHint,
    });
  } catch (err) {
    if (err instanceof DocumentError) return fail(`Couldn't read "${fileName}": ${err.message}`);
    if (err instanceof LlmError)
      return fail(
        `Couldn't read "${fileName}": the AI service is busy. Try again in a minute.`,
        err.message,
      );
    return fail(`Couldn't read "${fileName}".`, String(err));
  }

  const result: IntakeResultRequest = {
    studentId: runtime().studentId,
    requestId,
    intakeId,
    fileName,
    model: out.model,
    assignments: out.assignments,
    warnings: out.warnings,
  };
  let res: Response;
  try {
    res = await deps.post('/api/agent/intake/result', result);
  } catch (err) {
    return fail(
      `Read "${fileName}" but couldn't save the results. Try uploading again.`,
      String(err),
    );
  }
  if (!res.ok)
    return fail(
      `Read "${fileName}" but the app rejected the results.`,
      `HTTP ${res.status} ${await res.text()}`,
    );

  const low = out.assignments.filter((a) => a.confidence < 0.7).length;
  await ctx.emitter.emit(
    woke,
    ctx.emitter.event({
      eventId: `${requestId}:parsed`,
      requestId,
      type: 'intake.parsed',
      reason: `Read "${fileName}": found ${out.assignments.length} deadlines${low ? `, ${low} to double-check` : ''}`,
      payload: {
        intakeId,
        fileName,
        count: out.assignments.length,
        lowConfidence: low,
        warnings: out.warnings.length,
        model: out.model,
        ms: Date.now() - started,
      },
    }),
  );
  return `Found ${out.assignments.length} deadlines in ${fileName}.`;
}

/** "Prof. Lee <lee@uni.test>" -> "Prof. Lee". Display only. */
export function senderName(from: string): string {
  const m = /^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/.exec(from);
  return (m?.[1] ?? from).trim().slice(0, 80) || 'unknown sender';
}

const whenIn = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));

/**
 * PRD M6: read one email as data, describe it with the LLM, and let the backend's rule decide
 * whether it applies. A confident deadline move that applied triggers a replan (a new brief).
 */
async function handleInbox(
  msg: Extract<AgentMessage, { type: 'inbox.message' }>,
  requestId: string,
  woke: ReturnType<Emitter['event']>,
  ctx: HandlerContext,
): Promise<string> {
  const deps = { ...defaultDeps(), ...ctx.deps };
  const { inboxMessageId, from, subject, receivedAt, body } = msg.payload;
  const sender = senderName(from);
  const fail = async (reason: string, detail?: string) => {
    await ctx.emitter.emit(
      woke,
      ctx.emitter.event({
        eventId: `${requestId}:error`,
        requestId,
        type: 'agent.error',
        reason,
        payload: {
          inboxMessageId,
          stage: 'inbox',
          ...(detail ? { detail: detail.slice(0, 500) } : {}),
        },
      }),
    );
    return reason;
  };

  const started = Date.now();
  let state: AgentState;
  try {
    const res = await deps.get('/api/agent/state');
    if (!res.ok)
      return fail(`Couldn't check the email from ${sender}.`, `state HTTP ${res.status}`);
    state = AgentState.parse(await res.json());
  } catch (err) {
    return fail(`Couldn't check the email from ${sender}.`, String(err));
  }

  let out: ClassifyOutput;
  try {
    out = await deps.classify(
      { from, subject, receivedAt, body },
      { timezone: state.timezone, assignments: state.assignments },
    );
  } catch (err) {
    if (err instanceof LlmError)
      return fail(
        `Couldn't read the email from ${sender}: the AI service is busy. It will be retried.`,
        err.message,
      );
    return fail(`Couldn't read the email from ${sender}.`, String(err));
  }
  const { change } = out;

  const result: InboxResultRequest = {
    studentId: state.studentId,
    requestId,
    inboxMessageId,
    model: out.model,
    change,
  };
  let decision: InboxResultResponse;
  try {
    const res = await deps.post('/api/agent/inbox/result', result);
    if (!res.ok)
      return fail(
        `Read the email from ${sender} but the app rejected the result.`,
        `HTTP ${res.status} ${await res.text()}`,
      );
    decision = InboxResultResponse.parse(await res.json());
  } catch (err) {
    return fail(`Read the email from ${sender} but couldn't save the result.`, String(err));
  }

  const ms = Date.now() - started;
  const events = [
    ctx.emitter.event({
      eventId: `${requestId}:classified`,
      requestId,
      type: 'inbox.classified',
      reason:
        `Read an email from ${sender}: ${change.summary}` +
        (change.injectionSuspected
          ? ' It contained instructions aimed at an AI; Helm treated them as data and took no action from them.'
          : ''),
      payload: {
        inboxMessageId,
        from: sender,
        kind: change.kind,
        confidence: change.confidence,
        matchConfidence: change.matchConfidence,
        injectionSuspected: change.injectionSuspected,
        injectionSignals: change.injectionSignals,
        decision: decision.decision,
        model: out.model,
        ms,
      },
    }),
  ];
  const title = decision.assignmentTitle ?? change.title ?? 'an assignment';
  if (decision.decision === 'applied') {
    const what =
      change.kind === 'deadline_changed' && change.newDueAt
        ? `now due ${whenIn(change.newDueAt, state.timezone)}`
        : 'requirements updated';
    events.push(
      ctx.emitter.event({
        eventId: `${requestId}:applied`,
        requestId,
        type: 'change.applied',
        reason: `Updated "${title}": ${what}, from ${sender}'s email`,
        payload: { inboxMessageId, changeId: decision.changeId, kind: change.kind, from: sender },
      }),
    );
  } else if (decision.decision === 'needs_confirmation' || decision.decision === 'review') {
    events.push(
      ctx.emitter.event({
        eventId: `${requestId}:detected`,
        requestId,
        type: 'change.detected',
        reason:
          decision.decision === 'review'
            ? `New deadline from ${sender}'s email to check: "${title}"`
            : `Needs your OK: ${change.summary} ${decision.reason}`,
        payload: {
          inboxMessageId,
          changeId: decision.changeId,
          kind: change.kind,
          decision: decision.decision,
          from: sender,
        },
      }),
    );
  }
  await ctx.emitter.emit(woke, ...events);

  if (
    decision.decision === 'applied' &&
    change.kind === 'deadline_changed' &&
    !decision.duplicate
  ) {
    await handleBrief(
      {
        v: 1,
        type: 'brief.generate',
        requestId: `${requestId}:replan`,
        studentId: state.studentId,
        payload: { trigger: 'change' },
      },
      `${requestId}:replan`,
      woke,
      ctx,
    );
  }
  return `${change.kind}: ${decision.decision} (${decision.reason})`;
}

async function handleBrief(
  msg: Extract<AgentMessage, { type: 'brief.generate' }>,
  requestId: string,
  woke: ReturnType<Emitter['event']>,
  ctx: HandlerContext,
): Promise<string> {
  const deps = { ...defaultDeps(), ...ctx.deps };
  const trigger = ctx.source === 'scheduled' ? 'cron' : msg.payload.trigger;
  const failed = async (reason: string, detail: string) => {
    await ctx.emitter.emit(
      woke,
      ctx.emitter.event({
        eventId: `${requestId}:failed`,
        requestId,
        type: 'brief.failed',
        reason,
        payload: { trigger, detail: detail.slice(0, 500) },
      }),
    );
    return reason;
  };
  const started = Date.now();
  let state: AgentState;
  try {
    const res = await deps.get('/api/agent/state');
    if (!res.ok)
      return failed('Could not load your deadlines for the brief.', `HTTP ${res.status}`);
    state = AgentState.parse(await res.json());
  } catch (err) {
    return failed('Could not load your deadlines for the brief.', String(err));
  }
  const brief = await buildBrief(state, deps.now(), trigger, deps.word);
  const body: BriefRequest = { studentId: state.studentId, requestId, brief };
  try {
    const res = await deps.post('/api/agent/brief', body);
    if (!res.ok)
      return failed(
        'Wrote your brief but could not deliver it.',
        `HTTP ${res.status} ${await res.text()}`,
      );
  } catch (err) {
    return failed('Wrote your brief but could not deliver it.', String(err));
  }
  await ctx.emitter.emit(
    woke,
    ctx.emitter.event({
      eventId: `${requestId}:brief`,
      requestId,
      type: 'brief.generated',
      reason:
        trigger === 'change'
          ? `Replanned your day after the change: ${brief.focus.length} focus item${brief.focus.length === 1 ? '' : 's'}`
          : `Wrote your ${trigger === 'cron' ? 'morning' : ''} brief: ${brief.focus.length} focus item${brief.focus.length === 1 ? '' : 's'}`.replace(
              '  ',
              ' ',
            ),
      payload: {
        trigger,
        forDate: brief.forDate,
        focus: brief.focus.length,
        writer: brief.writer,
        ms: Date.now() - started,
      },
    }),
  );
  return `Brief for ${brief.forDate}: ${brief.focus.map((f) => f.title).join('; ') || 'nothing urgent'}`;
}

/**
 * Simulated compromise (demo only): try to send a harmless payload to a host outside the
 * allowlist and report honestly what happened. Nothing real is sent; the body says so.
 */
async function handleRedteam(
  msg: Extract<AgentMessage, { type: 'redteam.egress' }>,
  requestId: string,
  woke: ReturnType<Emitter['event']>,
  ctx: HandlerContext,
): Promise<string> {
  if (!runtime().demoMode) return 'Red-team simulation is only available in demo mode.';
  const url = new URL(msg.payload.url);
  const started = Date.now();
  let outcome: { blocked: boolean; detail: string };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'Helm red-team SIMULATION. No student data.',
      signal: AbortSignal.timeout(6000),
    });
    outcome = { blocked: false, detail: `HTTP ${res.status}` };
  } catch (err) {
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    outcome = {
      blocked: true,
      detail: (cause?.code ?? cause?.message ?? String(err)).slice(0, 200),
    };
  }
  await ctx.emitter.emit(
    woke,
    ctx.emitter.event({
      eventId: `${requestId}:egress`,
      requestId,
      type: outcome.blocked ? 'egress.blocked' : 'egress.allowed',
      reason: outcome.blocked
        ? `Blocked: the agent tried to reach ${url.host} (red-team simulation)`
        : `NOT blocked: the agent reached ${url.host} (red-team simulation). The allowlist is off.`,
      payload: {
        host: url.host,
        simulation: true,
        detail: outcome.detail,
        ms: Date.now() - started,
      },
    }),
  );
  return outcome.blocked ? `blocked: ${url.host}` : `reached: ${url.host}`;
}
