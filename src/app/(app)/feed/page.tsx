import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { CreateMarketButton } from '@/components/markets/CreateMarketButton';
import { getOutcomeColor } from '@/lib/markets/outcome-colors';

function probability(yesPool: number, noPool: number): number {
  const total = yesPool + noPool;
  if (total === 0) return 50;
  return Math.round((noPool / total) * 100);
}

function mcLeadingOutcome(
  outcomes: { id: string; label: string; sort_order: number }[],
  pools: { outcome_id: string; pool: number }[]
): { label: string; probability: number; sortOrder: number } | null {
  if (!outcomes.length || !pools.length) return null;
  const recipSum = pools.reduce((sum, p) => sum + (1 / Number(p.pool)), 0);
  let best: { label: string; probability: number; sortOrder: number } | null = null;
  for (const o of outcomes) {
    const pool = pools.find(p => p.outcome_id === o.id);
    if (!pool) continue;
    const prob = Math.round(((1 / Number(pool.pool)) / recipSum) * 100);
    if (!best || prob > best.probability) {
      best = { label: o.label, probability: prob, sortOrder: o.sort_order };
    }
  }
  return best;
}

export default async function FeedPage() {
  const supabase = await createClient();

  const [{ data: markets }, { data: volumeData }] = await Promise.all([
    supabase
      .from('markets')
      .select(`
        id,
        question,
        status,
        closes_at,
        created_at,
        market_type,
        market_pools ( yes_pool, no_pool )
      `)
      .in('status', ['open', 'closed'])
      .order('created_at', { ascending: false }),
    supabase
      .from('positions')
      .select('market_id, cost')
      .is('cancelled_at', null),
  ]);

  // Aggregate volume per market
  const volumeByMarket: Record<string, number> = {};
  for (const p of volumeData ?? []) {
    volumeByMarket[p.market_id] = (volumeByMarket[p.market_id] ?? 0) + Number(p.cost);
  }

  // Fetch multi-choice data for MC markets
  const mcMarketIds = (markets ?? [])
    .filter(m => m.market_type === 'multiple_choice')
    .map(m => m.id);

  let mcOutcomes: Record<string, { id: string; label: string; sort_order: number }[]> = {};
  let mcPools: Record<string, { outcome_id: string; pool: number }[]> = {};

  if (mcMarketIds.length > 0) {
    const [outcomesRes, poolsRes] = await Promise.all([
      supabase
        .from('market_outcomes')
        .select('id, market_id, label, sort_order')
        .in('market_id', mcMarketIds),
      supabase
        .from('outcome_pools')
        .select('market_id, outcome_id, pool')
        .in('market_id', mcMarketIds),
    ]);

    for (const o of outcomesRes.data ?? []) {
      (mcOutcomes[o.market_id] ??= []).push(o);
    }
    for (const p of poolsRes.data ?? []) {
      (mcPools[p.market_id] ??= []).push(p);
    }
  }

  return (
    <div className="px-4 py-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Markets</h2>
        <CreateMarketButton />
      </div>

      {!markets || markets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm text-muted-foreground">
            No markets yet. Create one to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {markets.map((market) => {
            const isMc = market.market_type === 'multiple_choice';
            const pool = Array.isArray(market.market_pools)
              ? market.market_pools[0]
              : market.market_pools;
            const closesAt = new Date(market.closes_at);
            const isClosed = closesAt <= new Date() || market.status === 'closed';
            const volume = Math.round(volumeByMarket[market.id] ?? 0);

            // Leading outcome for display
            let displayLabel = 'YES';
            let displayProb = pool ? probability(Number(pool.yes_pool), Number(pool.no_pool)) : 50;
            let displayColor = 'text-green-400';

            if (isMc) {
              const leading = mcLeadingOutcome(
                mcOutcomes[market.id] ?? [],
                mcPools[market.id] ?? []
              );
              if (leading) {
                displayLabel = leading.label;
                displayProb = leading.probability;
                const color = getOutcomeColor(leading.sortOrder);
                displayColor = color.text;
              }
            }

            return (
              <Link
                key={market.id}
                href={`/markets/${market.id}`}
                className="block rounded-sm border border-border bg-card p-4 transition-colors hover:border-foreground/20"
              >
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium leading-snug flex-1">
                    {market.question}
                  </p>
                  {isMc && (
                    <span className="shrink-0 rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      MC
                    </span>
                  )}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`text-lg font-bold ${displayColor}`}>
                      {displayProb}%
                    </span>
                    <span className="text-xs text-muted-foreground">{displayLabel}</span>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    {volume > 0 && (
                      <div>{volume.toLocaleString()} tokens traded</div>
                    )}
                    <div>
                      {isClosed ? (
                        <span className="text-yellow-500">Closed</span>
                      ) : (
                        <>Closes {formatDistanceToNow(closesAt, { addSuffix: true })}</>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
