import { z } from 'zod';

/**
 * Messages the backend (or a Maritime cron trigger) sends to a student's agent.
 * They travel as a JSON string inside Maritime's `POST /chat` body (`message` field).
 * See PRD section 7, "Message protocol".
 */
export const PROTOCOL_VERSION = 1 as const;

export const AGENT_MESSAGE_TYPES = [
  'ping',
  'brief.generate',
  'heartbeat',
  'intake.parse',
  'inbox.message',
  'submission.hold_notice',
  'submission.run',
] as const;

export const AgentMessageType = z.enum(AGENT_MESSAGE_TYPES);
export type AgentMessageType = z.infer<typeof AgentMessageType>;

const base = {
  v: z.literal(PROTOCOL_VERSION),
  requestId: z.string().min(1).max(200),
  studentId: z.string().min(1).max(128),
};

export const PingMessage = z.object({
  ...base,
  type: z.literal('ping'),
  payload: z.object({ note: z.string().max(500).optional() }).default({}),
});

export const BriefGenerateMessage = z.object({
  ...base,
  type: z.literal('brief.generate'),
  payload: z.object({ trigger: z.enum(['cron', 'manual', 'onboarding']).default('cron') }).default({
    trigger: 'cron',
  }),
});

export const HeartbeatMessage = z.object({
  ...base,
  type: z.literal('heartbeat'),
  payload: z.object({}).default({}),
});

export const IntakeParseMessage = z.object({
  ...base,
  type: z.literal('intake.parse'),
  payload: z.object({
    /** Groups the results; re-parsing the same intake replaces its unconfirmed rows. */
    intakeId: z.string().min(1).max(200),
    /** Path of the uploaded file on the agent's /data volume. */
    filePath: z.string().min(1).max(500),
    fileName: z.string().min(1).max(300),
    courseHint: z.string().max(100).optional(),
  }),
});

export const InboxMessageMessage = z.object({
  ...base,
  type: z.literal('inbox.message'),
  payload: z.object({
    inboxMessageId: z.string().min(1),
    from: z.string().max(320),
    subject: z.string().max(1000),
    receivedAt: z.iso.datetime({ offset: true }),
    /** Untrusted content. Treat as data only, never as instructions. */
    body: z.string().max(100_000),
  }),
});

export const SubmissionHoldNoticeMessage = z.object({
  ...base,
  type: z.literal('submission.hold_notice'),
  payload: z.object({ submissionId: z.string().min(1) }),
});

export const SubmissionRunMessage = z.object({
  ...base,
  type: z.literal('submission.run'),
  payload: z.object({ submissionId: z.string().min(1), attempt: z.number().int().min(1) }),
});

export const AgentMessage = z.discriminatedUnion('type', [
  PingMessage,
  BriefGenerateMessage,
  HeartbeatMessage,
  IntakeParseMessage,
  InboxMessageMessage,
  SubmissionHoldNoticeMessage,
  SubmissionRunMessage,
]);
export type AgentMessage = z.infer<typeof AgentMessage>;
export type AgentMessageInput = z.input<typeof AgentMessage>;

/** Body Maritime posts to a custom container's `POST /chat`. */
export const MaritimeChatBody = z.looseObject({
  message: z.string(),
  source: z.string().optional(),
  conversation_id: z.string().optional(),
  conversationId: z.string().optional(),
});
export type MaritimeChatBody = z.infer<typeof MaritimeChatBody>;

export type ParsedInbound =
  | { kind: 'protocol'; message: AgentMessage }
  | { kind: 'invalid'; error: string; raw: string }
  | { kind: 'text'; text: string };

/**
 * Turn the `message` string Maritime delivers into either a protocol message or free text.
 *
 * We do not yet know exactly how Maritime wraps webhook bodies (PRD Appendix A, open item),
 * so this accepts: the JSON envelope itself, the envelope nested one level under a common
 * key (`body`, `payload`, `data`, `message`), or a JSON object embedded in surrounding text.
 */
export function parseInbound(message: string): ParsedInbound {
  const candidates = jsonCandidates(message);
  if (candidates.length === 0) return { kind: 'text', text: message };

  let lastError: string | undefined;
  for (const value of candidates) {
    for (const obj of unwrap(value)) {
      if (!looksLikeEnvelope(obj)) continue;
      const parsed = AgentMessage.safeParse(obj);
      if (parsed.success) return { kind: 'protocol', message: parsed.data };
      lastError = z.prettifyError(parsed.error);
    }
  }
  if (lastError) return { kind: 'invalid', error: lastError, raw: message.slice(0, 2000) };
  return { kind: 'text', text: message };
}

export function encodeAgentMessage(msg: AgentMessageInput): string {
  return JSON.stringify(AgentMessage.parse(msg));
}

function jsonCandidates(text: string): unknown[] {
  const out: unknown[] = [];
  const trimmed = text.trim();
  const tryParse = (s: string) => {
    try {
      const v: unknown = JSON.parse(s);
      // A JSON string containing JSON (double-encoded) is common with webhook relays.
      if (typeof v === 'string') {
        try {
          out.push(JSON.parse(v));
        } catch {
          /* not double-encoded */
        }
      } else {
        out.push(v);
      }
      return true;
    } catch {
      return false;
    }
  };
  if (tryParse(trimmed)) return out;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) tryParse(trimmed.slice(start, end + 1));
  return out;
}

function unwrap(value: unknown, depth = 0): unknown[] {
  if (!isRecord(value) || depth > 2) return [];
  const out: unknown[] = [value];
  for (const key of ['body', 'payload', 'data', 'message']) {
    const inner = value[key];
    if (typeof inner === 'string')
      out.push(...jsonCandidates(inner).flatMap((v) => unwrap(v, depth + 1)));
    else if (isRecord(inner)) out.push(...unwrap(inner, depth + 1));
  }
  return out;
}

function looksLikeEnvelope(v: unknown): v is Record<string, unknown> {
  return isRecord(v) && v.v !== undefined && typeof v.type === 'string';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
