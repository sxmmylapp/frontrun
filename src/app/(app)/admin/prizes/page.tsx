'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createPrizeSnapshot, toggleWinner } from '@/lib/prizes/actions';
import { toast } from 'sonner';

type PrizePeriod = {
  id: string;
  title: string;
  snapshot_at: string;
  entries: {
    id: string;
    user_id: string;
    rank: number;
    balance: number;
    is_winner: boolean;
    display_name: string;
  }[];
};

export default function AdminPrizesPage() {
  const router = useRouter();
  const [periods, setPeriods] = useState<PrizePeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Check admin
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

      // Load prize periods
      const { data: periodsData } = await supabase
        .from('prize_periods')
        .select('id, title, snapshot_at')
        .order('snapshot_at', { ascending: false });

      if (!periodsData) {
        setLoading(false);
        return;
      }

      // Load snapshots for each period
      const enriched: PrizePeriod[] = [];
      for (const period of periodsData) {
        const { data: snapshots } = await supabase
          .from('leaderboard_snapshots')
          .select('id, user_id, rank, balance, is_winner')
          .eq('period_id', period.id)
          .order('rank', { ascending: true })
          .limit(20);

        if (!snapshots) continue;

        // Get display names
        const userIds = snapshots.map((s) => s.user_id);
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, display_name')
          .in('id', userIds);

        const nameMap = new Map(
          (profiles ?? []).map((p) => [p.id, p.display_name])
        );

        enriched.push({
          ...period,
          entries: snapshots.map((s) => ({
            ...s,
            display_name: nameMap.get(s.user_id) ?? 'Unknown',
          })),
        });
      }

      setPeriods(enriched);
      setLoading(false);
    }
    load();
  }, [router]);

  async function handleCreateSnapshot() {
    if (!title.trim()) return;
    setCreating(true);
    const result = await createPrizeSnapshot({ title: title.trim() });
    setCreating(false);

    if (result.success) {
      toast.success(`Snapshot created — ${result.data.entriesCount} entries`);
      setTitle('');
      router.refresh();
      // Reload page to show new snapshot
      window.location.reload();
    } else {
      toast.error(result.error);
    }
  }

  async function handleToggleWinner(snapshotId: string, currentlyWinner: boolean) {
    const result = await toggleWinner({
      snapshotId,
      isWinner: !currentlyWinner,
    });

    if (result.success) {
      setPeriods((prev) =>
        prev.map((p) => ({
          ...p,
          entries: p.entries.map((e) =>
            e.id === snapshotId ? { ...e, is_winner: !currentlyWinner } : e
          ),
        }))
      );
    } else {
      toast.error(result.error);
    }
  }

  if (!isAdmin) return null;

  return (
    <div className="px-4 py-4">
      <a href="/feed" className="mb-4 inline-block text-xs text-muted-foreground hover:text-foreground">
        &larr; Back
      </a>

      <h2 className="mt-2 text-lg font-semibold">Prize Periods</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Snapshot the leaderboard and mark winners
      </p>

      {/* Create new snapshot */}
      <div className="mt-4 rounded-sm border border-border bg-card p-4">
        <h3 className="text-xs font-medium text-muted-foreground">New Snapshot</h3>
        <div className="mt-2 flex gap-2">
          <Input
            placeholder="Period title (e.g., Week 1)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded-sm"
          />
          <Button
            className="shrink-0 rounded-sm"
            onClick={handleCreateSnapshot}
            disabled={creating || !title.trim()}
          >
            {creating ? 'Creating...' : 'Snapshot'}
          </Button>
        </div>
      </div>

      {/* Past periods */}
      {loading ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">Loading...</p>
      ) : periods.length === 0 ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">
          No prize periods yet. Create your first snapshot above.
        </p>
      ) : (
        <div className="mt-6 space-y-6">
          {periods.map((period) => (
            <div key={period.id} className="rounded-sm border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">{period.title}</h3>
                <span className="text-xs text-muted-foreground">
                  {new Date(period.snapshot_at).toLocaleDateString()}
                </span>
              </div>
              <div className="mt-3 space-y-1">
                {period.entries.map((entry) => (
                  <div
                    key={entry.id}
                    className={`flex items-center justify-between rounded-sm px-2 py-1.5 text-sm ${
                      entry.is_winner ? 'bg-yellow-950/20' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-6 text-right font-mono text-xs text-muted-foreground">
                        #{entry.rank}
                      </span>
                      <span>{entry.display_name}</span>
                      {entry.is_winner && (
                        <span className="text-xs text-yellow-400">Winner</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {entry.balance.toLocaleString()}
                      </span>
                      <button
                        onClick={() => handleToggleWinner(entry.id, entry.is_winner)}
                        className={`rounded-sm px-2 py-0.5 text-xs transition-colors ${
                          entry.is_winner
                            ? 'bg-yellow-800/30 text-yellow-400 hover:bg-yellow-800/50'
                            : 'bg-secondary text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {entry.is_winner ? 'Remove' : 'Mark Winner'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
