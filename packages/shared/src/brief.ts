import { z } from 'zod';
import { AssignmentStatus } from './domain';
import { WorkBlock } from './plan';

/** One open assignment as the agent sees it (no syllabus text, no files). */
export const StateAssignment = z.object({
  id: z.string(),
  courseCode: z.string().nullable(),
  title: z.string(),
  dueAt: z.string().nullable(),
  weightPct: z.number().nullable(),
  estMinutes: z.number().nullable(),
  progressPct: z.number(),
  status: AssignmentStatus,
  /** For the money line (older backends omit these). */
  type: z.string().optional(),
  amountCents: z.number().int().nullable().optional(),
  currency: z.string().nullable().optional(),
});
export type StateAssignment = z.infer<typeof StateAssignment>;

/** GET /api/agent/state: what the agent needs for a brief or heartbeat. */
export const AgentState = z.object({
  studentId: z.string(),
  name: z.string(),
  timezone: z.string(),
  briefTimeLocal: z.string(),
  assignments: z.array(StateAssignment),
  /** Changes applied since the last brief (deadline moves etc.), newest first. */
  changes: z.array(
    z.object({
      title: z.string(),
      field: z.string(),
      oldValue: z.string().nullable(),
      newValue: z.string().nullable(),
      source: z.string(),
      at: z.string(),
    }),
  ),
});
export type AgentState = z.infer<typeof AgentState>;

export const BriefItem = z.object({
  assignmentId: z.string(),
  courseCode: z.string().nullable(),
  title: z.string(),
  dueAt: z.string(),
  why: z.string(),
  /** Suggested minutes to spend today. */
  minutes: z.number().int().min(0),
  overdue: z.boolean(),
});
export type BriefItem = z.infer<typeof BriefItem>;

/** One event from the person's own calendar (Google Calendar, read-only), for today's brief. */
export const ScheduleItem = z.object({
  title: z.string().max(200),
  start: z.string(),
  end: z.string().nullable(),
  allDay: z.boolean(),
  location: z.string().max(200).optional(),
});
export type ScheduleItem = z.infer<typeof ScheduleItem>;

export const BriefContent = z.object({
  /** Local date in the student's timezone, YYYY-MM-DD. */
  forDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Short human opener, written by the LLM (or a template). Never reorders items. */
  summary: z.string().max(800),
  focus: z.array(BriefItem).max(3),
  dueSoon: z.array(BriefItem).max(20),
  changes: AgentState.shape.changes,
  /** Today's calendar events, when Google Calendar is connected (older briefs: none). */
  schedule: z.array(ScheduleItem).max(30).default([]),
  /** When to work on what today, placed by code around the calendar (older briefs: none). */
  blocks: z.array(WorkBlock).max(20).default([]),
  /** Minutes of today's focus work that did not fit in the day. */
  unplannedMinutes: z.number().int().min(0).default(0),
  /** Bills due in the next 7 days with known amounts, totalled by code. */
  money: z
    .object({
      totalCents: z.number().int(),
      currency: z.string(),
      items: z
        .array(z.object({ title: z.string(), amountCents: z.number().int(), dueAt: z.string() }))
        .max(20),
    })
    .nullable()
    .default(null),
  /** "About 4h planned" style line. */
  capacity: z.string().max(200),
  trigger: z.enum(['cron', 'manual', 'onboarding', 'change']),
  /** Which model wrote the summary, or "template". */
  writer: z.string().max(100),
});
export type BriefContent = z.infer<typeof BriefContent>;

export const BriefRequest = z.object({
  studentId: z.string().min(1).max(128),
  requestId: z.string().min(1).max(200),
  brief: BriefContent,
});
export type BriefRequest = z.infer<typeof BriefRequest>;
