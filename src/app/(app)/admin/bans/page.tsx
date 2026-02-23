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
  const [submitting, setSubmitting] = useState<string | null>(null);

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

  async function handleBan(user: UserSearchResult) {
    setSubmitting(user.id);
    const result = await banUser({ userId: user.id });
    setSubmitting(null);

    if (result.success) {
      toast.success(`Banned ${user.display_name}`);
      setResults((prev) =>
        prev.map((u) =>
          u.id === user.id ? { ...u, banned_at: result.data.banned_at } : u
        )
      );
    } else {
      toast.error(result.error);
    }
  }

  async function handleUnban(user: UserSearchResult) {
    setSubmitting(user.id);
    const result = await unbanUser({ userId: user.id });
    setSubmitting(null);

    if (result.success) {
      toast.success(`Unbanned ${user.display_name}`);
      setResults((prev) =>
        prev.map((u) =>
          u.id === user.id ? { ...u, banned_at: null } : u
        )
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
        <div className="mt-4 space-y-1">
          {results.map((user) => (
            <div
              key={user.id}
              className={`w-full rounded-sm border p-3 ${
                user.banned_at
                  ? 'border-red-800/40 bg-red-950/10'
                  : 'border-border bg-card'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">
                    {user.display_name}
                    {user.banned_at && (
                      <span className="ml-2 text-xs font-normal text-red-400">
                        Banned
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{maskPhone(user.phone)}</p>
                  {user.banned_at && (
                    <p className="text-xs text-muted-foreground">
                      Since {new Date(user.banned_at).toLocaleDateString()}
                    </p>
                  )}
                </div>
                <div>
                  {user.banned_at ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="rounded-sm"
                      onClick={() => handleUnban(user)}
                      disabled={submitting === user.id}
                    >
                      {submitting === user.id ? 'Unbanning...' : 'Unban'}
                    </Button>
                  ) : (
                    <Button
                      variant="destructive"
                      size="sm"
                      className="rounded-sm"
                      onClick={() => handleBan(user)}
                      disabled={submitting === user.id}
                    >
                      {submitting === user.id ? 'Banning...' : 'Ban'}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
