import { z } from 'zod';
import { ExtractedAssignment as ExtractedAssignmentRef } from './domain';

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
export type IntakeResultRequest = z.infer<typeof IntakeResultRequest>;
