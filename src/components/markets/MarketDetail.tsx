'use client';

import { useState, useEffect, useRef, useCallback, lazy, Suspense, memo } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { formatDistanceToNow, format } from 'date-fns';
import { CancelBetButton } from './CancelBetButton';
import { getOutcomeColor } from '@/lib/markets/outcome-colors';

import { ActivityFeed, type ActivityItem } from './ActivityFeed';

// Lazy-load heavy components that are conditionally rendered
const BetSlip = lazy(() => import('./BetSlip').then(m => ({ default: m.BetSlip })));
const BetSlipMulti = lazy(() => import('./BetSlipMulti').then(m => ({ default: m.BetSlipMulti })));
const AdminResolutionPanel = lazy(() => import('./AdminResolutionPanel').then(m => ({ default: m.AdminResolutionPanel })));
const ProbabilityTrendChart = lazy(() => import('./ProbabilityTrendChart').then(m => ({ default: m.ProbabilityTrendChart })));

type UserPosition = {
  id: string;
  outcome: string;
  outcome_id: string | null;
  shares: number;
  cost: number;
  cancelled_at: string | null;
};

type PositionRecord = {
  outcome: 'yes' | 'no';
  shares: number;
  cost: number;
  createdAt: string;
};

export type MarketOutcome = {
  id: string;
  label: string;
  sortOrder: number;
};

export type OutcomePool = {
  outcomeId: string;
  pool: number;
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
    marketType: 'binary' | 'multiple_choice';
  };
  initialPool: {
    yesPool: number;
    noPool: number;
  };
  isAdmin?: boolean;
  currentUserId: string | null;
  userPositions?: UserPosition[];
  positionHistory?: PositionRecord[];
  volume?: number;
  activityFeed?: ActivityItem[];
  // Multi-choice specific
  outcomes?: MarketOutcome[];
  initialOutcomePools?: OutcomePool[];
  totalSharesByOutcome?: Record<string, number>;
  totalCostByOutcome?: Record<string, number>;
};

function calcProb(yesPool: number, noPool: number): number {
  const total = yesPool + noPool;
  if (total === 0) return 50;
  return (noPool / total) * 100;
}

function calcMultiProb(pool: number, allPools: { pool: number }[]): number {
  const recipSum = allPools.reduce((sum, p) => sum + (1 / p.pool), 0);
  if (recipSum === 0) return 0;
  return ((1 / pool) / recipSum) * 100;
}

const PositionItem = memo(function PositionItem({
  pos,
  isOpen,
  yesPool,
  noPool,
  marketType,
  outcomePools,
  outcomes,
}: {
  pos: UserPosition;
  isOpen: boolean;
  yesPool: number;
  noPool: number;
  marketType: 'binary' | 'multiple_choice';
  outcomePools?: OutcomePool[];
  outcomes?: MarketOutcome[];
}) {
  const isBinary = marketType === 'binary';
  const outcomeObj = !isBinary && outcomes
    ? outcomes.find(o => o.id === pos.outcome_id)
    : null;
  const color = isBinary
    ? pos.outcome === 'yes'
      ? { bg: 'bg-green-950/30', text: 'text-green-400' }
      : { bg: 'bg-red-950/30', text: 'text-red-400' }
    : outcomeObj
      ? getOutcomeColor(outcomeObj.sortOrder)
      : { bg: 'bg-secondary', text: 'text-foreground' };

  return (
    <div className="flex items-start justify-between">
      <div>
        <div className="flex items-center gap-2">
          <span className={`rounded-sm px-1.5 py-0.5 text-xs font-medium ${color.bg} ${color.text}`}>
            {isBinary ? pos.outcome.toUpperCase() : pos.outcome}
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
            marketType={marketType}
            outcomePools={outcomePools}
            outcomeId={pos.outcome_id ?? undefined}
          />
        )}
      </div>
    </div>
  );
});

export function MarketDetail({
  market,
  initialPool,
  isAdmin,
  currentUserId,
  userPositions = [],
  positionHistory = [],
  volume = 0,
  activityFeed = [],
  outcomes,
  initialOutcomePools,
  totalSharesByOutcome = {},
  totalCostByOutcome = {},
}: MarketProps) {
  const isMultiChoice = market.marketType === 'multiple_choice';

  // Binary pool state
  const [pool, setPool] = useState(initialPool);
  const yesProb = calcProb(pool.yesPool, pool.noPool);
  const noProb = 100 - yesProb;

  // Multi-choice pool state
  const [outcomePools, setOutcomePools] = useState<OutcomePool[]>(initialOutcomePools ?? []);

  const closesAt = new Date(market.closesAt);
  const isOpen = market.status === 'open' && closesAt > new Date();
  const isResolved = market.status === 'resolved';
  const isCancelled = market.status === 'cancelled';

  // Debounced Realtime pool updates
  const pendingPoolRef = useRef<{ yesPool: number; noPool: number } | null>(null);
  const pendingMcPoolRef = useRef<OutcomePool[] | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPool = useCallback(() => {
    if (pendingPoolRef.current) {
      setPool(pendingPoolRef.current);
      pendingPoolRef.current = null;
    }
    if (pendingMcPoolRef.current) {
      setOutcomePools(pendingMcPoolRef.current);
      pendingMcPoolRef.current = null;
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();

    if (isMultiChoice) {
      // Subscribe to outcome_pools updates
      const channel = supabase
        .channel(`mc-pool:${market.id}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'outcome_pools',
            filter: `market_id=eq.${market.id}`,
          },
          (payload) => {
            const row = payload.new as { outcome_id: string; pool: number };
            setOutcomePools(prev => {
              const updated = [...prev];
              const idx = updated.findIndex(p => p.outcomeId === row.outcome_id);
              if (idx >= 0) {
                updated[idx] = { ...updated[idx], pool: Number(row.pool) };
              }
              return updated;
            });
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    } else {
      // Binary: subscribe to market_pools
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
    }
  }, [market.id, isMultiChoice, flushPool]);

  // Multi-choice: compute total pool for display
  const mcTotalPool = outcomePools.reduce((sum, p) => sum + p.pool, 0);

  // Build sorted outcomes with current pools for multi-choice
  const sortedOutcomes = outcomes
    ? [...outcomes].sort((a, b) => a.sortOrder - b.sortOrder).map(o => {
        const poolData = outcomePools.find(p => p.outcomeId === o.id);
        const prob = poolData ? calcMultiProb(poolData.pool, outcomePools) : 0;
        return { ...o, pool: poolData?.pool ?? 0, probability: prob };
      })
    : [];

  // Leading outcome for resolved display
  const leadingOutcome = sortedOutcomes.length > 0
    ? sortedOutcomes.reduce((a, b) => a.probability > b.probability ? a : b)
    : null;

  return (
    <div className="px-4 py-4">
      {/* Back link */}
      <Link href="/feed" className="mb-4 inline-block text-xs text-muted-foreground hover:text-foreground">
        &larr; Back to markets
      </Link>

      {/* Question */}
      <h1 className="mt-2 text-lg font-semibold leading-snug">{market.question}</h1>
      <div className="mt-1 flex items-center gap-2">
        <p className="text-xs text-muted-foreground">
          {format(new Date(market.createdAt), 'MMM d, yyyy')}
        </p>
        {isMultiChoice && (
          <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            MULTIPLE CHOICE
          </span>
        )}
      </div>

      {/* Status */}
      <div className="mt-4">
        {isResolved && (
          <div className={`rounded-sm px-3 py-2 text-sm font-medium ${
            isMultiChoice
              ? 'bg-blue-900/30 text-blue-400'
              : market.resolvedOutcome === 'yes'
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
      {isMultiChoice ? (
        <div className="mt-4 space-y-2">
          {sortedOutcomes.map((o) => {
            const color = getOutcomeColor(o.sortOrder);
            const multiplier = o.probability > 0 ? (100 / o.probability) : 0;
            return (
              <div key={o.id} className={`rounded-sm border ${color.border} p-3`}>
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-medium ${color.text}`}>{o.label}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {multiplier >= 1.01 ? `${multiplier.toFixed(1)}x` : '—'}
                    </span>
                    <span className={`text-lg font-bold ${color.text}`}>
                      {Math.round(o.probability)}%
                    </span>
                  </div>
                </div>
                <div className="mt-1.5 h-1.5 w-full rounded-full bg-secondary/50">
                  <div
                    className={`h-full rounded-full transition-all duration-300`}
                    style={{
                      width: `${Math.round(o.probability)}%`,
                      backgroundColor: color.hex,
                      opacity: 0.7,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-sm border border-green-800/40 bg-green-950/20 p-4 text-center">
            <div className="text-2xl font-bold text-green-400">
              {Math.round(yesProb)}%
            </div>
            <div className="mt-1 flex items-center justify-center gap-1.5">
              <span className="text-xs text-muted-foreground">YES</span>
              <span className="text-xs font-medium text-green-400/70">
                {yesProb > 0 ? `${(100 / yesProb).toFixed(1)}x` : '—'}
              </span>
            </div>
          </div>
          <div className="rounded-sm border border-red-800/40 bg-red-950/20 p-4 text-center">
            <div className="text-2xl font-bold text-red-400">
              {Math.round(noProb)}%
            </div>
            <div className="mt-1 flex items-center justify-center gap-1.5">
              <span className="text-xs text-muted-foreground">NO</span>
              <span className="text-xs font-medium text-red-400/70">
                {noProb > 0 ? `${(100 / noProb).toFixed(1)}x` : '—'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Probability trend chart — binary only */}
      {!isMultiChoice && (
        <Suspense fallback={<div className="mt-4 h-[128px] animate-pulse rounded-sm border border-border bg-card" />}>
          <ProbabilityTrendChart
            positionHistory={positionHistory}
            currentPool={pool}
            createdAt={market.createdAt}
          />
        </Suspense>
      )}

      {/* Pool info */}
      <div className="mt-3 flex justify-between text-xs text-muted-foreground">
        <span>
          Pool: {Math.round(isMultiChoice ? mcTotalPool : pool.yesPool + pool.noPool).toLocaleString()}
          {volume > 0 && <> · Vol: {Math.round(volume).toLocaleString()}</>}
        </span>
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
      {isOpen && currentUserId && (isAdmin || currentUserId !== market.creatorId) && (
        <Suspense fallback={<div className="mt-4 h-48 animate-pulse rounded-sm border border-border bg-card" />}>
          {isMultiChoice ? (
            <BetSlipMulti
              marketId={market.id}
              outcomes={sortedOutcomes.map(o => ({
                id: o.id,
                label: o.label,
                pool: o.pool,
                sortOrder: o.sortOrder,
              }))}
              userPositionCost={userPositions.reduce((sum, p) => sum + p.cost, 0)}
              totalSharesByOutcome={totalSharesByOutcome}
              totalCostByOutcome={totalCostByOutcome}
            />
          ) : (
            <BetSlip
              marketId={market.id}
              yesPool={pool.yesPool}
              noPool={pool.noPool}
              userPositionCost={userPositions.reduce((sum, p) => sum + p.cost, 0)}
              totalSharesByOutcome={totalSharesByOutcome}
              totalCostByOutcome={totalCostByOutcome}
            />
          )}
        </Suspense>
      )}
      {isOpen && currentUserId && currentUserId === market.creatorId && !isAdmin && (
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
                marketType={market.marketType}
                outcomePools={outcomePools}
                outcomes={outcomes}
              />
            ))}
          </div>
        </div>
      )}

      {/* Activity feed */}
      <ActivityFeed
        marketId={market.id}
        initialItems={activityFeed}
        marketType={market.marketType}
        outcomes={outcomes}
      />

      {/* Admin resolution panel */}
      {isAdmin && (
        <Suspense fallback={<div className="mt-6 h-32 animate-pulse rounded-sm border border-yellow-800/40 bg-yellow-950/10" />}>
          <AdminResolutionPanel
            marketId={market.id}
            resolutionCriteria={market.resolutionCriteria}
            status={market.status}
            marketType={market.marketType}
            outcomes={outcomes}
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
