import {
  AgentState,
  utcToLocal,
  type AgentMessage,
  AgentSubmissionJob,
  InboxResultResponse,
  SOURCE_LABEL,
  blocking,
  runSubmissionChecks,
  type BriefRequest,
  type SubmissionResultRequest,
  type InboxResultRequest,
  type IntakeResultRequest,
} from '@helm/shared';
import { z } from 'zod';
import { DATA_DIR, runtime } from './config';
import { LlmError, llmChainFromEnv, llmJson } from './llm/gemini';
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
import { SandboxUnavailable, parseInSandbox } from './tools/sandbox-parse';

export interface DocumentRead {
  text: string;
  /** Where the untrusted file was opened. */
  via: 'sandbox' | 'agent';
  sandboxId?: string;
  ms: number;
  /** When the sandbox finished reading (it is deleted right after). */
  ranAt?: string;
  /** Why no sandbox was used, when one was wanted. */
  fallback?: string;
}
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { httpDriver, portalCredsFromEnv, type SubmissionDriver } from './tools/portal-http';
import {
  GmailError,
  GmailState,
  accessToken,
  getEmail,
  gmailCredsFromEnv,
  listRecent,
  type GmailCreds,
  type GmailEmail,
} from './tools/gmail';
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
  /** Text of an untrusted document: in a throwaway sandbox when one is available. */
  readDocument: (filePath: string, fileName: string, requestId: string) => Promise<DocumentRead>;
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
  /** The submission driver, or null when this agent has no portal login. */
  driver: () => SubmissionDriver | null;
  readFile: (absPath: string) => Promise<Uint8Array>;
  /** Read-only Gmail, or null when not connected. */
  gmail: () => GmailReader | null;
}

export interface GmailReader {
  listNew(afterEpochS: number): Promise<string[]>;
  get(id: string): Promise<GmailEmail>;
}

function gmailReader(c: GmailCreds): GmailReader {
  let token: string | null = null;
  const t = async () => (token ??= await accessToken(c));
  return {
    listNew: async (after) => listRecent(await t(), after, 10),
    get: async (id) => getEmail(await t(), id),
  };
}

const defaultDeps = (): HandlerDeps => ({
  readDocument: async (filePath, fileName, requestId) => {
    if (process.env.SANDBOX_PARSING !== 'off') {
      try {
        const r = await parseInSandbox(filePath, fileName, requestId, {
          post: (p, b) => postBackend(p, b),
          studentId: runtime().studentId,
        });
        return { text: r.text, via: 'sandbox', sandboxId: r.sandboxId, ms: r.ms, ranAt: r.ranAt };
      } catch (err) {
        // A file the sandbox rejected is never opened here; only "no sandbox" falls back.
        if (!(err instanceof SandboxUnavailable)) throw err;
        const t0 = Date.now();
        return {
          text: await readDocumentText(filePath),
          via: 'agent',
          ms: Date.now() - t0,
          fallback: err.message,
        };
      }
    }
    const t0 = Date.now();
    return { text: await readDocumentText(filePath), via: 'agent', ms: Date.now() - t0 };
  },
  extract: (text, ctx) => extractDeadlines(text, ctx, llmChainFromEnv()),
  post: (path, body) => postBackend(path, body),
  get: (path) => getBackend(path),
  classify: (email, ctx) =>
    classifyEmail(
      email,
      ctx,
      llmChainFromEnv().map((o) => ({ ...o, timeoutMs: 30_000 })),
    ),
  word: async (draft) => {
    const p = wordingPrompt(draft);
    const r = await llmJson(
      llmChainFromEnv().map((o) => ({ ...o, timeoutMs: 20_000 })),
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
  driver: () => {
    const creds = portalCredsFromEnv();
    return creds ? httpDriver(creds) : null;
  },
  readFile: async (p) => new Uint8Array(await fs.readFile(p)),
  gmail: () => {
    const c = gmailCredsFromEnv();
    return c ? gmailReader(c) : null;
  },
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
  'gmail.sync': 'Woke to check your Gmail',
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
    case 'gmail.sync': {
      reply = await handleGmailSync(msg.payload.reason, requestId, woke, ctx);
      break;
    }
    case 'heartbeat': {
      reply = await handleHeartbeat(ctx);
      // The heartbeat is also when new Gmail is read (quietly unless something arrived).
      if ((ctx.deps?.gmail ?? defaultDeps().gmail)())
        reply += ` | ${await handleGmailSync('heartbeat', requestId, woke, ctx)}`;
      // Stays off the timeline unless the safety net found something to do.
      ctx.dedupe.add(requestId);
      return reply;
    }
    case 'submission.hold_notice': {
      reply = await handleHoldNotice(msg, requestId, woke, ctx);
      break;
    }
    case 'submission.run': {
      reply = await handleSubmissionRun(msg, requestId, woke, ctx);
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
      // Every message type has a handler; this only catches a type added without one.
      await ctx.emitter.emit(woke);
      reply = `Received ${(msg as AgentMessage).type}. Not implemented yet.`;
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
  let read: DocumentRead | undefined;
  let sandboxEvent: ReturnType<Emitter['event']> | null = null;
  try {
    const doc = await deps.readDocument(filePath, fileName, requestId);
    read = doc;
    // Stamped now, so the timeline shows it before the sandbox is reported deleted.
    if (doc.via === 'sandbox')
      sandboxEvent = ctx.emitter.event({
        eventId: `${requestId}:sandbox`,
        requestId,
        type: 'sandbox.command',
        ...(doc.ranAt ? { occurredAt: doc.ranAt } : {}),
        reason: `Opened "${fileName}" in a throwaway sandbox, not in your agent (${(doc.ms / 1000).toFixed(1)} s)`,
        payload: { sandboxId: doc.sandboxId, fileName, ms: doc.ms },
      });
    const text = doc.text;
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
    ...(sandboxEvent ? [sandboxEvent] : []),
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
        parsedIn: read?.via ?? 'agent',
        ...(read?.fallback ? { sandboxFallback: read.fallback } : {}),
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
  return processMessage(msg.payload, requestId, woke, ctx);
}

/** One message (shared, or read from Gmail): classify as data, let the backend's rule decide. */
async function processMessage(
  payload: Extract<AgentMessage, { type: 'inbox.message' }>['payload'],
  requestId: string,
  woke: ReturnType<Emitter['event']>,
  ctx: HandlerContext,
): Promise<string> {
  const deps = { ...defaultDeps(), ...ctx.deps };
  const { inboxMessageId, source, from, subject, receivedAt, body } = payload;
  const sender = senderName(from);
  const what = SOURCE_LABEL[source];
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
      { source, from, subject, receivedAt, body },
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
        `Read ${what === 'email' ? 'an email' : `a ${what}`} from ${sender}: ${change.summary}` +
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
    const detail =
      change.kind === 'deadline_changed' && change.newDueAt
        ? `now due ${whenIn(change.newDueAt, state.timezone)}`
        : 'requirements updated';
    events.push(
      ctx.emitter.event({
        eventId: `${requestId}:applied`,
        requestId,
        type: 'change.applied',
        reason: `Updated "${title}": ${detail}, from ${sender}'s ${what}`,
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
            ? `New item from ${sender}'s ${what} to check: "${title}"`
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

/**
 * Platform-cron heartbeat: the safety net (PRD 7). Asks the backend to act on anything due for
 * this student, so a missed webhook can never miss a deadline.
 */
async function handleHeartbeat(ctx: HandlerContext): Promise<string> {
  const deps = { ...defaultDeps(), ...ctx.deps };
  try {
    const res = await deps.post('/api/agent/heartbeat', {});
    return res.ok ? `heartbeat: ${await res.text()}` : `heartbeat: HTTP ${res.status}`;
  } catch (err) {
    return `heartbeat failed: ${String(err).slice(0, 200)}`;
  }
}

async function loadJob(deps: HandlerDeps, submissionId: string) {
  const res = await deps.get(`/api/agent/submissions/${encodeURIComponent(submissionId)}`);
  if (!res.ok) throw new Error(`job HTTP ${res.status}`);
  return AgentSubmissionJob.parse(await res.json());
}

/** Read the approved file from this agent's own disk and re-run every check (PRD 12). */
async function recheck(deps: HandlerDeps, job: AgentSubmissionJob) {
  const path = resolveInside(deps.dataDir, job.agentFilePath);
  if (!path) throw new DocumentError("The file is outside the agent's storage.");
  let bytes: Uint8Array;
  try {
    bytes = await deps.readFile(path);
  } catch {
    throw new DocumentError("The file is missing from the agent's storage. Upload it again.");
  }
  const sha = createHash('sha256').update(bytes).digest('hex');
  const checks = runSubmissionChecks({
    fileName: job.fileName,
    fileSize: bytes.length,
    fileSha256: sha,
    assignment: job.assignment,
    consentSha256: job.consentSha256 ?? job.fileSha256,
    now: deps.now(),
  });
  return { bytes, sha, checks };
}

async function handleHoldNotice(
  msg: Extract<AgentMessage, { type: 'submission.hold_notice' }>,
  requestId: string,
  woke: ReturnType<Emitter['event']>,
  ctx: HandlerContext,
): Promise<string> {
  const deps = { ...defaultDeps(), ...ctx.deps };
  let reason: string;
  let ok = false;
  try {
    const job = await loadJob(deps, msg.payload.submissionId);
    const { checks } = await recheck(deps, job);
    ok = !blocking(checks);
    reason = ok
      ? `Re-checked "${job.fileName}" before the hold window: ready to submit`
      : `Re-checked "${job.fileName}": ${checks.find((c) => c.status === 'fail')!.message}`;
  } catch (err) {
    reason =
      err instanceof DocumentError
        ? err.message
        : `Couldn't re-check the file (${String(err).slice(0, 120)})`;
  }
  await ctx.emitter.emit(
    woke,
    ctx.emitter.event({
      eventId: `${requestId}:checks`,
      requestId,
      type: ok ? 'submission.checks_run' : 'agent.error',
      reason,
      payload: { submissionId: msg.payload.submissionId, stage: 'hold_notice' },
    }),
  );
  return reason;
}

/**
 * Submit one approved file (PRD 12, "Execution"): re-check it on this VM, log in to the portal
 * with this student's own credentials, submit with the idempotency key, and report the receipt.
 */
async function handleSubmissionRun(
  msg: Extract<AgentMessage, { type: 'submission.run' }>,
  requestId: string,
  woke: ReturnType<Emitter['event']>,
  ctx: HandlerContext,
): Promise<string> {
  const deps = { ...defaultDeps(), ...ctx.deps };
  const { submissionId, attempt } = msg.payload;
  const started = Date.now();
  const report = async (
    outcome: SubmissionResultRequest['outcome'],
    driver: 'http' | 'desktop',
  ) => {
    const body: SubmissionResultRequest = {
      studentId: runtime().studentId,
      requestId,
      attempt,
      driver,
      outcome,
    };
    const res = await deps.post(
      `/api/agent/submissions/${encodeURIComponent(submissionId)}/result`,
      body,
    );
    if (!res.ok) throw new Error(`result HTTP ${res.status}`);
  };
  const failed = async (
    error: string,
    retryable: boolean,
    title: string,
    driver: 'http' | 'desktop' = 'http',
  ) => {
    try {
      await report({ ok: false, error, retryable }, driver);
    } catch (err) {
      console.error('[submit] could not report failure', err);
    }
    await ctx.emitter.emit(
      woke,
      ctx.emitter.event({
        eventId: `${requestId}:failed`,
        requestId,
        type: 'submission.failed',
        reason: `Attempt ${attempt} for ${title} failed: ${error}`,
        payload: { submissionId, attempt, retryable, ms: Date.now() - started },
      }),
    );
    return error;
  };

  let job: AgentSubmissionJob;
  try {
    job = await loadJob(deps, submissionId);
  } catch (err) {
    return failed(
      `Couldn't load the submission (${String(err).slice(0, 120)}).`,
      true,
      'a submission',
    );
  }
  const title = `"${job.fileName}" (${job.assignment.courseCode ? `${job.assignment.courseCode} ` : ''}${job.assignment.title})`;
  if (job.status !== 'submitting' || job.attempt !== attempt)
    return `Skipped: attempt ${attempt} is no longer current (${job.status}).`;

  let file: Awaited<ReturnType<typeof recheck>>;
  try {
    file = await recheck(deps, job);
  } catch (err) {
    return failed(err instanceof DocumentError ? err.message : String(err), false, title);
  }
  const bad = file.checks.find((c) => c.status === 'fail');
  if (bad) return failed(bad.message, false, title);

  const driver = deps.driver();
  if (!driver) return failed('This agent has no portal login yet.', true, title);
  const result = await driver.submit(job, { bytes: file.bytes, name: job.fileName });
  if (!result.ok) return failed(result.error, result.retryable, title, driver.name);
  try {
    await report({ ok: true, receipt: result.receipt, duplicate: result.duplicate }, driver.name);
  } catch (err) {
    // The portal has it; the backend will learn on the next attempt (the portal returns the same
    // receipt for the same key). Never resubmit a different copy.
    console.error('[submit] receipt not reported', err);
  }
  await ctx.emitter.emit(
    woke,
    ctx.emitter.event({
      eventId: `${requestId}:submitted`,
      requestId,
      type: 'submission.submitted',
      reason: `Submitted ${title}: confirmation ${result.receipt.confirmationId}${result.duplicate ? ' (already on the portal)' : ''}`,
      payload: {
        submissionId,
        attempt,
        driver: driver.name,
        confirmationId: result.receipt.confirmationId,
        fileSha256: result.receipt.fileSha256,
        ms: Date.now() - started,
      },
    }),
  );
  return `submitted ${result.receipt.confirmationId}`;
}

/**
 * Read new Gmail (read-only) and run each email through the same path as a shared message.
 * Bodies stay on this VM: the backend gets sender, subject, time, a hash and the result.
 */
async function handleGmailSync(
  reason: 'connected' | 'manual' | 'heartbeat',
  requestId: string,
  woke: ReturnType<Emitter['event']>,
  ctx: HandlerContext,
): Promise<string> {
  const deps = { ...defaultDeps(), ...ctx.deps };
  const quiet = reason === 'heartbeat';
  const note = async (
    text: string,
    type: 'inbox.classified' | 'agent.error' = 'inbox.classified',
  ) => {
    if (quiet && type !== 'agent.error') return text;
    await ctx.emitter.emit(
      woke,
      ctx.emitter.event({
        eventId: `${requestId}:gmail`,
        requestId,
        type,
        reason: text,
        payload: { source: 'gmail', reason },
      }),
    );
    return text;
  };
  const gmail = deps.gmail();
  if (!gmail) return quiet ? 'gmail: not connected' : note('Gmail is not connected to this agent.');
  const store = new GmailState(path.join(deps.dataDir, 'gmail', 'state.json'));
  const state = await store.load();
  const nowS = Math.floor(deps.now().getTime() / 1000);
  // First sync looks back 2 days; later syncs overlap by an hour (ids dedupe).
  const after = state.lastSyncS ? state.lastSyncS - 3600 : nowS - 2 * 86_400;
  let ids: string[];
  try {
    ids = await gmail.listNew(after);
  } catch (err) {
    const revoked = err instanceof GmailError && err.kind === 'revoked';
    return note(
      revoked
        ? 'Gmail access was removed in your Google account. Connect Gmail again in Helm.'
        : `Couldn't check Gmail (${String(err).slice(0, 120)}).`,
      'agent.error',
    );
  }
  const fresh = ids
    .filter((id) => !state.seen.includes(id))
    .reverse()
    .slice(0, 8);
  let handled = 0;
  for (const id of fresh) {
    let email: GmailEmail;
    try {
      email = await gmail.get(id);
    } catch {
      continue;
    }
    const reg = await deps.post('/api/agent/inbox/message', {
      studentId: runtime().studentId,
      source: 'email',
      externalId: id,
      from: email.from,
      subject: email.subject,
      receivedAt: email.receivedAt,
      bodySha256: createHash('sha256').update(email.body).digest('hex'),
    });
    if (!reg.ok) continue;
    const { inboxMessageId, alreadyProcessed } = (await reg.json()) as {
      inboxMessageId: string;
      alreadyProcessed: boolean;
    };
    state.seen.push(id);
    if (alreadyProcessed) continue;
    await processMessage(
      {
        inboxMessageId,
        source: 'email',
        from: email.from,
        subject: email.subject,
        receivedAt: email.receivedAt,
        body: email.body,
      },
      `gmail:${id}`,
      woke,
      ctx,
    );
    handled++;
  }
  state.lastSyncS = nowS;
  await store.save(state);
  if (handled === 0) return note('Checked your Gmail: nothing new.');
  return `gmail: read ${handled} new email${handled === 1 ? '' : 's'}`;
}
