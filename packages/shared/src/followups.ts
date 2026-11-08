import { z } from 'zod';

/**
 * "Waiting on": mail the person sent that asked for something and got no reply. The agent finds
 * them in Gmail inside its own VM; only a one-line summary and the thread id reach Helm.
 */
export const WaitingItem = z.object({
  threadId: z.string().min(1).max(100),
  /** Display name or address of who they wrote to. */
  to: z.string().max(200),
  subject: z.string().max(300),
  /** One line, written by the agent: "Asked Dave when the deposit comes back". */
  summary: z.string().min(1).max(200),
  sentAt: z.iso.datetime({ offset: true }),
});
export type WaitingItem = z.infer<typeof WaitingItem>;

/** Agent -> backend after a check: new open items, and threads that got a reply since. */
export const WaitingReportRequest = z.object({
  studentId: z.string().min(1).max(128),
  requestId: z.string().min(1).max(200),
  open: z.array(WaitingItem).max(20),
  replied: z.array(z.string().max(100)).max(50),
});
export type WaitingReportRequest = z.infer<typeof WaitingReportRequest>;

/** Wait this long without a reply before counting it as "waiting on". */
export const WAITING_AFTER_DAYS = 3;
/** Stop looking at mail older than this. */
export const WAITING_LOOKBACK_DAYS = 14;

/** What the model returns for each sent email it is shown. */
export const WaitingJudgement = z.object({
  items: z
    .array(
      z.object({
        ref: z.string(),
        needsReply: z.boolean(),
        summary: z.string().max(200),
      }),
    )
    .max(20),
});
export type WaitingJudgement = z.infer<typeof WaitingJudgement>;
