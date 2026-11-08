import { PageSkeleton } from '@/components/PageSkeleton';

export default function Loading() {
  return <PageSkeleton title="Check what Helm found" cards={3} />;
}
