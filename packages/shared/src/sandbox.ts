import { z } from 'zod';

/**
 * Throwaway sandboxes for untrusted files (PRD v2 WP-6). The backend creates the sandbox with
 * its key and hands the agent only that sandbox's data-plane address and per-sandbox secret.
 */
export const SandboxLeaseRequest = z.object({
  studentId: z.string().min(1).max(128),
  requestId: z.string().min(1).max(200),
  purpose: z.enum(['parse_document']),
  /** Shown on the timeline ("syllabus.pdf"). */
  label: z.string().max(200),
});
export type SandboxLeaseRequest = z.infer<typeof SandboxLeaseRequest>;

export const SandboxLease = z.object({
  sandboxId: z.string(),
  dataPlaneUrl: z.url(),
  secret: z.string().min(1),
});
export type SandboxLease = z.infer<typeof SandboxLease>;

export const SandboxEndRequest = z.object({
  studentId: z.string().min(1).max(128),
  ok: z.boolean(),
  /** Content-free: file kind, size of the text, time taken, or the error. */
  summary: z.string().max(300),
});
export type SandboxEndRequest = z.infer<typeof SandboxEndRequest>;

/** What the sandbox parser prints on stdout (agent/src/sandbox/parse.ts). */
export const SandboxParseOutput = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    text: z.string(),
    chars: z.number().int(),
    truncated: z.boolean(),
  }),
  z.object({ ok: z.literal(false), error: z.string(), detail: z.string().optional() }),
]);
export type SandboxParseOutput = z.infer<typeof SandboxParseOutput>;
