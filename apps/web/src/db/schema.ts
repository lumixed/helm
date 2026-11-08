import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { AGENT_EVENT_TYPES, ASSIGNMENT_STATUSES, ASSIGNMENT_TYPES } from '@helm/shared';

/** PRD section 9. All times are stored in UTC; the student's timezone is applied at display. */

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const userRef = () =>
  uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });

export const channelEnum = pgEnum('channel', ['in_app', 'telegram']);
export const agentStatusEnum = pgEnum('agent_status', [
  'provisioning',
  'ready',
  'asleep',
  'error',
  'deleting',
]);
export const assignmentStatusEnum = pgEnum('assignment_status', ASSIGNMENT_STATUSES);
export const assignmentTypeEnum = pgEnum('assignment_type', ASSIGNMENT_TYPES);
export const assignmentSourceEnum = pgEnum('assignment_source', [
  'syllabus',
  'ics',
  'email',
  'manual',
]);
export const submissionStatusEnum = pgEnum('submission_status', [
  'draft',
  'checks_failed',
  'ready',
  'scheduled',
  'held',
  'submitting',
  'submitted',
  'failed',
  'cancelled',
]);
export const agentEventTypeEnum = pgEnum('agent_event_type', AGENT_EVENT_TYPES);

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    name: text('name').notNull().default(''),
    timezone: text('timezone').notNull().default('America/Vancouver'),
    briefTimeLocal: text('brief_time_local').notNull().default('07:30'),
    channel: channelEnum('channel').notNull().default('in_app'),
    telegramChatId: text('telegram_chat_id'),
    /** Gmail address connected read-only. The token itself lives only in the agent's encrypted env. */
    gmailAddress: text('gmail_address'),
    gmailConnectedAt: timestamp('gmail_connected_at', { withTimezone: true }),
    onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  // Emails are stored lowercased by the app, so a plain unique index is enough.
  (t) => [uniqueIndex('users_email_uq').on(t.email)],
);

export const agents = pgTable(
  'agents',
  {
    id: id(),
    userId: userRef(),
    maritimeAgentId: text('maritime_agent_id'),
    status: agentStatusEnum('status').notNull().default('provisioning'),
    /** Only a SHA-256 hash of the agent token is stored (PRD section 16). */
    agentTokenHash: text('agent_token_hash').notNull(),
    lastError: text('last_error'),
    configWrittenAt: timestamp('config_written_at', { withTimezone: true }),
    /** Hash of the settings file last written, so changes (e.g. a new app URL) are re-sent. */
    configHash: text('config_hash'),
    /** Hash of the egress allowlist last applied at Maritime (PRD v2 WP-5). */
    networkHash: text('network_hash'),
    /** When the demo-portal login was put in the agent's encrypted env (WP-0.5). */
    portalEnvAt: timestamp('portal_env_at', { withTimezone: true }),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('agents_user_uq').on(t.userId),
    uniqueIndex('agents_token_hash_uq').on(t.agentTokenHash),
  ],
);

export const courses = pgTable(
  'courses',
  {
    id: id(),
    userId: userRef(),
    code: text('code').notNull(),
    name: text('name').notNull().default(''),
    instructor: text('instructor'),
    scheduleJson: jsonb('schedule_json').$type<CourseMeeting[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  // Course codes are normalized ("DATA 210") before writing, so a plain index is enough.
  (t) => [uniqueIndex('courses_user_code_key').on(t.userId, t.code)],
);

export interface CourseMeeting {
  /** 0 = Sunday. */
  day: number;
  start: string;
  end: string;
  location?: string;
}

export const assignments = pgTable(
  'assignments',
  {
    id: id(),
    userId: userRef(),
    courseId: uuid('course_id').references(() => courses.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }),
    weightPct: real('weight_pct'),
    estMinutes: integer('est_minutes'),
    progressPct: integer('progress_pct').notNull().default(0),
    type: assignmentTypeEnum('type').notNull().default('assignment'),
    allowedFileTypes: text('allowed_file_types')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: assignmentStatusEnum('status').notNull().default('todo'),
    source: assignmentSourceEnum('source').notNull().default('manual'),
    sourceRef: text('source_ref'),
    confidence: real('confidence'),
    /** Nothing extracted is trusted until the student confirms it (PRD J1 step 4). */
    confirmed: boolean('confirmed').notNull().default(false),
    notes: text('notes'),
    assumption: text('assumption'),
    evidence: text('evidence'),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('assignments_user_due_idx').on(t.userId, t.dueAt)],
);

export const assignmentChanges = pgTable(
  'assignment_changes',
  {
    id: id(),
    /** Null while a pending change waits for the student to say which assignment it means. */
    assignmentId: uuid('assignment_id').references(() => assignments.id, { onDelete: 'cascade' }),
    /** Null only on rows written before M6. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** The email this came from (provenance), if any. */
    inboxMessageId: uuid('inbox_message_id').references(() => inboxMessages.id, {
      onDelete: 'set null',
    }),
    /** ChangeKind: deadline_changed, cancelled, requirement_changed. */
    kind: text('kind'),
    field: text('field').notNull(),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    source: text('source').notNull(),
    evidence: text('evidence'),
    confidence: real('confidence'),
    applied: boolean('applied').notNull().default(false),
    /** applied | pending (waits for the student) | dismissed. */
    status: text('status').notNull().default('applied'),
    /** Why it applied or why it waits, in plain words. */
    reason: text('reason'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('assignment_changes_user_status_idx').on(t.userId, t.status)],
);

export const inboxMessages = pgTable(
  'inbox_messages',
  {
    id: id(),
    userId: userRef(),
    fromAddr: text('from_addr').notNull(),
    /** email (read by Helm), or whatsapp / instagram / sms / other (shared by the person). */
    source: text('source').notNull().default('email'),
    subject: text('subject').notNull().default(''),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    /** The email body itself is not stored; it goes to the agent. */
    bodyHash: text('body_hash').notNull(),
    classification: text('classification'),
    /** received -> sent (to the agent) -> processed | failed. */
    status: text('status').notNull().default('received'),
    requestId: text('request_id'),
    /** The agent's structured reading (EmailChange): no body text, only fields and a short quote. */
    resultJson: jsonb('result_json').$type<Record<string, unknown>>(),
    summary: text('summary'),
    model: text('model'),
    decision: text('decision'),
    decisionReason: text('decision_reason'),
    injectionSuspected: boolean('injection_suspected').notNull().default(false),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('inbox_user_body_uq').on(t.userId, t.bodyHash)],
);

export const submissions = pgTable(
  'submissions',
  {
    id: id(),
    userId: userRef(),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignments.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    fileSize: integer('file_size').notNull(),
    fileSha256: text('file_sha256').notNull(),
    agentFilePath: text('agent_file_path'),
    status: submissionStatusEnum('status').notNull().default('draft'),
    submitAt: timestamp('submit_at', { withTimezone: true }),
    /** True when submit_at came from the default lead, so a moved deadline may shift it (PRD 12). */
    submitAtFromDefault: boolean('submit_at_from_default').notNull().default(true),
    holdUntil: timestamp('hold_until', { withTimezone: true }),
    holdNoticeSentAt: timestamp('hold_notice_sent_at', { withTimezone: true }),
    consentAt: timestamp('consent_at', { withTimezone: true }),
    checksJson: jsonb('checks_json').$type<unknown[]>().notNull().default([]),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    lastError: text('last_error'),
    idempotencyKey: text('idempotency_key').notNull(),
    /** File hash the student approved with the Schedule tap (PRD 12 consent). */
    consentSha256: text('consent_sha256'),
    /** http (form post) or desktop (real browser, PRD v2 WP-7). */
    driver: text('driver').notNull().default('http'),
    /** When the current attempt was handed to the agent; a run with no result times out. */
    runRequestedAt: timestamp('run_requested_at', { withTimezone: true }),
    escalatedAt: timestamp('escalated_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('submissions_idem_uq').on(t.idempotencyKey),
    index('submissions_due_idx').on(t.status, t.submitAt),
  ],
);

export const receipts = pgTable('receipts', {
  id: id(),
  submissionId: uuid('submission_id')
    .notNull()
    .unique()
    .references(() => submissions.id, { onDelete: 'cascade' }),
  confirmationId: text('confirmation_id').notNull(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
  portalSnapshotRef: text('portal_snapshot_ref'),
  fileName: text('file_name'),
  fileSha256: text('file_sha256').notNull(),
  driver: text('driver'),
  createdAt: createdAt(),
});

export const briefs = pgTable(
  'briefs',
  {
    id: id(),
    userId: userRef(),
    /** The agent message that produced it; a retried delivery is not stored twice. */
    requestId: text('request_id'),
    forDate: text('for_date').notNull(),
    itemsJson: jsonb('items_json').$type<unknown>().notNull(),
    summaryText: text('summary_text').notNull(),
    trigger: text('trigger').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (t) => [
    index('briefs_user_date_idx').on(t.userId, t.forDate),
    uniqueIndex('briefs_user_request_uq').on(t.userId, t.requestId),
  ],
);

export const agentEvents = pgTable(
  'agent_events',
  {
    id: id(),
    userId: userRef(),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    eventId: text('event_id').notNull(),
    requestId: text('request_id'),
    type: agentEventTypeEnum('type').notNull(),
    reason: text('reason').notNull(),
    payloadJson: jsonb('payload_json').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('agent_events_user_event_uq').on(t.userId, t.eventId),
    index('agent_events_user_time_idx').on(t.userId, t.occurredAt),
  ],
);

export const notifications = pgTable('notifications', {
  id: id(),
  userId: userRef(),
  kind: text('kind').notNull(),
  channel: channelEnum('channel').notNull(),
  status: text('status').notNull().default('pending'),
  payloadJson: jsonb('payload_json').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

export type User = typeof users.$inferSelect;
export type AgentRow = typeof agents.$inferSelect;
export type Assignment = typeof assignments.$inferSelect;
export type Course = typeof courses.$inferSelect;
export type InboxMessage = typeof inboxMessages.$inferSelect;
export type AssignmentChange = typeof assignmentChanges.$inferSelect;

/** Maritime lifecycle webhooks (agent.woken, agent.sleeping, ...) and our own markers (PRD v2 WP-1). */
export const maritimeEvents = pgTable(
  'maritime_events',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    maritimeAgentId: text('maritime_agent_id'),
    kind: text('kind').notNull(),
    /** X-Maritime-Delivery: the same on every retry, so retries are stored once. */
    deliveryId: text('delivery_id'),
    payloadJson: jsonb('payload_json').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('maritime_events_delivery_uq').on(t.deliveryId),
    index('maritime_events_user_time_idx').on(t.userId, t.occurredAt),
  ],
);

/** Server-held secrets created at runtime (e.g. the webhook signing secret Maritime returns once). */
export const appSecrets = pgTable('app_secrets', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  ref: text('ref'),
  createdAt: createdAt(),
});

/**
 * The DEMO PORTAL's own records (PRD section 13): a stand-in for an LMS. It keeps metadata and
 * a hash of each file, never the file itself.
 */
export const portalSubmissions = pgTable(
  'portal_submissions',
  {
    id: id(),
    userId: userRef(),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignments.id, { onDelete: 'cascade' }),
    idempotencyKey: text('idempotency_key').notNull(),
    confirmationId: text('confirmation_id').notNull(),
    fileName: text('file_name').notNull(),
    fileSize: integer('file_size').notNull(),
    fileSha256: text('file_sha256').notNull(),
    /** agent (Helm submitted it) or manual (the student used the portal form). */
    via: text('via').notNull().default('agent'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('portal_submissions_idem_uq').on(t.userId, t.idempotencyKey),
    uniqueIndex('portal_submissions_assignment_uq').on(t.userId, t.assignmentId),
  ],
);

/** Demo portal switches per student: failure injection (PRD 13, M9). */
export const portalState = pgTable('portal_state', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** The next N submit calls fail. */
  failNext: integer('fail_next').notNull().default(0),
  /** 503 (portal down) or timeout (hangs until the caller gives up). */
  failMode: text('fail_mode').notNull().default('503'),
  updatedAt: updatedAt(),
});

export type Submission = typeof submissions.$inferSelect;
export type PortalSubmission = typeof portalSubmissions.$inferSelect;

/**
 * Messaging apps read through the person's own Maritime desktop (PRD v3, WP-7): WhatsApp Web,
 * Instagram. The login lives only in that desktop's browser; Helm reads chat-list previews.
 */
export const desktopApps = pgTable(
  'desktop_apps',
  {
    id: id(),
    userId: userRef(),
    /** whatsapp | instagram */
    app: text('app').notNull(),
    computerId: text('computer_id').notNull(),
    /** linking (waiting for the person's login) | linked | needs_login | disconnected | error */
    status: text('status').notNull().default('linking'),
    linkedAt: timestamp('linked_at', { withTimezone: true }),
    lastCheckAt: timestamp('last_check_at', { withTimezone: true }),
    lastError: text('last_error'),
    /** Keys (hashes) of previews already handled, newest last. Never the text. */
    seenJson: jsonb('seen_json').$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('desktop_apps_user_app_uq').on(t.userId, t.app)],
);
export type DesktopApp = typeof desktopApps.$inferSelect;
