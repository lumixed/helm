import { ReviewList } from '@/components/ReviewList';
import { Shell } from '@/components/ui';
import { requireProfile } from '@/lib/page-data';

export const dynamic = 'force-dynamic';

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ intake?: string }>;
}) {
  await requireProfile();
  const { intake } = await searchParams;
  return (
    <Shell title="Check what Helm found">
      <ReviewList intakeId={intake} />
    </Shell>
  );
}
