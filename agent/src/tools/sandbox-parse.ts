import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SandboxLease, SandboxParseOutput } from '@helm/shared';
import { DocumentError } from './read-document';

/**
 * Open an untrusted document in a throwaway Maritime sandbox (PRD v2 WP-6) instead of this VM.
 * The backend creates the sandbox (no internet, gone after 2 idle minutes) and gives this agent
 * only that sandbox's address and secret. The agent uploads the parser and the file, runs it,
 * gets JSON back, and asks the backend to delete the sandbox with its disk.
 */
export class SandboxUnavailable extends Error {}

const PARSER_NAME = 'sandbox-parse.mjs';
let parserCache: Uint8Array | null = null;

/** The parser bundle ships next to server.mjs in the agent image. */
async function parserBytes(): Promise<Uint8Array> {
  if (parserCache) return parserCache;
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const p of [path.join(here, PARSER_NAME), path.join(here, '..', 'dist', PARSER_NAME)]) {
    try {
      parserCache = new Uint8Array(await fs.readFile(p));
      return parserCache;
    } catch {
      /* try the next place */
    }
  }
  throw new SandboxUnavailable('parser bundle not found');
}

export interface SandboxDeps {
  post: (path: string, body: unknown) => Promise<Response>;
  studentId: string;
  fetch?: typeof fetch;
  parser?: () => Promise<Uint8Array>;
}

export interface SandboxResult {
  text: string;
  sandboxId: string;
  ms: number;
  /** When the parser finished (before the sandbox is deleted). */
  ranAt: string;
}

export async function parseInSandbox(
  filePath: string,
  label: string,
  requestId: string,
  deps: SandboxDeps,
): Promise<SandboxResult> {
  const f = deps.fetch ?? fetch;
  const started = Date.now();
  const parser = await (deps.parser ?? parserBytes)();
  const bytes = new Uint8Array(await fs.readFile(filePath));

  let lease: SandboxLease;
  try {
    const res = await deps.post('/api/agent/sandbox', {
      studentId: deps.studentId,
      requestId,
      purpose: 'parse_document',
      label: label.slice(0, 200),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    lease = SandboxLease.parse(await res.json());
  } catch (err) {
    throw new SandboxUnavailable(`no sandbox: ${String(err).slice(0, 120)}`);
  }

  const base = lease.dataPlaneUrl.replace(/\/+$/, '');
  const auth = { 'X-Maritime-Token': lease.secret };
  // A fixed name inside the sandbox: the original file name never reaches a command line.
  const ext = (path
    .extname(label)
    .toLowerCase()
    .match(/^\.[a-z0-9]{1,5}$/) ?? [''])[0];
  const inPath = `/tmp/helm/in/doc${ext}`;
  let ok = false;
  let summary = 'not run';
  try {
    for (const [p, body] of [
      ['/tmp/helm/parse.mjs', parser],
      [inPath, bytes],
    ] as const) {
      const put = await f(`${base}/files?path=${encodeURIComponent(p)}`, {
        method: 'PUT',
        headers: { ...auth, 'content-type': 'application/octet-stream' },
        body: Buffer.from(body),
        signal: AbortSignal.timeout(30_000),
      });
      if (!put.ok) throw new SandboxUnavailable(`upload ${put.status}`);
    }
    const run = await f(`${base}/commands`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        cmd: `node /tmp/helm/parse.mjs ${inPath}`,
        background: false,
        timeoutSeconds: 60,
      }),
      signal: AbortSignal.timeout(75_000),
    });
    if (!run.ok) throw new SandboxUnavailable(`run ${run.status}`);
    const cmd = (await run.json()) as { stdout?: string; exitCode?: number | null };
    const out = SandboxParseOutput.safeParse(safeJson(cmd.stdout ?? ''));
    if (!out.success) throw new SandboxUnavailable('parser gave no result');
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    if (!out.data.ok) {
      summary = `${ext.slice(1) || 'file'} rejected in ${secs} s`;
      // The sandbox's verdict stands: the agent never opens this file itself.
      throw new DocumentError(out.data.error);
    }
    ok = true;
    summary = `${ext.slice(1).toUpperCase() || 'file'}, ${out.data.chars.toLocaleString('en-US')} characters, ${secs} s`;
    return {
      text: out.data.text,
      sandboxId: lease.sandboxId,
      ms: Date.now() - started,
      ranAt: new Date().toISOString(),
    };
  } catch (err) {
    if (!(err instanceof DocumentError) && summary === 'not run')
      summary = String(err).slice(0, 120);
    throw err;
  } finally {
    // Always delete it (it would also end by itself after 2 idle minutes).
    await deps
      .post(`/api/agent/sandbox/${encodeURIComponent(lease.sandboxId)}/end`, {
        studentId: deps.studentId,
        ok,
        summary,
      })
      .catch(() => {});
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s.trim());
  } catch {
    return null;
  }
}
