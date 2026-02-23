'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

export default function BannedPage() {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-lg font-semibold text-red-400">Account Suspended</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account has been permanently banned.
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-6 rounded-sm"
          onClick={handleLogout}
        >
          Log out
        </Button>
      </div>
    </div>
  );
}
