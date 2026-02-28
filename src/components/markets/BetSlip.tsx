'use client';

import { useState, useMemo, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Decimal from 'decimal.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { placeBet } from '@/lib/markets/actions';
import { previewTrade } from '@/lib/amm/cpmm';
import { useUserBalance } from '@/hooks/useUserBalance';
import { toast } from 'sonner';

type BetSlipProps = {
  marketId: string;
  yesPool: number;
  noPool: number;
  userPositionCost: number;
  totalSharesByOutcome?: Record<string, number>;
  totalCostByOutcome?: Record<string, number>;
};

export function BetSlip({ marketId, yesPool, noPool, userPositionCost, totalSharesByOutcome = {}, totalCostByOutcome = {} }: BetSlipProps) {
  const router = useRouter();
  const { balance } = useUserBalance();
  const [outcome, setOutcome] = useState<'yes' | 'no'>('yes');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();

  const numAmount = Number(amount) || 0;

  // Max single bet = 25% of pool
  const totalPool = yesPool + noPool;
  const maxBet = Math.floor(totalPool * 0.25);
  // Per-market total limit = 25% of pool; subtract existing investment
  const maxMarketTotal = Math.floor(totalPool * 0.25);
  const remaining = Math.max(0, Math.floor(maxMarketTotal - userPositionCost));
  const effectiveMax = Math.min(maxBet, remaining, balance);
  const exceedsMax = numAmount > maxBet;
  const exceedsMarketLimit = numAmount > remaining;

  // Preview payout using the CPMM math
  const preview = useMemo(() => {
    if (numAmount <= 0 || numAmount > maxBet) return null;
    try {
      const pool = {
        yesPool: new Decimal(yesPool),
        noPool: new Decimal(noPool),
      };
      const result = previewTrade(pool, outcome, new Decimal(numAmount));
      const shares = result.sharesReceived.toDecimalPlaces(2).toNumber();

      // Hybrid payout estimate: refund cost + share of surplus
      const newTotalPool = yesPool + noPool + numAmount - shares;
      const existingWinningShares = totalSharesByOutcome[outcome] ?? 0;
      const totalWinningShares = existingWinningShares + shares;
      const existingCost = totalCostByOutcome[outcome] ?? 0;
      const totalWinningCost = existingCost + numAmount;
      const surplus = newTotalPool - totalWinningCost;
      const estPayout = totalWinningShares > 0
        ? surplus >= 0
          ? numAmount + (shares / totalWinningShares) * surplus
          : numAmount * (newTotalPool / totalWinningCost)
        : 0;
      const multiplier = numAmount > 0 ? estPayout / numAmount : 0;

      return {
        shares: Math.round(shares),
        estPayout: Math.round(estPayout),
        multiplier,
        impliedProb: result.impliedProbability.mul(100).toDecimalPlaces(0).toNumber(),
      };
    } catch {
      return null;
    }
  }, [numAmount, outcome, yesPool, noPool, maxBet, totalSharesByOutcome, totalCostByOutcome]);

  async function handleBet() {
    if (numAmount <= 0 || numAmount > balance || numAmount > maxBet || numAmount > remaining) return;

    setLoading(true);
    const result = await placeBet({
      marketId,
      outcome,
      amount: numAmount,
    });
    setLoading(false);

    if (result.success) {
      toast.success(`Bet placed — ${Math.round(result.data.shares)} shares`);
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
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          onClick={() => setOutcome('yes')}
          className={`rounded-sm border px-3 py-2 text-sm font-medium transition-all active:scale-[0.97] ${
            outcome === 'yes'
              ? 'border-green-500 bg-green-950/30 text-green-400'
              : 'border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          YES
        </button>
        <button
          onClick={() => setOutcome('no')}
          className={`rounded-sm border px-3 py-2 text-sm font-medium transition-all active:scale-[0.97] ${
            outcome === 'no'
              ? 'border-red-500 bg-red-950/30 text-red-400'
              : 'border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          NO
        </button>
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

      {/* Payout preview */}
      {preview && numAmount > 0 && (
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

      {/* Insufficient balance notice */}
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
        disabled={loading || numAmount <= 0 || numAmount > balance || numAmount > maxBet || numAmount > remaining}
      >
        {loading ? 'Placing bet...' : `Bet ${numAmount || 0} on ${outcome.toUpperCase()}`}
      </Button>
    </div>
  );
}
