'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createMarket } from '@/lib/markets/actions';
import { generateResolutionCriteria } from '@/lib/ai/actions';
import { toast } from 'sonner';

export function CreateMarketDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [question, setQuestion] = useState('');
  const [criteria, setCriteria] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [criteriaEdited, setCriteriaEdited] = useState(false);
  const [marketType, setMarketType] = useState<'binary' | 'multiple_choice'>('binary');
  const [outcomes, setOutcomes] = useState<string[]>(['', '']);

  const handleGenerateCriteria = useCallback(
    async (q: string) => {
      if (!q || q.trim().length < 5 || criteriaEdited) return;

      setGenerating(true);
      const outcomeLabels = marketType === 'multiple_choice'
        ? outcomes.filter(o => o.trim().length > 0)
        : undefined;
      const result = await generateResolutionCriteria(q, marketType, outcomeLabels);
      setGenerating(false);

      if (result.success) {
        setCriteria(result.criteria);
      }
    },
    [criteriaEdited, marketType, outcomes]
  );

  function addOutcome() {
    if (outcomes.length < 10) {
      setOutcomes([...outcomes, '']);
    }
  }

  function removeOutcome(index: number) {
    if (outcomes.length > 2) {
      setOutcomes(outcomes.filter((_, i) => i !== index));
    }
  }

  function updateOutcome(index: number, value: string) {
    const updated = [...outcomes];
    updated[index] = value;
    setOutcomes(updated);
  }

  const validOutcomes = outcomes.filter(o => o.trim().length > 0);
  const isMultiValid = marketType === 'binary' || validOutcomes.length >= 2;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!question || !criteria || !closesAt || !isMultiValid) return;

    setLoading(true);
    const result = await createMarket({
      question,
      resolutionCriteria: criteria,
      closesAt: new Date(closesAt).toISOString(),
      marketType,
      outcomes: marketType === 'multiple_choice' ? validOutcomes : undefined,
    });
    setLoading(false);

    if (result.success) {
      toast.success('Market created');
      onClose();
      router.push(`/markets/${result.data.marketId}`);
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-sm border border-border bg-card p-6 max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold">New Market</h3>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Market type toggle */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Market Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMarketType('binary')}
                className={`rounded-sm border px-3 py-2 text-sm font-medium transition-all ${
                  marketType === 'binary'
                    ? 'border-foreground/40 bg-secondary text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                Yes / No
              </button>
              <button
                type="button"
                onClick={() => setMarketType('multiple_choice')}
                className={`rounded-sm border px-3 py-2 text-sm font-medium transition-all ${
                  marketType === 'multiple_choice'
                    ? 'border-foreground/40 bg-secondary text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                Multiple Choice
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Question
            </label>
            <Input
              placeholder={marketType === 'binary' ? 'Will it rain this Friday?' : 'Who will win the election?'}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onBlur={() => handleGenerateCriteria(question)}
              className="rounded-sm"
              autoFocus
            />
          </div>

          {/* Multiple choice outcomes */}
          {marketType === 'multiple_choice' && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Outcomes ({validOutcomes.length}/10)
              </label>
              <div className="space-y-2">
                {outcomes.map((outcome, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      placeholder={`Outcome ${i + 1}`}
                      value={outcome}
                      onChange={(e) => updateOutcome(i, e.target.value)}
                      className="rounded-sm"
                    />
                    {outcomes.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeOutcome(i)}
                        className="shrink-0 text-muted-foreground hover:text-red-400"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {outcomes.length < 10 && (
                <button
                  type="button"
                  onClick={addOutcome}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  + Add outcome
                </button>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-muted-foreground">
                Resolution Criteria
              </label>
              {generating && (
                <span className="text-xs text-muted-foreground animate-pulse">
                  Generating...
                </span>
              )}
            </div>
            <textarea
              placeholder={
                marketType === 'binary'
                  ? 'Resolves YES if any weather service records rainfall in downtown on Friday...'
                  : 'The outcome that matches the official result wins...'
              }
              value={criteria}
              onChange={(e) => {
                setCriteria(e.target.value);
                setCriteriaEdited(true);
              }}
              className="flex min-h-[80px] w-full rounded-sm border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Closes at
            </label>
            <Input
              type="datetime-local"
              value={closesAt}
              onChange={(e) => setClosesAt(e.target.value)}
              className="rounded-sm"
              min={new Date().toISOString().slice(0, 16)}
              max={(() => {
                const d = new Date();
                d.setMonth(d.getMonth() + 3);
                return d.toISOString().slice(0, 16);
              })()}
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              className="flex-1 rounded-sm"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="flex-1 rounded-sm"
              disabled={loading || !question || !criteria || !closesAt || !isMultiValid}
            >
              {loading ? 'Creating...' : 'Create Market'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
