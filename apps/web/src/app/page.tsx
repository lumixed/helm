import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await currentUser();
  redirect(!user ? '/signin' : user.onboardedAt ? '/today' : '/setup');
}
