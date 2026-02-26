'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { resolveMarket, resolveMarketMc, cancelMarket } from '@/lib/markets/admin-actions';
import { getOutcomeColor } from '@/lib/markets/outcome-colors';
import { toast } from 'sonner';

type MarketOutcome = {
  id: string;
  label: string;
  sortOrder: number;
};

type Props = {
  marketId: string;
  resolutionCriteria: string;
  status: string;
  marketType?: 'binary' | 'multiple_choice';
  outcomes?: MarketOutcome[];
};

type Step = 'select' | 'confirm' | 'final';

export function AdminResolutionPanel({ marketId, resolutionCriteria, status, marketType = 'binary', outcomes }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();
  const [action, setAction] = useState<'yes' | 'no' | 'cancel' | null>(null);
  const [selectedOutcome, setSelectedOutcome] = useState<MarketOutcome | null>(null);
  const [step, setStep] = useState<Step>('select');
  const [typedConfirmation, setTypedConfirmation] = useState('');

  const canResolve = status === 'open' || status === 'closed';
  if (!canResolve) return null;

  const isMultiChoice = marketType === 'multiple_choice';

  function getConfirmPhrase(): string {
    if (action === 'cancel') return 'CANCEL';
    if (isMultiChoice && selectedOutcome) return `RESOLVE ${selectedOutcome.label.toUpperCase()}`;
    if (action === 'yes') return 'RESOLVE YES';
    if (action === 'no') return 'RESOLVE NO';
    return '';
  }

  function reset() {
    setAction(null);
    setSelectedOutcome(null);
    setStep('select');
    setTypedConfirmation('');
  }

  async function handleResolve(outcome: 'yes' | 'no') {
    setLoading(true);
    const result = await resolveMarket({ marketId, outcome });
    setLoading(false);
    reset();

    if (result.success) {
      toast.success(`Resolved ${outcome.toUpperCase()} — ${result.data.winnersPaid} tokens paid out`);
      startTransition(() => { router.refresh(); });
    } else {
      toast.error(result.error);
    }
  }

  async function handleResolveMc() {
    if (!selectedOutcome) return;
    setLoading(true);
    const result = await resolveMarketMc({ marketId, outcomeId: selectedOutcome.id });
    setLoading(false);
    reset();

    if (result.success) {
      toast.success(`Resolved ${selectedOutcome.label.toUpperCase()} — ${result.data.winnersPaid} tokens paid out`);
      startTransition(() => { router.refresh(); });
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
      startTransition(() => { router.refresh(); });
    } else {
      toast.error(result.error);
    }
  }

  function handleExecute() {
    if (action === 'cancel') handleCancel();
    else if (isMultiChoice && selectedOutcome) handleResolveMc();
    else if (action) handleResolve(action as 'yes' | 'no');
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
          {isMultiChoice && outcomes ? (
            <>
              <p className="text-xs text-muted-foreground">Select winning outcome:</p>
              <div className="flex flex-wrap gap-2">
                {outcomes
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map((o) => {
                    const color = getOutcomeColor(o.sortOrder);
                    return (
                      <Button
                        key={o.id}
                        variant="secondary"
                        className={`rounded-sm border ${color.border} ${color.bg} ${color.text} ${color.bgHover}`}
                        onClick={() => {
                          setSelectedOutcome(o);
                          setAction(null);
                          setStep('confirm');
                        }}
                        disabled={loading}
                      >
                        {o.label}
                      </Button>
                    );
                  })}
              </div>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                className="rounded-sm border border-green-800/40 bg-green-950/20 text-green-400 hover:bg-green-950/40"
                onClick={() => { setAction('yes'); setStep('confirm'); }}
                disabled={loading}
              >
                Resolve YES
              </Button>
              <Button
                variant="secondary"
                className="rounded-sm border border-red-800/40 bg-red-950/20 text-red-400 hover:bg-red-950/40"
                onClick={() => { setAction('no'); setStep('confirm'); }}
                disabled={loading}
              >
                Resolve NO
              </Button>
            </div>
          )}
          <Button
            variant="secondary"
            className="w-full rounded-sm text-muted-foreground"
            onClick={() => { setAction('cancel'); setStep('confirm'); }}
            disabled={loading}
          >
            Cancel Market (Refund All)
          </Button>
        </div>
      )}

      {/* Step 2: First confirmation */}
      {step === 'confirm' && (
        <div className="mt-3 rounded-sm border border-yellow-800/40 bg-yellow-950/20 p-3">
          <p className="text-sm font-medium text-yellow-400">
            {action === 'cancel'
              ? 'Cancel this market and refund all bettors?'
              : isMultiChoice && selectedOutcome
                ? `Resolve as ${selectedOutcome.label.toUpperCase()}?`
                : `Resolve as ${action?.toUpperCase()}?`}
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
      {step === 'final' && (
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
