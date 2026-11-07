import Link from 'next/link';
import { SyllabusUpload } from '@/components/SyllabusUpload';
import { Shell } from '@/components/ui';
import { requireProfile } from '@/lib/page-data';

export const dynamic = 'force-dynamic';

export default async function IntakePage() {
  const { user } = await requireProfile();
  return (
    <Shell
      title="Add a syllabus"
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
        Your agent reads it and lists every deadline. You check the list before anything is used.
      </p>
      <SyllabusUpload />
    </Shell>
  );
}
