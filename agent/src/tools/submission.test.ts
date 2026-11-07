import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { encodeAgentMessage, type AgentSubmissionJob } from '@helm/shared';
import { httpDriver, type SubmissionDriver } from './portal-http';

const bytes = new TextEncoder().encode('%PDF-1.4 finished work');
const sha = createHash('sha256').update(bytes).digest('hex');
const job = (o: Partial<AgentSubmissionJob> = {}): AgentSubmissionJob => ({
  submissionId: 'sub-1',
  status: 'submitting',
  attempt: 1,
  idempotencyKey: 'sub-1',
  fileName: 'DATA210_A3_Maya.pdf',
  fileSha256: sha,
  agentFilePath: '/data/homework/sub-1/DATA210_A3_Maya.pdf',
  consentSha256: sha,
  assignment: {
    id: 'a3',
    title: 'Assignment 3',
    courseCode: 'DATA 210',
    dueAt: '2099-01-01T00:00:00.000Z',
    status: 'todo',
    allowedFileTypes: ['pdf'],
  },
  portalUrl: 'https://helm.test/mock-portal',
  ...o,
});
const receipt = {
  confirmationId: 'DP-1',
  submittedAt: '2026-11-07T20:00:00.000Z',
  fileName: 'x.pdf',
  fileSha256: sha,
};

async function run(opts: {
  job: AgentSubmissionJob;
  driver: SubmissionDriver | null;
  file?: Uint8Array;
}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-sub-'));
  process.env.HELM_DATA_DIR = dir;
  process.env.HELM_STUDENT_ID = 's1';
  vi.resetModules();
  const { createApp } = await import('../server');
  const { Emitter } = await import('../emit');
  const { Dedupe } = await import('../dedupe');
  const events: { type: string; reason: string }[] = [];
  const posted: { path: string; body: { outcome: { ok: boolean; retryable?: boolean } } }[] = [];
  const app = createApp({
    emitter: new Emitter({
      target: () => ({ backendUrl: 'https://helm.test', token: 't', studentId: 's1' }),
      outbox: path.join(dir, 'outbox.jsonl'),
      fetch: (async (_u: string | URL | Request, init?: RequestInit) => {
        events.push(...(JSON.parse(String(init?.body)) as { events: typeof events }).events);
        return new Response('{"accepted":1,"duplicates":0}');
      }) as typeof fetch,
    }),
    dedupe: new Dedupe(path.join(dir, 'p.json')),
    handlerDeps: {
      dataDir: '/data',
      get: async () => new Response(JSON.stringify(opts.job)),
      post: async (p, body) => {
        posted.push({ path: p, body: body as never });
        return new Response('{}');
      },
      readFile: async () => opts.file ?? bytes,
      driver: () => opts.driver,
    },
  });
  await app.request('/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source: 'webhook',
      message: encodeAgentMessage({
        v: 1,
        type: 'submission.run',
        requestId: 'run:sub-1:1',
        studentId: 's1',
        payload: { submissionId: 'sub-1', attempt: 1 },
      }),
    }),
  });
  return { events, posted };
}

const okDriver: SubmissionDriver = {
  name: 'http',
  submit: async () => ({ ok: true, receipt, duplicate: false }),
};

describe('submission.run handler', () => {
  it('re-checks, submits, reports the receipt and logs it', async () => {
    const submit = vi.fn(okDriver.submit);
    const { events, posted } = await run({ job: job(), driver: { name: 'http', submit } });
    expect(submit).toHaveBeenCalledOnce();
    expect(posted[0]).toMatchObject({
      path: '/api/agent/submissions/sub-1/result',
      body: { outcome: { ok: true } },
    });
    expect(events.find((e) => e.type === 'submission.submitted')?.reason).toMatch(
      /confirmation DP-1/,
    );
  });

  it('refuses a file that changed after consent, without retrying', async () => {
    const submit = vi.fn(okDriver.submit);
    const { posted } = await run({
      job: job(),
      driver: { name: 'http', submit },
      file: new TextEncoder().encode('swapped'),
    });
    expect(submit).not.toHaveBeenCalled();
    expect(posted[0]!.body.outcome).toMatchObject({ ok: false, retryable: false });
  });

  it('skips a stale attempt (already handled elsewhere)', async () => {
    const submit = vi.fn(okDriver.submit);
    const { posted } = await run({
      job: job({ status: 'submitted' }),
      driver: { name: 'http', submit },
    });
    expect(submit).not.toHaveBeenCalled();
    expect(posted).toHaveLength(0);
  });

  it('reports a portal outage as retryable', async () => {
    const { posted, events } = await run({
      job: job(),
      driver: {
        name: 'http',
        submit: async () => ({ ok: false, error: 'The portal failed: 503', retryable: true }),
      },
    });
    expect(posted[0]!.body.outcome).toMatchObject({ ok: false, retryable: true });
    expect(events.map((e) => e.type)).toContain('submission.failed');
  });
});

describe('httpDriver', () => {
  const creds = { url: 'https://helm.test/mock-portal', username: 'u', password: 'p' };
  const route = (handlers: Record<string, () => Response>) =>
    (async (u: string | URL | Request) => {
      const url = String(u);
      const key = Object.keys(handlers).find((k) => url.includes(k));
      return key ? handlers[key]!() : new Response('{}', { status: 404 });
    }) as typeof fetch;

  it('logs in, finds nothing, uploads, and returns the receipt', async () => {
    const d = httpDriver(creds, {
      fetch: route({
        '/api/login': () => Response.json({ token: 'tok' }),
        '/api/submissions': () => Response.json({ error: 'none' }, { status: 404 }),
        '/api/submit': () => Response.json({ receipt, duplicate: false }, { status: 201 }),
      }),
    });
    expect(await d.submit(job(), { bytes, name: 'a.pdf' })).toEqual({
      ok: true,
      receipt,
      duplicate: false,
    });
  });

  it('returns the existing receipt instead of uploading twice', async () => {
    const submit = vi.fn(() => Response.json({}));
    const d = httpDriver(creds, {
      fetch: route({
        '/api/login': () => Response.json({ token: 'tok' }),
        '/api/submissions': () => Response.json({ receipt }),
        '/api/submit': submit,
      }),
    });
    expect(await d.submit(job(), { bytes, name: 'a.pdf' })).toMatchObject({
      ok: true,
      duplicate: true,
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it('treats 503 as retryable and late/duplicate refusals as final', async () => {
    const base = {
      '/api/login': () => Response.json({ token: 'tok' }),
      '/api/submissions': () => new Response('', { status: 404 }),
    };
    const down = httpDriver(creds, {
      fetch: route({
        ...base,
        '/api/submit': () => Response.json({ error: 'down' }, { status: 503 }),
      }),
    });
    expect(await down.submit(job(), { bytes, name: 'a.pdf' })).toMatchObject({
      ok: false,
      retryable: true,
    });
    const late = httpDriver(creds, {
      fetch: route({
        ...base,
        '/api/submit': () => Response.json({ error: 'late' }, { status: 422 }),
      }),
    });
    expect(await late.submit(job(), { bytes, name: 'a.pdf' })).toMatchObject({
      ok: false,
      retryable: false,
    });
    const badLogin = httpDriver(creds, {
      fetch: route({ '/api/login': () => new Response('', { status: 401 }) }),
    });
    expect(await badLogin.submit(job(), { bytes, name: 'a.pdf' })).toMatchObject({
      ok: false,
      retryable: false,
    });
  });
});
