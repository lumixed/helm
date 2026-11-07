// Live eval of syllabus extraction against fixtures/syllabi/expected.json (PRD M3: >=90% of due
// dates correct). Needs GEMINI_API_KEY. Not part of CI.
//   pnpm --filter @helm/agent eval [model,model]
import fs from 'node:fs';
import path from 'node:path';
import { utcToLocal } from '@helm/shared';
import { extractDeadlines } from '../src/tools/extract';

interface Expected {
  course: string;
  title: string;
  dueLocal: string;
  weightPct?: number;
  dueDateOnly?: boolean;
}

const dir = path.join(import.meta.dirname, '../fixtures/syllabi');
const truth = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8')) as Record<
  string,
  { timezone: string; rows: Expected[] }
>;
const models = process.argv[2]?.split(',');
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error('Set GEMINI_API_KEY');

let total = 0;
let dateOk = 0;
let weightOk = 0;
for (const [file, spec] of Object.entries(truth)) {
  if (file.startsWith('_')) continue;
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  const t0 = Date.now();
  const out = await extractDeadlines(
    text,
    { timezone: spec.timezone, today: '2026-11-07' },
    { apiKey, models },
  );
  console.log(
    `\n${file}: ${out.assignments.length} rows from ${out.model} in ${Date.now() - t0} ms`,
  );
  const pool = [...out.assignments];
  for (const exp of spec.rows) {
    total++;
    const i = pool.findIndex(
      (a) =>
        a.courseCode === exp.course &&
        a.title.toLowerCase().includes(exp.title.toLowerCase()) &&
        a.dueAt &&
        (exp.dueDateOnly
          ? utcToLocal(new Date(a.dueAt), spec.timezone).slice(0, 10) === exp.dueLocal.slice(0, 10)
          : utcToLocal(new Date(a.dueAt), spec.timezone) === exp.dueLocal),
    );
    const hit = i >= 0 ? pool.splice(i, 1)[0]! : undefined;
    const near = hit ?? pool.find((a) => a.title.toLowerCase().includes(exp.title.toLowerCase()));
    const got = near?.dueAt ? utcToLocal(new Date(near.dueAt), spec.timezone) : 'none';
    const wOk = hit != null && (exp.weightPct == null || hit.weightPct === exp.weightPct);
    if (hit) dateOk++;
    if (wOk) weightOk++;
    console.log(
      `  ${hit ? 'OK  ' : 'MISS'} ${exp.title.padEnd(16)} want ${exp.dueLocal} got ${got}  weight ${near?.weightPct ?? '-'}${wOk ? '' : ` (want ${exp.weightPct})`}  conf ${near?.confidence ?? '-'}`,
    );
  }
  for (const extra of pool)
    console.log(
      `  EXTRA ${extra.title} ${extra.dueAt ? utcToLocal(new Date(extra.dueAt), spec.timezone) : 'no date'} conf ${extra.confidence}`,
    );
  for (const w of out.warnings) console.log(`  warning: ${w}`);
}
console.log(
  `\nDue dates correct: ${dateOk}/${total} (${Math.round((100 * dateOk) / total)}%)  weights correct: ${weightOk}/${total}`,
);
process.exit(dateOk / total >= 0.9 ? 0 : 1);
