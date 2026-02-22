'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { APP_VERSION } from '@/lib/version';
import { TIERS, type TierKey } from '@/lib/stripe/tiers';
import Link from 'next/link';
import { CancelBetButton } from '@/components/markets/CancelBetButton';

type Position = {
  id: string;
  outcome: string;
  shares: number;
  cost: number;
  created_at: string | null;
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

type Purchase = {
  id: string;
  tier: string;
  amount_cents: number;
  tokens_credited: number;
  status: string;
  created_at: string | null;
  completed_at: string | null;
};

export default function ProfilePage() {
  const router = useRouter();
  const [positions, setPositions] = useState<Position[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get display name and admin status
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, is_admin')
        .eq('id', user.id)
        .single();
      if (profile) {
        setDisplayName(profile.display_name);
        setIsAdmin(profile.is_admin === true);
      }

      // Get positions with market info and pool data
      const { data } = await supabase
        .from('positions')
        .select(`
          id,
          outcome,
          shares,
          cost,
          created_at,
          cancelled_at,
          markets ( id, question, status, resolved_outcome, market_pools ( yes_pool, no_pool ) )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (data) {
        setPositions(
          data.map((p) => {
            const market = Array.isArray(p.markets) ? p.markets[0] : p.markets;
            const poolData = market?.market_pools;
            const pool = Array.isArray(poolData) ? poolData[0] : poolData;
            return {
              ...p,
              market: market ? { id: market.id, question: market.question, status: market.status, resolved_outcome: market.resolved_outcome } : null,
              pool: pool ? { yes_pool: Number(pool.yes_pool), no_pool: Number(pool.no_pool) } : null,
            };
          }) as Position[]
        );
      }

      // Get purchase history
      const { data: purchaseData } = await supabase
        .from('token_purchases')
        .select('id, tier, amount_cents, tokens_credited, status, created_at, completed_at')
        .eq('status', 'completed')
        .order('created_at', { ascending: false });

      if (purchaseData) {
        setPurchases(purchaseData);
      }

      setLoading(false);
    }
    load();
  }, []);

  function calcPnL(pos: Position): { value: number; label: string } {
    if (!pos.market) return { value: 0, label: '-' };
    if (pos.cancelled_at) {
      return { value: 0, label: 'Cancelled' };
    }
    if (pos.market.status === 'resolved') {
      const won = pos.market.resolved_outcome === pos.outcome;
      const payout = won ? pos.shares : 0;
      const pnl = payout - pos.cost;
      return { value: pnl, label: `${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}` };
    }
    if (pos.market.status === 'cancelled') {
      return { value: 0, label: '0 (refunded)' };
    }
    return { value: 0, label: 'Open' };
  }

  function getTierLabel(tier: string): string {
    const t = TIERS[tier as TierKey];
    return t ? t.label : tier;
  }

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

      {/* Purchase History */}
      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium text-muted-foreground">
            Purchase History
          </h3>
          <Link
            href="/buy"
            className="text-xs text-green-400 hover:text-green-300"
          >
            Buy tokens
          </Link>
        </div>

        {loading ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Loading...</p>
        ) : purchases.length === 0 ? (
          <div className="rounded-sm border border-border bg-card p-4 text-center">
            <p className="text-sm text-muted-foreground">No purchases yet.</p>
            <Link
              href="/buy"
              className="mt-2 inline-block text-sm text-green-400 hover:text-green-300"
            >
              Buy your first token pack
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {purchases.map((purchase) => (
              <div
                key={purchase.id}
                className="rounded-sm border border-border bg-card p-3"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">
                      {getTierLabel(purchase.tier)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {purchase.completed_at
                        ? new Date(purchase.completed_at).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : purchase.created_at
                          ? new Date(purchase.created_at).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })
                          : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-green-400">
                      +{purchase.tokens_credited.toLocaleString()} tokens
                    </p>
                    <p className="text-xs text-muted-foreground">
                      ${(purchase.amount_cents / 100).toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bet history */}
      <div className="mt-6">
        <h3 className="mb-3 text-sm font-medium text-muted-foreground">
          Bet History
        </h3>
        {loading ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Loading...</p>
        ) : positions.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No bets yet. Go place your first bet!
          </p>
        ) : (
          <div className="space-y-2">
            {positions.map((pos) => {
              const pnl = calcPnL(pos);
              return (
                <a
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
                        {pos.shares.toFixed(1)} shares @ {pos.cost.toFixed(0)} tokens
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
                </a>
              );
            })}
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="mt-8 rounded-sm border border-yellow-800/40 bg-yellow-950/10 p-3">
          <h3 className="text-xs font-medium text-yellow-400">Admin</h3>
          <a
            href="/admin/prizes"
            className="mt-1 block text-sm text-muted-foreground hover:text-foreground"
          >
            Manage Prize Periods &rarr;
          </a>
          <a
            href="/admin/balances"
            className="mt-1 block text-sm text-muted-foreground hover:text-foreground"
          >
            Adjust Balances &rarr;
          </a>
        </div>
      )}

      <p className="mt-8 text-center text-xs text-muted-foreground">{APP_VERSION}</p>
    </div>
  );
}
