'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { AssignmentView } from '@/lib/assignments';
import { Button, Card, inputClass } from './ui';

const TYPES = ['assignment', 'quiz', 'exam', 'project', 'lab', 'reading', 'presentation', 'other'];

export function ReviewList({ intakeId }: { intakeId?: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<AssignmentView[] | null>(null);
  const [keep, setKeep] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/assignments?review=1', { cache: 'no-store' });
      const data = (await res.json()) as { assignments: AssignmentView[] };
      const list = intakeId
        ? data.assignments.filter((a) => a.sourceRef === intakeId)
        : data.assignments;
      setRows(list);
      // Undated rows can't be planned yet, and past ones were probably handled already (a syllabus
      // added mid-term). Both start unticked; the student can tick them to keep them.
      const now = Date.now();
      setKeep(
        Object.fromEntries(
          list.map((a) => [a.id, a.dueAt !== null && new Date(a.dueAt).getTime() > now]),
        ),
      );
    })();
  }, [intakeId]);

  const byCourse = useMemo(() => {
    const m = new Map<string, AssignmentView[]>();
    for (const r of rows ?? [])
      m.set(r.courseCode ?? 'Other', [...(m.get(r.courseCode ?? 'Other') ?? []), r]);
    return [...m.entries()];
  }, [rows]);

  async function save(id: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/assignments/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      setError(
        ((await res.json().catch(() => ({}))) as { error?: string }).error ??
          'Could not save that change.',
      );
      return;
    }
    const { assignment } = (await res.json()) as { assignment: AssignmentView };
    setRows((rs) => rs?.map((r) => (r.id === id ? assignment : r)) ?? null);
    setError(null);
  }

  async function confirm() {
    setBusy(true);
    const ids = (rows ?? []).map((r) => r.id);
    const res = await fetch('/api/assignments/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        keepIds: ids.filter((i) => keep[i]),
        dropIds: ids.filter((i) => !keep[i]),
      }),
    });
    setBusy(false);
    if (!res.ok) return setError('Could not confirm. Please try again.');
    router.push('/today');
  }

  if (!rows) return <p aria-live="polite">Loading what your agent found…</p>;
  if (rows.length === 0)
    return (
      <Card>
        <p>Nothing to review. Add a document to get started.</p>
      </Card>
    );

  const kept = rows.filter((r) => keep[r.id]).length;
  const isPast = (r: AssignmentView) =>
    r.dueAt !== null && new Date(r.dueAt).getTime() <= Date.now();
  const past = rows.filter(isPast).length;
  const flagged = rows.filter((r) => !isPast(r) && (r.lowConfidence || !r.dueLocal)).length;
  return (
    <div className="flex flex-col gap-5">
      <p>
        Your agent found <strong>{rows.length}</strong> deadlines.{' '}
        {flagged > 0 ? (
          <>
            <strong>{flagged}</strong> {flagged === 1 ? 'needs' : 'need'} a quick check.
          </>
        ) : (
          'Check them, fix anything wrong, then confirm.'
        )}
        {past > 0 &&
          ` ${past} ${past === 1 ? 'is' : 'are'} already past and left out; tick ${past === 1 ? 'it' : 'any'} you still need to do.`}
      </p>
      {byCourse.map(([course, list]) => (
        <section key={course} aria-labelledby={`c-${course}`} className="flex flex-col gap-3">
          <h2 id={`c-${course}`} className="text-lg font-semibold">
            {course}
          </h2>
          {list.map((a) => {
            const pastRow = isPast(a);
            const check = !pastRow && (a.lowConfidence || !a.dueLocal);
            return (
              <Card
                key={a.id}
                className={
                  check ? 'ring-2 ring-amber-500' : pastRow && !keep[a.id] ? 'opacity-70' : ''
                }
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    aria-label={`Keep ${a.title}`}
                    checked={keep[a.id] ?? false}
                    onChange={(e) => setKeep((k) => ({ ...k, [a.id]: e.target.checked }))}
                    className="mt-3 h-5 w-5 shrink-0"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    {pastRow && (
                      <span className="w-fit rounded-full bg-slate-200 px-2 py-0.5 text-sm font-medium text-slate-800">
                        Already past
                      </span>
                    )}
                    {check && (
                      <span className="w-fit rounded-full bg-amber-100 px-2 py-0.5 text-sm font-medium text-amber-900">
                        {a.dueLocal ? 'Check this' : 'Needs a date'}
                      </span>
                    )}
                    <label className="sr-only" htmlFor={`t-${a.id}`}>
                      Title
                    </label>
                    <input
                      id={`t-${a.id}`}
                      defaultValue={a.title}
                      onBlur={(e) =>
                        e.target.value !== a.title && save(a.id, { title: e.target.value })
                      }
                      className={`${inputClass} font-medium`}
                    />
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_7rem_9rem]">
                      <label className="flex flex-col gap-1 text-sm">
                        Due
                        <input
                          type="datetime-local"
                          defaultValue={a.dueLocal ?? ''}
                          onBlur={(e) =>
                            (e.target.value || null) !== a.dueLocal &&
                            save(a.id, { dueLocal: e.target.value || null })
                          }
                          className={inputClass}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm">
                        Weight %
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step="0.5"
                          defaultValue={a.weightPct ?? ''}
                          onBlur={(e) => {
                            const v = e.target.value === '' ? null : Number(e.target.value);
                            if (v !== a.weightPct) void save(a.id, { weightPct: v });
                          }}
                          className={inputClass}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm">
                        Type
                        <select
                          defaultValue={a.type}
                          onChange={(e) => save(a.id, { type: e.target.value })}
                          className={inputClass}
                        >
                          {TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {a.assumption && <p className="text-sm">⚠︎ {a.assumption}</p>}
                    {a.evidence && (
                      <p className="text-sm text-sea-800/80 italic dark:text-sea-100/80">
                        From the source: “{a.evidence}”
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </section>
      ))}
      <div aria-live="polite">
        {error && (
          <p role="alert" className="text-flare">
            {error}
          </p>
        )}
      </div>
      <div className="sticky bottom-0 -mx-5 bg-sea-50/95 px-5 py-3 backdrop-blur dark:bg-sea-950/95">
        <Button onClick={confirm} disabled={busy || kept === 0} className="w-full">
          {busy ? 'Saving…' : `Confirm ${kept} deadline${kept === 1 ? '' : 's'}`}
        </Button>
      </div>
    </div>
  );
}
