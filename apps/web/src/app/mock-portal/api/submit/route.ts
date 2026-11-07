import { createHash, randomUUID } from 'node:crypto';
import { MAX_SUBMISSION_BYTES } from '@helm/shared';
import { getDb } from '@/db';
import { fail, json } from '@/lib/http';
import { portalSubmit, receiptJson } from '@/lib/portal';
import { portalUser } from '@/lib/portal-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * DEMO PORTAL submit (multipart: file, assignmentId, idempotencyKey). Rejects late and duplicate
 * submissions, and fails on purpose when the demo failure switch is on. Keeps only a hash.
 */
export async function POST(req: Request): Promise<Response> {
  const who = await portalUser(req);
  if (!who) return fail(401, 'Sign in to the demo portal.');
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, 'Expected a multipart form.');
  }
  const file = form.get('file');
  const assignmentId = String(form.get('assignmentId') ?? '');
  const manual = who.via === 'manual';
  const idempotencyKey = String(form.get('idempotencyKey') ?? '') || (manual ? randomUUID() : '');
  if (!(file instanceof File)) return fail(400, 'Attach a file.');
  if (!idempotencyKey) return fail(400, 'idempotencyKey is required.');
  if (file.size === 0) return fail(400, 'The file is empty.');
  if (file.size > MAX_SUBMISSION_BYTES) return fail(413, 'The file is too large.');
  const bytes = Buffer.from(await file.arrayBuffer());
  const r = await portalSubmit(await getDb(), who.userId, {
    assignmentId,
    idempotencyKey: idempotencyKey.slice(0, 200),
    fileName: file.name,
    fileSize: bytes.length,
    fileSha256: createHash('sha256').update(bytes).digest('hex'),
    via: who.via,
  });
  const back = (q: string) => Response.redirect(new URL(`/mock-portal?${q}`, req.url), 303);
  switch (r.kind) {
    case 'unavailable':
      if (r.mode === 'timeout') await new Promise((res) => setTimeout(res, 25_000));
      return fail(503, 'The demo portal is down (failure injected for the demo).');
    case 'late':
      return manual
        ? back('error=late')
        : fail(422, 'The deadline has passed. The portal no longer accepts submissions.');
    case 'not_found':
      return fail(404, 'No such assignment.');
    case 'already_submitted':
      return manual
        ? back(`receipt=${r.receipt.confirmationId}&error=already`)
        : json(
            { error: 'This assignment already has a submission.', receipt: receiptJson(r.receipt) },
            409,
          );
    case 'duplicate':
      return manual
        ? back(`receipt=${r.receipt.confirmationId}`)
        : json({ receipt: receiptJson(r.receipt), duplicate: true });
    case 'accepted':
      return manual
        ? back(`receipt=${r.receipt.confirmationId}`)
        : json({ receipt: receiptJson(r.receipt), duplicate: false }, 201);
  }
}
