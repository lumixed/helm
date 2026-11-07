import { z } from 'zod';
import { AssignmentStatus } from './domain';

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

export const BriefContent = z.object({
  /** Local date in the student's timezone, YYYY-MM-DD. */
  forDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Short human opener, written by the LLM (or a template). Never reorders items. */
  summary: z.string().max(800),
  focus: z.array(BriefItem).max(3),
  dueSoon: z.array(BriefItem).max(20),
  changes: AgentState.shape.changes,
  /** "About 4h planned" style line. */
  capacity: z.string().max(200),
  trigger: z.enum(['cron', 'manual', 'onboarding']),
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
