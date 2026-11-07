import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getDb, schema } from '@/db';
import { currentUser } from './session';
import { publicProfile } from './student';

/** For server pages: the signed-in student's profile, or a redirect to sign-in. */
export async function requireProfile() {
  const user = await currentUser();
  if (!user) redirect('/signin');
  const db = await getDb();
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.userId, user.id));
  return publicProfile(user, agent ?? null);
}
