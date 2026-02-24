'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Decimal from 'decimal.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { placeBetMC } from '@/lib/markets/actions';
import { mcPreviewTrade } from '@/lib/amm/cpmm';
import { useUserBalance } from '@/hooks/useUserBalance';
import { toast } from 'sonner';

type MCOption = {
  id: string;
  label: string;
  pool: number;
  sort_order: number;
};

type MCBetSlipProps = {
  marketId: string;
  options: MCOption[];
  userPositionCost: number;
};

export function MCBetSlip({ marketId, options, userPositionCost }: MCBetSlipProps) {
  const router = useRouter();
  const { balance } = useUserBalance();
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);

  const numAmount = Number(amount) || 0;

  const totalPool = options.reduce((sum, o) => sum + o.pool, 0);
  const maxBet = Math.floor(totalPool * 0.25);
  const maxMarketTotal = Math.floor(totalPool * 0.25);
  const remaining = Math.max(0, Math.floor(maxMarketTotal - userPositionCost));
  const effectiveMax = Math.min(maxBet, remaining, balance);
  const exceedsMax = numAmount > maxBet;
  const exceedsMarketLimit = numAmount > remaining;

  const selectedIndex = options.findIndex((o) => o.id === selectedOptionId);

  const preview = useMemo(() => {
    if (numAmount <= 0 || numAmount > maxBet || selectedIndex < 0) return null;
    try {
      const pools = options.map((o) => new Decimal(o.pool));
      const result = mcPreviewTrade(
        { pools },
        selectedIndex,
        new Decimal(numAmount)
      );
      return {
        shares: result.sharesReceived.toDecimalPlaces(0).toNumber(),
        newProb: result.newProbabilities[selectedIndex].mul(100).toDecimalPlaces(0).toNumber(),
      };
    } catch {
      return null;
    }
  }, [numAmount, selectedIndex, options, maxBet]);

  async function handleBet() {
    if (!selectedOptionId || numAmount <= 0 || numAmount > balance || numAmount > maxBet || numAmount > remaining) return;

    setLoading(true);
    const result = await placeBetMC({
      marketId,
      optionId: selectedOptionId,
      amount: numAmount,
    });
    setLoading(false);

    if (result.success) {
      toast.success(`Bet placed — ${Math.round(result.data.shares)} shares`);
      setAmount('');
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  const selectedLabel = selectedOptionId
    ? options.find((o) => o.id === selectedOptionId)?.label ?? ''
    : '';

  return (
    <div className="mt-4 rounded-sm border border-border bg-card p-4">
      <h3 className="text-xs font-medium text-muted-foreground">Place Bet</h3>

      {/* Option selector */}
      <div className="mt-3 space-y-2">
        {options.map((opt) => (
          <button
            key={opt.id}
            onClick={() => setSelectedOptionId(opt.id)}
            className={`w-full rounded-sm border px-3 py-2 text-left text-sm font-medium transition-colors ${
              selectedOptionId === opt.id
                ? 'border-blue-500 bg-blue-950/30 text-blue-400'
                : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Amount input */}
      {selectedOptionId && (
        <>
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
          {preview && numAmount > 0 && (
            <div className="mt-3 space-y-1 rounded-sm bg-secondary/50 p-3 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Shares received</span>
                <span>{preview.shares}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">New probability</span>
                <span>{preview.newProb}%</span>
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
            disabled={loading || numAmount <= 0 || numAmount > balance || numAmount > maxBet || numAmount > remaining}
          >
            {loading ? 'Placing bet...' : `Bet ${numAmount || 0} on ${selectedLabel}`}
          </Button>
        </>
      )}
    </div>
  );
}
