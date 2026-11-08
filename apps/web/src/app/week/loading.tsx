import { PageSkeleton } from '@/components/PageSkeleton';

export default function Loading() {
  return <PageSkeleton title="Your week" cards={3} />;
}
