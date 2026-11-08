import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { listAssignments } from '@/lib/assignments';
import { formatWhen } from '@/lib/format';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Demo portal' };

/**
 * DEMO PORTAL (PRD 13): a stand-in for a course website, clearly labelled, imitating no real
 * institution. Helm's agent submits here with its own login; a student signed in to Helm can
 * also submit by hand (the escape hatch every failure alert links to).
 */
export default async function DemoPortal({
  searchParams,
}: {
  searchParams: Promise<{ receipt?: string; error?: string }>;
}) {
  const q = await searchParams;
  const user = await currentUser();
  const db = await getDb();
  const assignments = user
    ? await listAssignments(db, user.id, user.timezone, { review: false })
    : [];
  const subs = user
    ? await db
        .select()
        .from(schema.portalSubmissions)
        .where(eq(schema.portalSubmissions.userId, user.id))
    : [];
  const shown = q.receipt ? (subs.find((s) => s.confirmationId === q.receipt) ?? null) : null;
  return (
    <div className="min-h-dvh bg-neutral-100 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
      <div
        role="note"
        className="bg-neutral-800 px-4 py-2 text-center text-sm font-medium text-white"
      >
        DEMO PORTAL: a fake website for the Helm demo. Not a real school, employer or government
        system. Files are not stored, only their fingerprint.
      </div>
      <main className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-6">
        <header>
          <h1 className="text-2xl font-semibold">Submissions (demo portal)</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            {user
              ? `Signed in as ${user.name || user.email} (demo sign-on through Helm)`
              : 'Sign in to Helm first to use the demo portal.'}
          </p>
        </header>

        {q.error === 'late' && (
          <p
            role="alert"
            className="rounded border border-red-700 bg-red-50 px-3 py-2 text-red-900"
          >
            The deadline has passed. This portal no longer accepts submissions for it.
          </p>
        )}
        {q.error === 'already' && (
          <p
            role="alert"
            className="rounded border border-amber-700 bg-amber-50 px-3 py-2 text-amber-900"
          >
            This assignment already has a submission.
          </p>
        )}
        {shown && (
          <section
            aria-labelledby="conf-h"
            className="rounded border border-green-700 bg-green-50 px-4 py-3 text-green-950"
          >
            <h2 id="conf-h" className="font-semibold">
              Submission received
            </h2>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-sm">
              <dt>Confirmation</dt>
              <dd className="font-mono">{shown.confirmationId}</dd>
              <dt>File</dt>
              <dd>{shown.fileName}</dd>
              <dt>Received</dt>
              <dd>{formatWhen(shown.submittedAt, user!.timezone)}</dd>
              <dt>Fingerprint</dt>
              <dd className="truncate font-mono">{shown.fileSha256}</dd>
            </dl>
          </section>
        )}

        {user && (
          <ul className="flex flex-col gap-3">
            {assignments.map((a) => {
              const done = subs.find((s) => s.assignmentId === a.id);
              const open = a.dueAt && new Date(a.dueAt).getTime() > Date.now();
              return (
                <li
                  key={a.id}
                  className="rounded border border-neutral-300 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-800"
                >
                  <p className="font-medium">
                    {a.courseCode ? `${a.courseCode}: ` : ''}
                    {a.title}
                  </p>
                  <p className="text-sm text-neutral-600 dark:text-neutral-300">
                    Due {a.dueAt ? formatWhen(a.dueAt, user.timezone) : 'n/a'}
                  </p>
                  {done ? (
                    <p className="mt-2 text-sm text-green-800 dark:text-green-300">
                      Submitted {formatWhen(done.submittedAt, user.timezone)} · {done.fileName} ·
                      confirmation <span className="font-mono">{done.confirmationId}</span>
                      {done.via === 'agent' ? ' · by Helm' : ''}
                    </p>
                  ) : open ? (
                    <form
                      method="post"
                      action="/mock-portal/api/submit"
                      encType="multipart/form-data"
                      className="mt-2 flex flex-wrap items-center gap-2"
                    >
                      <input type="hidden" name="assignmentId" value={a.id} />
                      <label className="sr-only" htmlFor={`f-${a.id}`}>
                        File for {a.title}
                      </label>
                      <input
                        id={`f-${a.id}`}
                        type="file"
                        name="file"
                        required
                        className="min-h-11 text-sm"
                      />
                      <button
                        type="submit"
                        className="min-h-11 rounded bg-neutral-800 px-4 font-medium text-white focus-visible:outline-3 focus-visible:outline-offset-2"
                      >
                        Submit
                      </button>
                    </form>
                  ) : (
                    <p className="mt-2 text-sm">Closed.</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-sm">
          <a href="/today" className="underline underline-offset-4">
            Back to Helm
          </a>
        </p>
      </main>
    </div>
  );
}
