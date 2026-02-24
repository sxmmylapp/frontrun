'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { searchUsers, banUser, unbanUser, type UserSearchResult } from '@/lib/admin/actions';
import { toast } from 'sonner';

export default function AdminBansPage() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [banReason, setBanReason] = useState('');
  const [acting, setActing] = useState<string | null>(null);

  useEffect(() => {
    async function checkAdmin() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single();

      if (!profile?.is_admin) {
        router.push('/feed');
        return;
      }
      setIsAdmin(true);
    }
    checkAdmin();
  }, [router]);

  async function handleSearch() {
    if (!query.trim()) return;
    setSearching(true);
    const result = await searchUsers({ query: query.trim() });
    setSearching(false);

    if (result.success) {
      setResults(result.data);
      if (result.data.length === 0) {
        toast.info('No users found');
      }
    } else {
      toast.error(result.error);
    }
  }

  async function handleBan(userId: string) {
    setActing(userId);
    const result = await banUser({ userId, reason: banReason.trim() || undefined });
    setActing(null);

    if (result.success) {
      toast.success(`Banned ${result.data.display_name}`);
      setResults((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, is_banned: true } : u))
      );
      setBanReason('');
    } else {
      toast.error(result.error);
    }
  }

  async function handleUnban(userId: string) {
    setActing(userId);
    const result = await unbanUser({ userId });
    setActing(null);

    if (result.success) {
      toast.success(`Unbanned ${result.data.display_name}`);
      setResults((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, is_banned: false } : u))
      );
    } else {
      toast.error(result.error);
    }
  }

  function maskPhone(phone: string): string {
    if (phone.length <= 4) return phone;
    return phone.slice(0, -4).replace(/./g, '*') + phone.slice(-4);
  }

  if (!isAdmin) return null;

  return (
    <div className="px-4 py-4">
      <a href="/profile" className="mb-4 inline-block text-xs text-muted-foreground hover:text-foreground">
        &larr; Back
      </a>

      <h2 className="mt-2 text-lg font-semibold">Ban Users</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Search for a user and ban or unban them
      </p>

      {/* Search */}
      <div className="mt-4 flex gap-2">
        <Input
          placeholder="Search by name or phone..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          className="rounded-sm"
        />
        <Button
          className="shrink-0 rounded-sm"
          onClick={handleSearch}
          disabled={searching || !query.trim()}
        >
          {searching ? 'Searching...' : 'Search'}
        </Button>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="mt-4 space-y-2">
          {results.map((user) => (
            <div
              key={user.id}
              className={`rounded-sm border p-3 ${
                user.is_banned
                  ? 'border-red-800/40 bg-red-950/10'
                  : 'border-border bg-card'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">
                    {user.display_name}
                    {user.is_banned && (
                      <span className="ml-2 rounded-sm bg-red-900/40 px-1.5 py-0.5 text-xs text-red-400">
                        BANNED
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{maskPhone(user.phone)}</p>
                </div>
                <p className="font-mono text-sm text-muted-foreground">
                  {Math.round(user.balance).toLocaleString()} tokens
                </p>
              </div>

              <div className="mt-2 flex items-center gap-2">
                {user.is_banned ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="rounded-sm"
                    onClick={() => handleUnban(user.id)}
                    disabled={acting === user.id}
                  >
                    {acting === user.id ? 'Unbanning...' : 'Unban'}
                  </Button>
                ) : (
                  <>
                    <Input
                      placeholder="Ban reason (optional)"
                      value={banReason}
                      onChange={(e) => setBanReason(e.target.value)}
                      className="h-8 rounded-sm text-xs"
                    />
                    <Button
                      variant="destructive"
                      size="sm"
                      className="shrink-0 rounded-sm"
                      onClick={() => handleBan(user.id)}
                      disabled={acting === user.id}
                    >
                      {acting === user.id ? 'Banning...' : 'Ban'}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
