'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { CancelBetButton } from '@/components/markets/CancelBetButton';

type Position = {
  id: string;
  outcome: string;
  shares: number;
  cost: number;
  cancelled_at: string | null;
  market: {
    id: string;
    question: string;
    status: string;
    resolved_outcome: string | null;
  } | null;
  pool: {
    yes_pool: number;
    no_pool: number;
  } | null;
};

type ProfileClientProps = {
  displayName: string;
  isAdmin: boolean;
  positions: Position[];
  balance: number;
  appVersion: string;
};

export function ProfileClient({ displayName, isAdmin, positions, balance, appVersion }: ProfileClientProps) {
  const router = useRouter();

  const calcPnL = useCallback((pos: Position): { value: number; label: string } => {
    if (!pos.market) return { value: 0, label: '-' };
    if (pos.cancelled_at) {
      return { value: 0, label: 'Cancelled' };
    }
    if (pos.market.status === 'resolved') {
      const won = pos.market.resolved_outcome === pos.outcome;
      const payout = won ? pos.shares : 0;
      const pnl = payout - pos.cost;
      return { value: pnl, label: `${pnl >= 0 ? '+' : ''}${Math.round(pnl)}` };
    }
    if (pos.market.status === 'cancelled') {
      return { value: 0, label: '0 (refunded)' };
    }
    return { value: 0, label: 'Open' };
  }, []);

  const stats = useMemo(() => {
    let invested = 0;
    let realizedPnL = 0;
    let wins = 0;
    let losses = 0;
    let open = 0;

    for (const pos of positions) {
      if (pos.cancelled_at || !pos.market) continue;

      if (pos.market.status === 'resolved') {
        const won = pos.market.resolved_outcome === pos.outcome;
        const payout = won ? pos.shares : 0;
        realizedPnL += payout - pos.cost;
        if (won) wins++;
        else losses++;
      } else if (pos.market.status === 'open' || pos.market.status === 'closed') {
        invested += pos.cost;
        open++;
      }
      // cancelled markets: cost refunded, not counted
    }

    return { invested, realizedPnL, wins, losses, open };
  }, [positions]);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  }

  return (
    <div className="px-4 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{displayName || 'Profile'}</h2>
          <p className="text-xs text-muted-foreground">Your activity</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="rounded-sm"
          onClick={handleLogout}
        >
          Log out
        </Button>
      </div>

      {/* Portfolio stats */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-sm border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground">Balance</div>
          <div className="mt-1 text-lg font-bold">{Math.round(balance).toLocaleString()}</div>
        </div>
        <div className="rounded-sm border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground">Invested</div>
          <div className="mt-1 text-lg font-bold">{Math.round(stats.invested).toLocaleString()}</div>
        </div>
        <div className="rounded-sm border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground">Realized P&L</div>
          <div className={`mt-1 text-lg font-bold ${stats.realizedPnL > 0 ? 'text-green-400' : stats.realizedPnL < 0 ? 'text-red-400' : ''}`}>
            {stats.realizedPnL >= 0 ? '+' : ''}{Math.round(stats.realizedPnL).toLocaleString()}
          </div>
        </div>
        <div className="rounded-sm border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground">Record</div>
          <div className="mt-1 text-lg font-bold">
            <span className="text-green-400">{stats.wins}W</span>
            {' · '}
            <span className="text-red-400">{stats.losses}L</span>
            {' · '}
            <span className="text-muted-foreground">{stats.open}</span>
          </div>
        </div>
      </div>

      {/* Bet history */}
      <div className="mt-6">
        <h3 className="mb-3 text-sm font-medium text-muted-foreground">
          Bet History
        </h3>
        {positions.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No bets yet. Go place your first bet!
          </p>
        ) : (
          <div className="space-y-2">
            {positions.map((pos) => {
              const pnl = calcPnL(pos);
              return (
                <Link
                  key={pos.id}
                  href={pos.market ? `/markets/${pos.market.id}` : '#'}
                  className="block rounded-sm border border-border bg-card p-3 transition-colors hover:border-border/80"
                >
                  <p className="text-sm leading-snug">
                    {pos.market?.question ?? 'Unknown market'}
                  </p>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-sm px-1.5 py-0.5 font-medium ${
                          pos.outcome === 'yes'
                            ? 'bg-green-950/30 text-green-400'
                            : 'bg-red-950/30 text-red-400'
                        }`}
                      >
                        {pos.outcome.toUpperCase()}
                      </span>
                      <span className="text-muted-foreground">
                        {Math.round(pos.shares)} shares @ {Math.round(pos.cost)} tokens
                      </span>
                    </div>
                    <span
                      className={`font-mono ${
                        pnl.value > 0
                          ? 'text-green-400'
                          : pnl.value < 0
                            ? 'text-red-400'
                            : 'text-muted-foreground'
                      }`}
                    >
                      {pnl.label}
                    </span>
                  </div>
                  {pos.market && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {pos.cancelled_at ? (
                        <span className="text-yellow-400">Cancelled</span>
                      ) : pos.market.status === 'resolved' ? (
                        <span>
                          Resolved: {pos.market.resolved_outcome?.toUpperCase()}
                        </span>
                      ) : pos.market.status === 'cancelled' ? (
                        <span>Market cancelled</span>
                      ) : (
                        <span>Pending</span>
                      )}
                    </div>
                  )}
                  {!pos.cancelled_at && pos.market?.status === 'open' && pos.pool && (
                    <div className="mt-1" onClick={(e) => e.preventDefault()}>
                      <CancelBetButton
                        positionId={pos.id}
                        outcome={pos.outcome as 'yes' | 'no'}
                        shares={pos.shares}
                        cost={pos.cost}
                        yesPool={pos.pool.yes_pool}
                        noPool={pos.pool.no_pool}
                      />
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="mt-8 flex flex-col gap-2 rounded-sm border border-yellow-800/40 bg-yellow-950/10 p-3">
          <h3 className="text-xs font-medium text-yellow-400">Admin</h3>
          <Button asChild variant="outline" size="lg" className="w-full justify-between">
            <Link href="/admin/prizes">
              Manage Prize Periods <span aria-hidden="true">&rarr;</span>
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="w-full justify-between">
            <Link href="/admin/balances">
              Adjust Balances <span aria-hidden="true">&rarr;</span>
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="w-full justify-between">
            <Link href="/admin/bans">
              Ban Users <span aria-hidden="true">&rarr;</span>
            </Link>
          </Button>
        </div>
      )}

      <p className="mt-8 text-center text-xs text-muted-foreground">{appVersion}</p>
    </div>
  );
}
