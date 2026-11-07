import { redirect } from 'next/navigation';
import { SignInForm } from '@/components/SignInForm';
import { Card, Shell } from '@/components/ui';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function SignInPage() {
  const user = await currentUser();
  if (user) redirect(user.onboardedAt ? '/today' : '/setup');
  return (
    <Shell title="Helm">
      <p className="text-lg leading-relaxed">
        Your private deadline agent. It plans your day, watches for changes, and gets your finished
        work in on time.
      </p>
      <Card>
        <h2 className="mb-4 text-lg font-semibold">Sign in</h2>
        <SignInForm />
      </Card>
    </Shell>
  );
}
