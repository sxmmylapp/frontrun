'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createMarket } from '@/lib/markets/actions';
import { toast } from 'sonner';

export function CreateMarketDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [question, setQuestion] = useState('');
  const [criteria, setCriteria] = useState('');
  const [closesAt, setClosesAt] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!question || !criteria || !closesAt) return;

    setLoading(true);
    const result = await createMarket({
      question,
      resolutionCriteria: criteria,
      closesAt: new Date(closesAt).toISOString(),
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
      <div className="w-full max-w-md rounded-sm border border-border bg-card p-6">
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
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Question
            </label>
            <Input
              placeholder="Will it rain this Friday?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="rounded-sm"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Resolution Criteria
            </label>
            <textarea
              placeholder="Resolves YES if any weather service records rainfall in downtown on Friday..."
              value={criteria}
              onChange={(e) => setCriteria(e.target.value)}
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
              disabled={loading || !question || !criteria || !closesAt}
            >
              {loading ? 'Creating...' : 'Create Market'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
