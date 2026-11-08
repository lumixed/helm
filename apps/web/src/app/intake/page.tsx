import Link from 'next/link';
import { SyllabusUpload } from '@/components/SyllabusUpload';
import { Shell } from '@/components/ui';
import { requireProfile } from '@/lib/page-data';

export const dynamic = 'force-dynamic';

export default async function IntakePage() {
  const { user } = await requireProfile();
  return (
    <Shell
      title="Add a document"
      actions={
        <Link
          href={user.onboarded ? '/today' : '/setup'}
          className="min-h-11 rounded-xl px-3 py-2 font-medium underline-offset-4 hover:underline"
        >
          {user.onboarded ? 'Skip' : 'Back'}
        </Link>
      }
    >
      <p>
        A syllabus, a lease, a bill, a job offer, an event invite: anything with dates. Your agent
        reads it and lists everything due. You check the list before anything is used.
      </p>
      <SyllabusUpload />
    </Shell>
  );
}
