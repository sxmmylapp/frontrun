'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  searchUsers,
  banUser,
  unbanUser,
  getBannedUsers,
  type UserSearchResult,
  type BannedUser,
} from '@/lib/admin/actions';
import { toast } from 'sonner';

export default function AdminBansPage() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [bannedUsers, setBannedUsers] = useState<BannedUser[]>([]);
  const [loadingBanned, setLoadingBanned] = useState(true);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

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
      loadBannedUsers();
    }
    checkAdmin();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function loadBannedUsers() {
    setLoadingBanned(true);
    const result = await getBannedUsers();
    if (result.success) {
      setBannedUsers(result.data);
    }
    setLoadingBanned(false);
  }

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
    setActionInProgress(userId);
    const result = await banUser({ userId });
    setActionInProgress(null);

    if (result.success) {
      toast.success('User banned');
      setResults((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, is_banned: true } : u))
      );
      loadBannedUsers();
    } else {
      toast.error(result.error);
    }
  }

  async function handleUnban(userId: string) {
    setActionInProgress(userId);
    const result = await unbanUser({ userId });
    setActionInProgress(null);

    if (result.success) {
      toast.success('User unbanned');
      setResults((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, is_banned: false } : u))
      );
      setBannedUsers((prev) => prev.filter((u) => u.id !== userId));
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
        Search for a user to ban or unban them
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

      {/* Search Results */}
      {results.length > 0 && (
        <div className="mt-4 space-y-1">
          {results.map((user) => (
            <div
              key={user.id}
              className="flex items-center justify-between rounded-sm border border-border bg-card p-3"
            >
              <div>
                <p className="text-sm font-medium">
                  {user.display_name}
                  {user.is_banned && (
                    <span className="ml-2 rounded-sm bg-red-950/30 px-1.5 py-0.5 text-xs text-red-400">
                      Banned
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">{maskPhone(user.phone)}</p>
              </div>
              {user.is_banned ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="rounded-sm"
                  onClick={() => handleUnban(user.id)}
                  disabled={actionInProgress === user.id}
                >
                  {actionInProgress === user.id ? 'Unbanning...' : 'Unban'}
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  size="sm"
                  className="rounded-sm"
                  onClick={() => handleBan(user.id)}
                  disabled={actionInProgress === user.id}
                >
                  {actionInProgress === user.id ? 'Banning...' : 'Ban'}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Currently Banned Users */}
      <div className="mt-8">
        <h3 className="mb-3 text-sm font-medium text-muted-foreground">
          Currently Banned
        </h3>
        {loadingBanned ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Loading...</p>
        ) : bannedUsers.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No banned users
          </p>
        ) : (
          <div className="space-y-1">
            {bannedUsers.map((user) => (
              <div
                key={user.id}
                className="flex items-center justify-between rounded-sm border border-red-900/30 bg-red-950/10 p-3"
              >
                <div>
                  <p className="text-sm font-medium">{user.display_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {maskPhone(user.phone)}
                    {user.banned_at && (
                      <span className="ml-2">
                        Banned {new Date(user.banned_at).toLocaleDateString()}
                      </span>
                    )}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="rounded-sm"
                  onClick={() => handleUnban(user.id)}
                  disabled={actionInProgress === user.id}
                >
                  {actionInProgress === user.id ? 'Unbanning...' : 'Unban'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
