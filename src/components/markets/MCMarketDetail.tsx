'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatDistanceToNow, format } from 'date-fns';
import Decimal from 'decimal.js';
import { mcProbabilities } from '@/lib/amm/cpmm';
import { MCBetSlip } from './MCBetSlip';
import { MCAdminResolutionPanel } from './MCAdminResolutionPanel';
import { MCCancelBetButton } from './MCCancelBetButton';

type MCOption = {
  id: string;
  label: string;
  pool: number;
  sort_order: number;
};

type UserPosition = {
  id: string;
  outcome: string;
  shares: number;
  cost: number;
  cancelled_at: string | null;
  market_option_id: string | null;
};

type MCMarketProps = {
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
  initialOptions: MCOption[];
  isAdmin?: boolean;
  currentUserId: string | null;
  userPositions?: UserPosition[];
};

const OPTION_COLORS = [
  { border: 'border-blue-800/40', bg: 'bg-blue-950/20', text: 'text-blue-400', badge: 'bg-blue-950/30 text-blue-400' },
  { border: 'border-purple-800/40', bg: 'bg-purple-950/20', text: 'text-purple-400', badge: 'bg-purple-950/30 text-purple-400' },
  { border: 'border-amber-800/40', bg: 'bg-amber-950/20', text: 'text-amber-400', badge: 'bg-amber-950/30 text-amber-400' },
  { border: 'border-emerald-800/40', bg: 'bg-emerald-950/20', text: 'text-emerald-400', badge: 'bg-emerald-950/30 text-emerald-400' },
  { border: 'border-rose-800/40', bg: 'bg-rose-950/20', text: 'text-rose-400', badge: 'bg-rose-950/30 text-rose-400' },
  { border: 'border-cyan-800/40', bg: 'bg-cyan-950/20', text: 'text-cyan-400', badge: 'bg-cyan-950/30 text-cyan-400' },
  { border: 'border-orange-800/40', bg: 'bg-orange-950/20', text: 'text-orange-400', badge: 'bg-orange-950/30 text-orange-400' },
  { border: 'border-pink-800/40', bg: 'bg-pink-950/20', text: 'text-pink-400', badge: 'bg-pink-950/30 text-pink-400' },
  { border: 'border-teal-800/40', bg: 'bg-teal-950/20', text: 'text-teal-400', badge: 'bg-teal-950/30 text-teal-400' },
  { border: 'border-indigo-800/40', bg: 'bg-indigo-950/20', text: 'text-indigo-400', badge: 'bg-indigo-950/30 text-indigo-400' },
];

function getColor(index: number) {
  return OPTION_COLORS[index % OPTION_COLORS.length];
}

export function MCMarketDetail({ market, initialOptions, isAdmin, currentUserId, userPositions = [] }: MCMarketProps) {
  const [options, setOptions] = useState(initialOptions);

  const closesAt = new Date(market.closesAt);
  const isOpen = market.status === 'open' && closesAt > new Date();
  const isResolved = market.status === 'resolved';
  const isCancelled = market.status === 'cancelled';

  // Compute probabilities
  const probs = (() => {
    try {
      const pools = options.map((o) => new Decimal(o.pool));
      return mcProbabilities({ pools }).map((p) => Math.round(p.mul(100).toNumber()));
    } catch {
      return options.map(() => Math.round(100 / options.length));
    }
  })();

  const totalPool = options.reduce((sum, o) => sum + o.pool, 0);

  // Find winning option label if resolved
  const winningOption = isResolved
    ? options.find((o) => o.id === market.resolvedOutcome)
    : null;

  // Debounced Realtime for option pool updates
  const pendingOptionsRef = useRef<MCOption[] | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushOptions = useCallback(() => {
    if (pendingOptionsRef.current) {
      setOptions(pendingOptionsRef.current);
      pendingOptionsRef.current = null;
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`mc-pool:${market.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'market_options',
          filter: `market_id=eq.${market.id}`,
        },
        (payload) => {
          const row = payload.new as { id: string; pool: number; label: string; sort_order: number };
          // Merge the updated option into the current pending state
          const base = pendingOptionsRef.current ?? options;
          pendingOptionsRef.current = base.map((o) =>
            o.id === row.id ? { ...o, pool: Number(row.pool) } : o
          );
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(flushOptions, 100);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [market.id, options, flushOptions]);

  return (
    <div className="px-4 py-4">
      {/* Back link */}
      <a href="/feed" className="mb-4 inline-block text-xs text-muted-foreground hover:text-foreground">
        &larr; Back to markets
      </a>

      {/* Question */}
      <h1 className="mt-2 text-lg font-semibold leading-snug">{market.question}</h1>
      <p className="mt-1 text-xs text-muted-foreground">
        {format(new Date(market.createdAt), 'MMM d, yyyy')}
        <span className="ml-2 rounded-sm border border-border px-1.5 py-0.5 text-[10px]">
          Multiple Choice
        </span>
      </p>

      {/* Status */}
      <div className="mt-4">
        {isResolved && winningOption && (
          <div className="rounded-sm bg-green-900/30 px-3 py-2 text-sm font-medium text-green-400">
            Resolved: {winningOption.label}
          </div>
        )}
        {isCancelled && (
          <div className="rounded-sm bg-yellow-900/30 px-3 py-2 text-sm font-medium text-yellow-400">
            Cancelled — all bets refunded
          </div>
        )}
      </div>

      {/* Odds display — stacked list of options */}
      <div className="mt-4 space-y-2">
        {options
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((opt, i) => {
            const color = getColor(i);
            const prob = probs[i];
            const isWinner = isResolved && opt.id === market.resolvedOutcome;
            return (
              <div
                key={opt.id}
                className={`rounded-sm border ${color.border} ${color.bg} p-3 flex items-center justify-between ${
                  isWinner ? 'ring-1 ring-green-500' : ''
                }`}
              >
                <span className={`text-sm font-medium ${color.text}`}>
                  {opt.label}
                  {isWinner && <span className="ml-2 text-green-400 text-xs">Winner</span>}
                </span>
                <span className={`text-lg font-bold ${color.text}`}>
                  {prob}%
                </span>
              </div>
            );
          })}
      </div>

      {/* Pool info */}
      <div className="mt-3 flex justify-between text-xs text-muted-foreground">
        <span>Pool: {Math.round(totalPool)} tokens</span>
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
        <MCBetSlip
          marketId={market.id}
          options={options}
          userPositionCost={userPositions.reduce((sum, p) => sum + p.cost, 0)}
        />
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
            {userPositions.map((pos) => {
              const optionIdx = options.findIndex((o) => o.id === pos.market_option_id);
              const color = optionIdx >= 0 ? getColor(optionIdx) : OPTION_COLORS[0];
              return (
                <div key={pos.id} className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-sm px-1.5 py-0.5 text-xs font-medium ${color.badge}`}>
                        {pos.outcome}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {Math.round(pos.shares)} shares @ {Math.round(pos.cost)} tokens
                      </span>
                    </div>
                    {isOpen && optionIdx >= 0 && (
                      <MCCancelBetButton
                        positionId={pos.id}
                        optionIndex={optionIdx}
                        shares={pos.shares}
                        cost={pos.cost}
                        pools={options.map((o) => o.pool)}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Admin resolution panel */}
      {isAdmin && (
        <MCAdminResolutionPanel
          marketId={market.id}
          resolutionCriteria={market.resolutionCriteria}
          status={market.status}
          options={options.map((o) => ({ id: o.id, label: o.label }))}
        />
      )}

      {/* Resolution criteria */}
      <div className="mt-6 rounded-sm border border-border bg-card p-4">
        <h3 className="text-xs font-medium text-muted-foreground">Resolution Criteria</h3>
        <p className="mt-1 text-sm">{market.resolutionCriteria}</p>
      </div>
    </div>
  );
}
