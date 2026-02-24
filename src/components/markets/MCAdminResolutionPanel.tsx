'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { resolveMarketMC, cancelMarket } from '@/lib/markets/admin-actions';
import { toast } from 'sonner';

type MCOption = {
  id: string;
  label: string;
};

type Props = {
  marketId: string;
  resolutionCriteria: string;
  status: string;
  options: MCOption[];
};

type Step = 'select' | 'confirm' | 'final';

export function MCAdminResolutionPanel({ marketId, resolutionCriteria, status, options }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<{ type: 'resolve'; optionId: string; label: string } | { type: 'cancel' } | null>(null);
  const [step, setStep] = useState<Step>('select');
  const [typedConfirmation, setTypedConfirmation] = useState('');

  const canResolve = status === 'open' || status === 'closed';
  if (!canResolve) return null;

  function getConfirmPhrase(): string {
    if (!action) return '';
    if (action.type === 'cancel') return 'CANCEL';
    return `RESOLVE ${action.label.toUpperCase()}`;
  }

  function reset() {
    setAction(null);
    setStep('select');
    setTypedConfirmation('');
  }

  async function handleResolve(optionId: string) {
    setLoading(true);
    const result = await resolveMarketMC({ marketId, winningOptionId: optionId });
    setLoading(false);
    reset();

    if (result.success) {
      toast.success(`Resolved "${result.data.winningLabel}" — ${result.data.winnersPaid} tokens paid out`);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  async function handleCancel() {
    setLoading(true);
    const result = await cancelMarket({ marketId });
    setLoading(false);
    reset();

    if (result.success) {
      toast.success(`Market cancelled — ${result.data.totalRefunded} tokens refunded`);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  function handleExecute() {
    if (!action) return;
    if (action.type === 'cancel') handleCancel();
    else handleResolve(action.optionId);
  }

  return (
    <div className="mt-6 rounded-sm border border-yellow-800/40 bg-yellow-950/10 p-4">
      <h3 className="text-xs font-medium text-yellow-400">Admin — Resolve Market</h3>

      <div className="mt-2 rounded-sm bg-secondary/50 p-3">
        <p className="text-xs text-muted-foreground">Resolution criteria:</p>
        <p className="mt-1 text-sm">{resolutionCriteria}</p>
      </div>

      {/* Step 1: Select action */}
      {step === 'select' && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">Select the winning option:</p>
          <div className="space-y-2">
            {options.map((opt) => (
              <Button
                key={opt.id}
                variant="secondary"
                className="w-full rounded-sm border border-blue-800/40 bg-blue-950/20 text-blue-400 hover:bg-blue-950/40 justify-start"
                onClick={() => {
                  setAction({ type: 'resolve', optionId: opt.id, label: opt.label });
                  setStep('confirm');
                }}
                disabled={loading}
              >
                Resolve: {opt.label}
              </Button>
            ))}
          </div>
          <Button
            variant="secondary"
            className="w-full rounded-sm text-muted-foreground"
            onClick={() => {
              setAction({ type: 'cancel' });
              setStep('confirm');
            }}
            disabled={loading}
          >
            Cancel Market (Refund All)
          </Button>
        </div>
      )}

      {/* Step 2: First confirmation */}
      {step === 'confirm' && action && (
        <div className="mt-3 rounded-sm border border-yellow-800/40 bg-yellow-950/20 p-3">
          <p className="text-sm font-medium text-yellow-400">
            {action.type === 'cancel'
              ? 'Cancel this market and refund all bettors?'
              : `Resolve as "${action.label}"?`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            This action cannot be undone.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              variant="secondary"
              className="flex-1 rounded-sm"
              onClick={reset}
              disabled={loading}
            >
              Back
            </Button>
            <Button
              className="flex-1 rounded-sm"
              onClick={() => { setStep('final'); setTypedConfirmation(''); }}
              disabled={loading}
            >
              Continue
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Final confirmation — type to confirm */}
      {step === 'final' && action && (
        <div className="mt-3 rounded-sm border border-red-800/40 bg-red-950/20 p-3">
          <p className="text-sm font-medium text-red-400">
            Final confirmation
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Type <span className="font-mono font-medium text-foreground">{getConfirmPhrase()}</span> to proceed.
          </p>
          <Input
            className="mt-2 rounded-sm font-mono text-sm"
            placeholder={getConfirmPhrase()}
            value={typedConfirmation}
            onChange={(e) => setTypedConfirmation(e.target.value)}
            disabled={loading}
          />
          <div className="mt-3 flex gap-2">
            <Button
              variant="secondary"
              className="flex-1 rounded-sm"
              onClick={() => { setStep('confirm'); setTypedConfirmation(''); }}
              disabled={loading}
            >
              Back
            </Button>
            <Button
              variant="destructive"
              className="flex-1 rounded-sm"
              onClick={handleExecute}
              disabled={loading || typedConfirmation.trim().toUpperCase() !== getConfirmPhrase()}
            >
              {loading ? 'Processing...' : 'Execute'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
