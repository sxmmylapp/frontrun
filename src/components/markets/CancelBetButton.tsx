'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Decimal from 'decimal.js';
import { Button } from '@/components/ui/button';
import { cancelBet } from '@/lib/markets/actions';
import { previewSell } from '@/lib/amm/cpmm';
import { toast } from 'sonner';

type CancelBetButtonProps = {
  positionId: string;
  outcome: 'yes' | 'no';
  shares: number;
  cost: number;
  yesPool: number;
  noPool: number;
};

export function CancelBetButton({
  positionId,
  outcome,
  shares,
  cost,
  yesPool,
  noPool,
}: CancelBetButtonProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  const preview = useMemo(() => {
    try {
      const pool = {
        yesPool: new Decimal(yesPool),
        noPool: new Decimal(noPool),
      };
      const result = previewSell(pool, outcome, new Decimal(shares));
      const tokensBack = result.tokensReceived.toDecimalPlaces(0).toNumber();
      const pnl = tokensBack - cost;
      return { tokensBack, pnl };
    } catch {
      return null;
    }
  }, [outcome, shares, cost, yesPool, noPool]);

  async function handleCancel() {
    setLoading(true);
    const result = await cancelBet({ positionId });
    setLoading(false);

    if (result.success) {
      const pnl = result.data.tokensReturned - result.data.originalCost;
      toast.success(
        `Bet cancelled - ${Math.round(result.data.tokensReturned)} tokens returned (${pnl >= 0 ? '+' : ''}${Math.round(pnl)})`
      );
      setConfirming(false);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="text-xs text-yellow-400 hover:text-yellow-300"
      >
        Cancel bet
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-sm border border-yellow-800/40 bg-yellow-950/10 p-3">
      <p className="text-xs font-medium text-yellow-400">Cancel this bet?</p>
      {preview && (
        <div className="mt-2 space-y-1 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">You paid</span>
            <span>{Math.round(cost)} tokens</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">You'll receive</span>
            <span className="font-medium">{Math.round(preview.tokensBack)} tokens</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">P&L</span>
            <span
              className={`font-mono ${
                preview.pnl > 0
                  ? 'text-green-400'
                  : preview.pnl < 0
                    ? 'text-red-400'
                    : 'text-muted-foreground'
              }`}
            >
              {preview.pnl >= 0 ? '+' : ''}{Math.round(preview.pnl)}
            </span>
          </div>
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          variant="destructive"
          className="rounded-sm text-xs"
          onClick={handleCancel}
          disabled={loading}
        >
          {loading ? 'Cancelling...' : 'Confirm cancel'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="rounded-sm text-xs"
          onClick={() => setConfirming(false)}
          disabled={loading}
        >
          Keep bet
        </Button>
      </div>
    </div>
  );
}
