import type { WaitingItem } from '@helm/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { WaitingOn } from '@/db/schema';
import { sendToUser } from './telegram';

/**
 * "Waiting on" items, as reported by the person's agent (it reads Gmail inside its own VM; Helm
 * keeps the thread id, who it went to, the subject and a one-line summary).
 */
export async function saveWaitingReport(
  db: Db,
  userId: string,
  report: { open: WaitingItem[]; replied: string[] },
): Promise<{ added: WaitingOn[] }> {
  const added: WaitingOn[] = [];
  for (const w of report.open) {
    const [row] = await db
      .insert(schema.waitingOn)
      .values({
        userId,
        threadId: w.threadId,
        toName: w.to,
        subject: w.subject,
        summary: w.summary,
        sentAt: new Date(w.sentAt),
      })
      // A thread already known (open, dismissed or answered) is never re-opened by a report.
      .onConflictDoNothing()
      .returning();
    if (row) added.push(row);
  }
  if (report.replied.length)
    await db
      .update(schema.waitingOn)
      .set({ status: 'replied' })
      .where(
        and(
          eq(schema.waitingOn.userId, userId),
          inArray(schema.waitingOn.threadId, report.replied),
          eq(schema.waitingOn.status, 'open'),
        ),
      );
  if (added.length) {
    const lines = added.map((a) => `• ${a.summary}`).join('\n');
    const link = process.env.APP_BASE_URL?.replace(/\/+$/, '');
    await sendToUser(
      db,
      userId,
      `📬 Still waiting for a reply:\n${lines}\n\nHelm can draft a polite follow-up for you to send.`,
      link?.startsWith('https://') ? [[{ text: 'Open Helm', url: `${link}/today` }]] : [],
    ).catch(() => false);
  }
  return { added };
}

export async function openWaiting(db: Db, userId: string): Promise<WaitingOn[]> {
  return db
    .select()
    .from(schema.waitingOn)
    .where(and(eq(schema.waitingOn.userId, userId), eq(schema.waitingOn.status, 'open')))
    .orderBy(asc(schema.waitingOn.sentAt))
    .limit(10);
}

export async function getWaiting(db: Db, userId: string, id: string): Promise<WaitingOn | null> {
  const [row] = await db
    .select()
    .from(schema.waitingOn)
    .where(and(eq(schema.waitingOn.id, id), eq(schema.waitingOn.userId, userId)));
  return row ?? null;
}

export async function dismissWaiting(db: Db, userId: string, id: string): Promise<boolean> {
  const rows = await db
    .update(schema.waitingOn)
    .set({ status: 'dismissed' })
    .where(and(eq(schema.waitingOn.id, id), eq(schema.waitingOn.userId, userId)))
    .returning({ id: schema.waitingOn.id });
  return rows.length > 0;
}

export async function markDrafted(db: Db, userId: string, threadId: string) {
  await db
    .update(schema.waitingOn)
    .set({ draftedAt: new Date() })
    .where(and(eq(schema.waitingOn.userId, userId), eq(schema.waitingOn.threadId, threadId)));
}
