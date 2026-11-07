/**
 * Deterministic brief ranking (PRD section 11). The LLM may reword the `why`, never reorder.
 * Unit tests in ranking.test.ts lock this behaviour; change constants deliberately.
 */
export const RANKING = {
  urgencyWeight: 0.5,
  weightWeight: 0.3,
  effortWeight: 0.2,
  /** Assignments worth this much or more count as maximum weight. */
  weightCapPct: 30,
  /** Share of the remaining time a student can realistically spend on one item. */
  usableFraction: 0.25,
  /** Floor for hours left, so overdue and due-now items don't divide by zero. */
  minHoursLeft: 0.25,
  /** Used when a syllabus gives no weight or effort. */
  defaultWeightPct: 5,
  defaultEstMinutes: 120,
} as const;

export interface RankInput {
  id: string;
  title: string;
  dueAt: Date | string | null;
  weightPct?: number | null;
  estMinutes?: number | null;
  progressPct?: number | null;
  status: 'todo' | 'in_progress' | 'done' | 'submitted' | 'cancelled';
}

export interface Ranked<T extends RankInput = RankInput> {
  item: T;
  score: number;
  overdue: boolean;
  hoursLeft: number;
  remainingMinutes: number;
  why: string;
}

const HOUR = 3_600_000;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function isOpen(a: Pick<RankInput, 'status'>): boolean {
  return a.status === 'todo' || a.status === 'in_progress';
}

export function scoreAssignment<T extends RankInput>(a: T, now: Date): Ranked<T> | null {
  if (!isOpen(a) || a.dueAt == null) return null;
  const due = typeof a.dueAt === 'string' ? new Date(a.dueAt) : a.dueAt;
  const rawHours = (due.getTime() - now.getTime()) / HOUR;
  const overdue = rawHours < 0;
  const hoursLeft = Math.max(rawHours, RANKING.minHoursLeft);

  const est = a.estMinutes ?? RANKING.defaultEstMinutes;
  const progress = clamp(a.progressPct ?? 0, 0, 100);
  const remainingMinutes = Math.round(est * (1 - progress / 100));
  const remainingHours = remainingMinutes / 60;

  const urgency = 1 / (1 + hoursLeft / 24);
  const weightN = Math.min((a.weightPct ?? RANKING.defaultWeightPct) / RANKING.weightCapPct, 1);
  const effortPressure = clamp(remainingHours / (hoursLeft * RANKING.usableFraction), 0, 1);
  const score =
    RANKING.urgencyWeight * urgency +
    RANKING.weightWeight * weightN +
    RANKING.effortWeight * effortPressure;

  return {
    item: a,
    score,
    overdue,
    hoursLeft: rawHours,
    remainingMinutes,
    why: explain({
      overdue,
      rawHours,
      weightPct: a.weightPct ?? null,
      remainingMinutes,
      effortPressure,
    }),
  };
}

/**
 * Open items with a due date, best first. Overdue items always come first (PRD section 11),
 * then by score; ties go to the earlier due date, then the id.
 */
export function rankAssignments<T extends RankInput>(items: T[], now: Date): Ranked<T>[] {
  return items
    .map((a) => scoreAssignment(a, now))
    .filter((r): r is Ranked<T> => r !== null)
    .sort(
      (x, y) =>
        Number(y.overdue) - Number(x.overdue) ||
        y.score - x.score ||
        x.hoursLeft - y.hoursLeft ||
        (x.item.id < y.item.id ? -1 : x.item.id > y.item.id ? 1 : 0),
    );
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.max(minutes, 0)} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatHoursLeft(h: number): string {
  if (h < 1) return `due in ${Math.max(Math.round(h * 60), 1)} min`;
  if (h < 48) return `due in ${Math.round(h)}h`;
  return `due in ${Math.round(h / 24)} days`;
}

function explain(p: {
  overdue: boolean;
  rawHours: number;
  weightPct: number | null;
  remainingMinutes: number;
  effortPressure: number;
}): string {
  const parts = [p.overdue ? 'Overdue' : capitalize(formatHoursLeft(p.rawHours))];
  if (p.weightPct != null && p.weightPct >= 10) parts.push(`worth ${round1(p.weightPct)}%`);
  if (p.remainingMinutes > 0)
    parts.push(`about ${formatDuration(p.remainingMinutes)} of work left`);
  if (!p.overdue && p.effortPressure >= 0.8) parts.push('tight for the time left');
  return parts.join(', ');
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const round1 = (n: number) => Math.round(n * 10) / 10;
