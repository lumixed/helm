import { getDb } from '@/db';
import { fail, json } from '@/lib/http';
import { mobileSchedule } from '@/lib/mobile-schedule';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** For the phone app: the local notifications to schedule on the device. */
export async function GET(): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Not signed in');
  return json({
    notifications: await mobileSchedule(await getDb(), user),
    timezone: user.timezone,
  });
}
