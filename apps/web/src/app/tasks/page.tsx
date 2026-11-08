import { redirect } from 'next/navigation';
import { WebTasksBoard } from '@/components/WebTasksBoard';
import { Shell } from '@/components/ui';
import { getDb } from '@/db';
import { requireProfile } from '@/lib/page-data';
import { currentUser } from '@/lib/session';
import { listWebTasks, webTaskDepsFromEnv } from '@/lib/web-tasks';

export const dynamic = 'force-dynamic';

export default async function TasksPage() {
  const { user } = await requireProfile();
  if (!user.onboarded) redirect('/setup');
  const full = (await currentUser())!;
  const tasks = await listWebTasks(await getDb(), full);
  return (
    <Shell
      title="Website tasks"
      subtitle="Tell Helm what to do on a site. It works in a private browser and stops for your yes before anything final."
    >
      <WebTasksBoard initial={tasks} enabled={Boolean(await webTaskDepsFromEnv())} />
    </Shell>
  );
}
