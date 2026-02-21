'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { APP_VERSION } from '@/lib/version';

export default function ProfilePage() {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  }

  return (
    <div className="flex flex-col items-center px-4 py-20 text-center">
      <h2 className="text-xl font-semibold">Profile</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Your profile and settings will appear here.
      </p>
      <Button
        variant="secondary"
        className="mt-8 rounded-sm"
        onClick={handleLogout}
      >
        Log out
      </Button>
      <p className="mt-8 text-xs text-muted-foreground">{APP_VERSION}</p>
    </div>
  );
}
