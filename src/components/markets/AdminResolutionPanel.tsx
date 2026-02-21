'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { resolveMarket, cancelMarket } from '@/lib/markets/admin-actions';
import { toast } from 'sonner';

type Props = {
  marketId: string;
  resolutionCriteria: string;
  status: string;
};

export function AdminResolutionPanel({ marketId, resolutionCriteria, status }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'yes' | 'no' | 'cancel' | null>(null);

  const canResolve = status === 'open' || status === 'closed';
  if (!canResolve) return null;

  async function handleResolve(outcome: 'yes' | 'no') {
    setLoading(true);
    const result = await resolveMarket({ marketId, outcome });
    setLoading(false);
    setConfirmAction(null);

    if (result.success) {
      toast.success(`Resolved ${outcome.toUpperCase()} — ${result.data.winnersPaid} tokens paid out`);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  async function handleCancel() {
    setLoading(true);
    const result = await cancelMarket({ marketId });
    setLoading(false);
    setConfirmAction(null);

    if (result.success) {
      toast.success(`Market cancelled — ${result.data.totalRefunded} tokens refunded`);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="mt-6 rounded-sm border border-yellow-800/40 bg-yellow-950/10 p-4">
      <h3 className="text-xs font-medium text-yellow-400">Admin — Resolve Market</h3>

      <div className="mt-2 rounded-sm bg-secondary/50 p-3">
        <p className="text-xs text-muted-foreground">Resolution criteria:</p>
        <p className="mt-1 text-sm">{resolutionCriteria}</p>
      </div>

      {confirmAction === null ? (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              className="rounded-sm border border-green-800/40 bg-green-950/20 text-green-400 hover:bg-green-950/40"
              onClick={() => setConfirmAction('yes')}
              disabled={loading}
            >
              Resolve YES
            </Button>
            <Button
              variant="secondary"
              className="rounded-sm border border-red-800/40 bg-red-950/20 text-red-400 hover:bg-red-950/40"
              onClick={() => setConfirmAction('no')}
              disabled={loading}
            >
              Resolve NO
            </Button>
          </div>
          <Button
            variant="secondary"
            className="w-full rounded-sm text-muted-foreground"
            onClick={() => setConfirmAction('cancel')}
            disabled={loading}
          >
            Cancel Market (Refund All)
          </Button>
        </div>
      ) : (
        <div className="mt-3 rounded-sm border border-yellow-800/40 bg-yellow-950/20 p-3">
          <p className="text-sm font-medium text-yellow-400">
            {confirmAction === 'cancel'
              ? 'Cancel this market and refund all bettors?'
              : `Resolve as ${confirmAction.toUpperCase()}?`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            This action cannot be undone.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              variant="secondary"
              className="flex-1 rounded-sm"
              onClick={() => setConfirmAction(null)}
              disabled={loading}
            >
              Back
            </Button>
            <Button
              className="flex-1 rounded-sm"
              onClick={() => {
                if (confirmAction === 'cancel') handleCancel();
                else handleResolve(confirmAction);
              }}
              disabled={loading}
            >
              {loading ? 'Processing...' : 'Confirm'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
