'use client';

import { useState, useEffect, useRef, useCallback, lazy, Suspense, memo } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { formatDistanceToNow, format } from 'date-fns';
import { CancelBetButton } from './CancelBetButton';

// Lazy-load heavy components that are conditionally rendered
const BetSlip = lazy(() => import('./BetSlip').then(m => ({ default: m.BetSlip })));
const AdminResolutionPanel = lazy(() => import('./AdminResolutionPanel').then(m => ({ default: m.AdminResolutionPanel })));

type UserPosition = {
  id: string;
  outcome: string;
  shares: number;
  cost: number;
  cancelled_at: string | null;
};

type MarketProps = {
  market: {
    id: string;
    question: string;
    resolutionCriteria: string;
    status: string;
    resolvedOutcome: string | null;
    closesAt: string;
    resolvedAt: string | null;
    createdAt: string;
    creatorId: string;
  };
  initialPool: {
    yesPool: number;
    noPool: number;
  };
  isAdmin?: boolean;
  currentUserId: string | null;
  userPositions?: UserPosition[];
};

function calcProb(yesPool: number, noPool: number): number {
  const total = yesPool + noPool;
  if (total === 0) return 50;
  return (noPool / total) * 100;
}

const PositionItem = memo(function PositionItem({
  pos,
  isOpen,
  yesPool,
  noPool,
}: {
  pos: UserPosition;
  isOpen: boolean;
  yesPool: number;
  noPool: number;
}) {
  return (
    <div className="flex items-start justify-between">
      <div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-sm px-1.5 py-0.5 text-xs font-medium ${
              pos.outcome === 'yes'
                ? 'bg-green-950/30 text-green-400'
                : 'bg-red-950/30 text-red-400'
            }`}
          >
            {pos.outcome.toUpperCase()}
          </span>
          <span className="text-xs text-muted-foreground">
            {Math.round(pos.shares)} shares @ {Math.round(pos.cost)} tokens
          </span>
        </div>
        {isOpen && (
          <CancelBetButton
            positionId={pos.id}
            outcome={pos.outcome as 'yes' | 'no'}
            shares={pos.shares}
            cost={pos.cost}
            yesPool={yesPool}
            noPool={noPool}
          />
        )}
      </div>
    </div>
  );
});

export function MarketDetail({ market, initialPool, isAdmin, currentUserId, userPositions = [] }: MarketProps) {
  const [pool, setPool] = useState(initialPool);
  const yesProb = calcProb(pool.yesPool, pool.noPool);
  const noProb = 100 - yesProb;

  const closesAt = new Date(market.closesAt);
  const isOpen = market.status === 'open' && closesAt > new Date();
  const isResolved = market.status === 'resolved';
  const isCancelled = market.status === 'cancelled';

  // Debounced Realtime pool updates — coalesces rapid changes into a
  // single re-render (100ms window) to avoid cascading re-renders of
  // BetSlip/CancelBetButton on every micro-update.
  const pendingPoolRef = useRef<{ yesPool: number; noPool: number } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPool = useCallback(() => {
    if (pendingPoolRef.current) {
      setPool(pendingPoolRef.current);
      pendingPoolRef.current = null;
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`pool:${market.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'market_pools',
          filter: `market_id=eq.${market.id}`,
        },
        (payload) => {
          const row = payload.new as { yes_pool: number; no_pool: number };
          pendingPoolRef.current = {
            yesPool: Number(row.yes_pool),
            noPool: Number(row.no_pool),
          };
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(flushPool, 100);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [market.id, flushPool]);

  return (
    <div className="px-4 py-4">
      {/* Back link */}
      <Link href="/feed" className="mb-4 inline-block text-xs text-muted-foreground hover:text-foreground">
        &larr; Back to markets
      </Link>

      {/* Question */}
      <h1 className="mt-2 text-lg font-semibold leading-snug">{market.question}</h1>
      <p className="mt-1 text-xs text-muted-foreground">
        {format(new Date(market.createdAt), 'MMM d, yyyy')}
      </p>

      {/* Status */}
      <div className="mt-4">
        {isResolved && (
          <div className={`rounded-sm px-3 py-2 text-sm font-medium ${
            market.resolvedOutcome === 'yes'
              ? 'bg-green-900/30 text-green-400'
              : 'bg-red-900/30 text-red-400'
          }`}>
            Resolved: {market.resolvedOutcome?.toUpperCase()}
          </div>
        )}
        {isCancelled && (
          <div className="rounded-sm bg-yellow-900/30 px-3 py-2 text-sm font-medium text-yellow-400">
            Cancelled — all bets refunded
          </div>
        )}
      </div>

      {/* Odds display */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-sm border border-green-800/40 bg-green-950/20 p-4 text-center">
          <div className="text-2xl font-bold text-green-400">
            {Math.round(yesProb)}%
          </div>
          <div className="mt-1 text-xs text-muted-foreground">YES</div>
        </div>
        <div className="rounded-sm border border-red-800/40 bg-red-950/20 p-4 text-center">
          <div className="text-2xl font-bold text-red-400">
            {Math.round(noProb)}%
          </div>
          <div className="mt-1 text-xs text-muted-foreground">NO</div>
        </div>
      </div>

      {/* Pool info */}
      <div className="mt-3 flex justify-between text-xs text-muted-foreground">
        <span>Pool: {Math.round(pool.yesPool + pool.noPool)} tokens</span>
        <span>
          {isOpen ? (
            <>Closes {formatDistanceToNow(closesAt, { addSuffix: true })}</>
          ) : isResolved ? (
            'Resolved'
          ) : isCancelled ? (
            'Cancelled'
          ) : (
            'Closed'
          )}
        </span>
      </div>

      {/* Bet slip */}
      {isOpen && currentUserId && currentUserId !== market.creatorId && (
        <Suspense fallback={<div className="mt-4 h-48 animate-pulse rounded-sm border border-border bg-card" />}>
          <BetSlip
            marketId={market.id}
            yesPool={pool.yesPool}
            noPool={pool.noPool}
            userPositionCost={userPositions.reduce((sum, p) => sum + p.cost, 0)}
          />
        </Suspense>
      )}
      {isOpen && currentUserId && currentUserId === market.creatorId && (
        <div className="mt-4 rounded-sm border border-yellow-800/40 bg-yellow-950/20 px-4 py-3 text-sm text-yellow-400">
          You created this market — you cannot place bets on it.
        </div>
      )}

      {/* Your Positions */}
      {userPositions.length > 0 && (
        <div className="mt-4 rounded-sm border border-border bg-card p-4">
          <h3 className="text-xs font-medium text-muted-foreground">Your Positions</h3>
          <div className="mt-2 space-y-3">
            {userPositions.map((pos) => (
              <PositionItem
                key={pos.id}
                pos={pos}
                isOpen={isOpen}
                yesPool={pool.yesPool}
                noPool={pool.noPool}
              />
            ))}
          </div>
        </div>
      )}

      {/* Admin resolution panel */}
      {isAdmin && (
        <Suspense fallback={<div className="mt-6 h-32 animate-pulse rounded-sm border border-yellow-800/40 bg-yellow-950/10" />}>
          <AdminResolutionPanel
            marketId={market.id}
            resolutionCriteria={market.resolutionCriteria}
            status={market.status}
          />
        </Suspense>
      )}

      {/* Resolution criteria */}
      <div className="mt-6 rounded-sm border border-border bg-card p-4">
        <h3 className="text-xs font-medium text-muted-foreground">Resolution Criteria</h3>
        <p className="mt-1 text-sm">{market.resolutionCriteria}</p>
      </div>
    </div>
  );
}
