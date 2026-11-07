import { z } from 'zod';

/**
 * Entries a custom Maritime container serves from `GET /schedules`.
 * Maritime polls it while the agent is awake and turns entries into real wake triggers.
 * An entry with `prompt` has the prompt delivered to `POST /chat` with source "scheduled".
 * Verified against https://maritime.sh/docs/frameworks/custom on 2026-11-07.
 */
export const ScheduleEntry = z
  .object({
    id: z.string().min(1).max(100),
    cron: z.string().optional(),
    /** IANA timezone the cron is evaluated in, e.g. "America/Vancouver". */
    tz: z.string().optional(),
    /** One-off wake (ISO 8601). Documented for the SDK's pushSchedules. */
    nextRunAt: z.iso.datetime({ offset: true }).optional(),
    prompt: z.string().optional(),
    enabled: z.boolean().default(true),
  })
  .refine((e) => Boolean(e.cron) !== Boolean(e.nextRunAt), {
    message: 'Exactly one of cron or nextRunAt is required',
  });
export type ScheduleEntry = z.infer<typeof ScheduleEntry>;

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "07:30" → "30 7 * * *" (evaluated in the student's tz by Maritime). */
export function dailyCron(localTime: string): string {
  const m = HH_MM.exec(localTime);
  if (!m) throw new Error(`Invalid HH:MM time: ${localTime}`);
  return `${Number(m[2])} ${Number(m[1])} * * *`;
}
