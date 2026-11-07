'use client';

import { useRouter } from 'next/navigation';
import { Button } from './ui';

export function SignOutButton() {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      onClick={async () => {
        await fetch('/api/auth/signout', { method: 'POST' });
        router.push('/signin');
      }}
    >
      Sign out
    </Button>
  );
}
