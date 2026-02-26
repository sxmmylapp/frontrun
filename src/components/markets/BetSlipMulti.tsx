'use client';

import { useState, useMemo, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Decimal from 'decimal.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { placeBet } from '@/lib/markets/actions';
import { buyShares } from '@/lib/amm/cpmm-multi';
import { useUserBalance } from '@/hooks/useUserBalance';
import { getOutcomeColor } from '@/lib/markets/outcome-colors';
import { toast } from 'sonner';

export type OutcomeOption = {
  id: string;
  label: string;
  pool: number;
  sortOrder: number;
};

type BetSlipMultiProps = {
  marketId: string;
  outcomes: OutcomeOption[];
  userPositionCost: number;
  totalSharesByOutcome?: Record<string, number>;
};

export function BetSlipMulti({ marketId, outcomes, userPositionCost, totalSharesByOutcome = {} }: BetSlipMultiProps) {
  const router = useRouter();
  const { balance } = useUserBalance();
  const [selectedOutcome, setSelectedOutcome] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();

  const numAmount = Number(amount) || 0;

  // Total pool across all outcomes
  const mcTotalPool = outcomes.reduce((sum, o) => sum + o.pool, 0);
  const maxBet = Math.floor(mcTotalPool * 0.25);
  const maxMarketTotal = Math.floor(mcTotalPool * 0.25);
  const remaining = Math.max(0, Math.floor(maxMarketTotal - userPositionCost));
  const effectiveMax = Math.min(maxBet, remaining, balance);
  const exceedsMax = numAmount > maxBet;
  const exceedsMarketLimit = numAmount > remaining;

  // Preview using CPMM multi math
  const preview = useMemo(() => {
    if (!selectedOutcome || numAmount <= 0 || numAmount > maxBet) return null;
    try {
      const pools = new Map<string, Decimal>();
      for (const o of outcomes) {
        pools.set(o.id, new Decimal(o.pool));
      }
      const result = buyShares(pools, selectedOutcome, new Decimal(numAmount));
      const shares = result.sharesReceived.toDecimalPlaces(2).toNumber();

      // Total pool after trade
      let newTotalPool = 0;
      for (const p of result.newPools.values()) {
        newTotalPool += p.toNumber();
      }

      // Realistic payout: shares * (totalPool / totalWinningShares)
      const existingWinningShares = totalSharesByOutcome[selectedOutcome] ?? 0;
      const totalWinningShares = existingWinningShares + shares;
      const estPayout = totalWinningShares > 0
        ? shares * (newTotalPool / totalWinningShares)
        : 0;
      const multiplier = numAmount > 0 ? estPayout / numAmount : 0;

      const impliedProb = result.newProbabilities.get(selectedOutcome);
      return {
        shares: Math.round(shares),
        estPayout: Math.round(estPayout),
        multiplier,
        impliedProb: impliedProb ? impliedProb.mul(100).toDecimalPlaces(0).toNumber() : 0,
      };
    } catch {
      return null;
    }
  }, [numAmount, selectedOutcome, outcomes, maxBet, totalSharesByOutcome]);

  async function handleBet() {
    if (!selectedOutcome || numAmount <= 0 || numAmount > balance || numAmount > maxBet || numAmount > remaining) return;

    const selected = outcomes.find(o => o.id === selectedOutcome);
    if (!selected) return;

    setLoading(true);
    const result = await placeBet({
      marketId,
      outcome: selected.label,
      outcomeId: selected.id,
      amount: numAmount,
    });
    setLoading(false);

    if (result.success) {
      toast.success(`Bet placed — ${Math.round(result.data.shares)} shares on ${selected.label}`);
      setAmount('');
      startTransition(() => { router.refresh(); });
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="mt-4 rounded-sm border border-border bg-card p-4">
      <h3 className="text-xs font-medium text-muted-foreground">Place Bet</h3>

      {/* Outcome selector */}
      <div className="mt-3 flex flex-wrap gap-2">
        {outcomes.map((o) => {
          const color = getOutcomeColor(o.sortOrder);
          const isSelected = selectedOutcome === o.id;
          return (
            <button
              key={o.id}
              onClick={() => setSelectedOutcome(o.id)}
              className={`rounded-sm border px-3 py-2 text-sm font-medium transition-all active:scale-[0.97] ${
                isSelected
                  ? `${color.border} ${color.bg} ${color.text}`
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>

      {/* Amount input */}
      <div className="mt-3">
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="numeric"
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="rounded-sm"
            min={1}
            max={effectiveMax}
          />
          <button
            onClick={() => setAmount(String(effectiveMax))}
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
          >
            Max
          </button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Balance: {Math.round(balance).toLocaleString()} tokens · Max bet: {Math.round(effectiveMax).toLocaleString()} tokens
        </p>
        {userPositionCost > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            Invested: {Math.round(userPositionCost).toLocaleString()} / {Math.round(maxMarketTotal).toLocaleString()} tokens on this market
          </p>
        )}
        {exceedsMax && numAmount > 0 && (
          <p className="mt-1 text-xs text-red-400">
            Exceeds 25% pool limit ({Math.round(maxBet).toLocaleString()} tokens)
          </p>
        )}
        {!exceedsMax && exceedsMarketLimit && numAmount > 0 && (
          <p className="mt-1 text-xs text-red-400">
            Exceeds per-market limit ({Math.round(remaining).toLocaleString()} tokens remaining)
          </p>
        )}
      </div>

      {/* Preview */}
      {preview && numAmount > 0 && selectedOutcome && (
        <div className="mt-3 space-y-1 rounded-sm bg-secondary/50 p-3 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Potential return</span>
            <span className="font-semibold text-foreground">
              {preview.multiplier > 0 ? `${preview.multiplier.toFixed(2)}x` : '—'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Est. payout</span>
            <span className="font-medium">{preview.estPayout.toLocaleString()} tokens</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Shares received</span>
            <span>{preview.shares}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">New probability</span>
            <span>{preview.impliedProb}%</span>
          </div>
        </div>
      )}

      {/* Insufficient balance */}
      {numAmount > 0 && numAmount > balance && (
        <div className="mt-3 rounded-sm border border-red-800/40 bg-red-950/10 p-3 text-center">
          <p className="text-xs text-muted-foreground">
            Insufficient balance — you need {Math.round(numAmount - balance).toLocaleString()} more tokens
          </p>
        </div>
      )}

      {/* Submit */}
      <Button
        className="mt-3 w-full rounded-sm"
        onClick={handleBet}
        disabled={loading || !selectedOutcome || numAmount <= 0 || numAmount > balance || numAmount > maxBet || numAmount > remaining}
      >
        {loading
          ? 'Placing bet...'
          : selectedOutcome
            ? `Bet ${numAmount || 0} on ${outcomes.find(o => o.id === selectedOutcome)?.label ?? ''}`
            : 'Select an outcome'}
      </Button>
    </div>
  );
}
