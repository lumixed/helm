import { z } from 'zod';
import { ExtractedAssignment as ExtractedAssignmentRef } from './domain';
import { ReminderRule as ReminderRuleRef } from './reminders';

/**
 * Everything the agent reports back to the backend. These become the Agent timeline (M8).
 * Sent to `POST /api/agent/events` with `Authorization: Bearer <HELM_AGENT_TOKEN>`.
 */
export const AGENT_EVENT_TYPES = [
  'agent.woke',
  'agent.pong',
  'agent.error',
  'intake.parsed',
  'brief.generated',
  'brief.failed',
  'chat.replied',
  'routine.sent',
  'inbox.classified',
  'change.detected',
  'change.applied',
  'plan.updated',
  'submission.scheduled',
  'submission.hold_notice_sent',
  'submission.held',
  'submission.released',
  'submission.cancelled',
  'submission.retrying',
  'submission.adjusted',
  'submission.checks_run',
  'submission.submitted',
  'submission.failed',
  'alert.sent',
  'desktop.takeover',
  'desktop.checked',
  'egress.blocked',
  'egress.allowed',
  'sandbox.created',
  'sandbox.command',
  'sandbox.ended',
  'reminder.set',
  'reminder.fired',
  'review.written',
  'followup.found',
  'followup.drafted',
  'calendar.blocks_added',
  'website.started',
  'website.waiting',
  'website.approved',
  'website.finished',
] as const;

export const AgentEventType = z.enum(AGENT_EVENT_TYPES);
export type AgentEventType = z.infer<typeof AgentEventType>;

export const AgentEvent = z.object({
  /** Unique per event. Backend dedupes on (studentId, eventId). */
  eventId: z.string().min(1).max(200),
  /** The inbound message this event answers, if any. */
  requestId: z.string().max(200).optional(),
  type: AgentEventType,
  /** Short human reason shown in the timeline, e.g. "Woke for morning brief". */
  reason: z.string().max(500),
  occurredAt: z.iso.datetime({ offset: true }),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type AgentEvent = z.infer<typeof AgentEvent>;
export type AgentEventInput = z.input<typeof AgentEvent>;

export const AgentEventsRequest = z.object({
  studentId: z.string().min(1).max(128),
  events: z.array(AgentEvent).min(1).max(100),
});
export type AgentEventsRequest = z.infer<typeof AgentEventsRequest>;

export const AgentEventsResponse = z.object({
  accepted: z.number().int(),
  duplicates: z.number().int(),
});
export type AgentEventsResponse = z.infer<typeof AgentEventsResponse>;

/** Agent -> backend: results of reading one syllabus (PRD M3). Only structured data, no raw text. */
export const IntakeResultRequest = z.object({
  studentId: z.string().min(1).max(128),
  requestId: z.string().min(1).max(200),
  /** The intake this answers; replaces earlier unconfirmed rows from the same intake. */
  intakeId: z.string().min(1).max(200),
  fileName: z.string().max(300),
  model: z.string().max(100),
  assignments: z.array(z.lazy(() => ExtractedAssignmentRef)).max(200),
  warnings: z.array(z.string().max(500)).max(50),
});
/** Agent -> backend: the person asked in chat for something done on a website. It waits for Start. */
export const WebTaskProposeRequest = z.object({
  studentId: z.string().min(1).max(128),
  requestId: z.string().min(1).max(200),
  instruction: z.string().min(5).max(1000),
  url: z.string().min(1).max(500),
});
export type WebTaskProposeRequest = z.infer<typeof WebTaskProposeRequest>;

/** Agent -> backend: the person asked for a reminder in chat. */
export const ReminderCreateRequest = z.object({
  studentId: z.string().min(1).max(128),
  requestId: z.string().min(1).max(200),
  title: z.string().min(1).max(120),
  rule: ReminderRuleRef,
});
export type ReminderCreateRequest = z.infer<typeof ReminderCreateRequest>;

/** Agent -> backend: a reminder's Maritime cron woke the agent; tell the person. */
export const ReminderFiredRequest = z.object({
  studentId: z.string().min(1).max(128),
  requestId: z.string().min(1).max(200),
  reminderId: z.string().min(1).max(64),
  occurrenceAt: z.iso.datetime({ offset: true }),
});
export type ReminderFiredRequest = z.infer<typeof ReminderFiredRequest>;

export type IntakeResultRequest = z.infer<typeof IntakeResultRequest>;
