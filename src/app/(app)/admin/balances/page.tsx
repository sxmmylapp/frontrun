'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { searchUsers, adjustBalance, type UserSearchResult } from '@/lib/admin/actions';
import { toast } from 'sonner';

export default function AdminBalancesPage() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
    setSelectedUser(null);
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

  async function handleAdjust() {
    if (!selectedUser) return;
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount === 0) {
      toast.error('Enter a nonzero amount');
      return;
    }

    setSubmitting(true);
    const result = await adjustBalance({
      userId: selectedUser.id,
      amount: parsedAmount,
      note: note.trim() || undefined,
    });
    setSubmitting(false);

    if (result.success) {
      const verb = parsedAmount > 0 ? 'Credited' : 'Debited';
      toast.success(`${verb} ${Math.abs(parsedAmount)} tokens. New balance: ${Math.round(result.data.newBalance).toLocaleString()}`);
      // Update local state
      setSelectedUser({ ...selectedUser, balance: result.data.newBalance });
      setResults((prev) =>
        prev.map((u) =>
          u.id === selectedUser.id ? { ...u, balance: result.data.newBalance } : u
        )
      );
      setAmount('');
      setNote('');
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
      <Link href="/profile" className="mb-4 inline-block text-xs text-muted-foreground hover:text-foreground">
        &larr; Back
      </Link>

      <h2 className="mt-2 text-lg font-semibold">Adjust Balances</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Search for a user and credit or debit tokens
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
            <button
              key={user.id}
              onClick={() => setSelectedUser(user)}
              className={`w-full rounded-sm border p-3 text-left transition-colors ${
                selectedUser?.id === user.id
                  ? 'border-yellow-600 bg-yellow-950/20'
                  : 'border-border bg-card hover:border-border/80'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{user.display_name}</p>
                  <p className="text-xs text-muted-foreground">{maskPhone(user.phone)}</p>
                </div>
                <p className="font-mono text-sm text-muted-foreground">
                  {Math.round(user.balance).toLocaleString()} tokens
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Adjustment form */}
      {selectedUser && (
        <div className="mt-4 rounded-sm border border-yellow-800/40 bg-yellow-950/10 p-4">
          <h3 className="text-xs font-medium text-yellow-400">
            Adjust: {selectedUser.display_name}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Current balance: {Math.round(selectedUser.balance).toLocaleString()} tokens
          </p>

          <div className="mt-3 space-y-2">
            <Input
              type="number"
              placeholder="Amount (positive = credit, negative = debit)"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="rounded-sm"
            />
            <Input
              placeholder="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="rounded-sm"
            />
            <Button
              className="w-full rounded-sm"
              onClick={handleAdjust}
              disabled={submitting || !amount || parseFloat(amount) === 0}
            >
              {submitting ? 'Adjusting...' : 'Confirm Adjustment'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
