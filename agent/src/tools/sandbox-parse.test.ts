import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { DocumentError } from './read-document';
import { SandboxUnavailable, parseInSandbox } from './sandbox-parse';

let file: string;
let calls: { what: string; url?: string; body?: unknown }[];
beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-sbx-'));
  file = path.join(dir, 'x.pdf');
  fs.writeFileSync(file, '%PDF fake');
  calls = [];
});

const lease = {
  sandboxId: 'sbx-1',
  dataPlaneUrl: 'https://api-sbx-1.h2.sb.mtm.sh/v1',
  secret: 's3cret',
};

function deps(opts: { leaseOk?: boolean; putStatus?: number; stdout?: string } = {}) {
  return {
    studentId: 's1',
    parser: async () => new Uint8Array([1, 2, 3]),
    post: async (p: string, body: unknown) => {
      calls.push({ what: `post ${p}`, body });
      if (p === '/api/agent/sandbox')
        return opts.leaseOk === false ? new Response('{}', { status: 502 }) : Response.json(lease);
      return Response.json({ ended: true });
    },
    fetch: (async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u);
      calls.push({ what: `${init?.method} ${url.replace(lease.dataPlaneUrl, '')}` });
      expect((init?.headers as Record<string, string>)['X-Maritime-Token']).toBe('s3cret');
      if (init?.method === 'PUT') return new Response(null, { status: opts.putStatus ?? 204 });
      return Response.json({
        state: 'exited',
        exitCode: 0,
        stdout:
          opts.stdout ??
          JSON.stringify({
            ok: true,
            text: 'Syllabus text '.repeat(10),
            chars: 140,
            truncated: false,
          }),
      });
    }) as typeof fetch,
  };
}

describe('parseInSandbox', () => {
  it('leases, uploads parser + file under a fixed name, runs, and always ends the sandbox', async () => {
    const r = await parseInSandbox(file, 'my "evil" $(rm -rf).pdf', 'req-1', deps());
    expect(r).toMatchObject({ sandboxId: 'sbx-1', text: expect.stringContaining('Syllabus') });
    expect(calls.map((c) => c.what)).toEqual([
      'post /api/agent/sandbox',
      'PUT /files?path=%2Ftmp%2Fhelm%2Fparse.mjs',
      'PUT /files?path=%2Ftmp%2Fhelm%2Fin%2Fdoc.pdf',
      'POST /commands',
      'post /api/agent/sandbox/sbx-1/end',
    ]);
    // The original (hostile) file name never reaches the sandbox (only the backend's timeline label).
    expect(JSON.stringify(calls.filter((c) => !c.what.startsWith('post ')))).not.toContain('rm');
    expect(calls.at(-1)!.body).toMatchObject({
      ok: true,
      summary: expect.stringMatching(/^PDF, 140 characters/),
    });
  });

  it("keeps the sandbox's verdict on a bad file (no fallback), and still ends it", async () => {
    await expect(
      parseInSandbox(
        file,
        'x.pdf',
        'r',
        deps({ stdout: JSON.stringify({ ok: false, error: 'Invalid PDF.' }) }),
      ),
    ).rejects.toBeInstanceOf(DocumentError);
    expect(calls.at(-1)).toMatchObject({
      what: 'post /api/agent/sandbox/sbx-1/end',
      body: { ok: false },
    });
  });

  it('reports "no sandbox" when none can be created (so the caller may fall back)', async () => {
    await expect(
      parseInSandbox(file, 'x.pdf', 'r', deps({ leaseOk: false })),
    ).rejects.toBeInstanceOf(SandboxUnavailable);
  });

  it('ends the sandbox even when the upload fails', async () => {
    await expect(
      parseInSandbox(file, 'x.pdf', 'r', deps({ putStatus: 500 })),
    ).rejects.toBeInstanceOf(SandboxUnavailable);
    expect(calls.at(-1)!.what).toBe('post /api/agent/sandbox/sbx-1/end');
  });
});
