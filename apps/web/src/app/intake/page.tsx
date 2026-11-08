import Link from 'next/link';
import { SyllabusUpload } from '@/components/SyllabusUpload';
import { buttonClass, Shell } from '@/components/ui';
import { requireProfile } from '@/lib/page-data';

export const dynamic = 'force-dynamic';

export default async function IntakePage() {
  const { user } = await requireProfile();
  return (
    <Shell
      title="Add a document"
      subtitle={
        <>
          {!user.onboarded && 'Step 2 of 2 · '}A syllabus, a lease, a bill, a job offer, an event
          invite: anything with dates. Your agent reads it and lists everything due. You check the
          list before anything is used.
        </>
      }
      nav={user.onboarded}
      actions={
        <Link href={user.onboarded ? '/today' : '/setup'} className={buttonClass('tertiary')}>
          {user.onboarded ? 'Skip' : 'Back'}
        </Link>
      }
    >
      <SyllabusUpload />
    </Shell>
  );
}
