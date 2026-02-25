import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { CreateMarketButton } from '@/components/markets/CreateMarketButton';

function probability(yesPool: number, noPool: number): number {
  const total = yesPool + noPool;
  if (total === 0) return 50;
  return Math.round((noPool / total) * 100);
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
            const pool = Array.isArray(market.market_pools)
              ? market.market_pools[0]
              : market.market_pools;
            const yesProb = pool
              ? probability(Number(pool.yes_pool), Number(pool.no_pool))
              : 50;
            const closesAt = new Date(market.closes_at);
            const isClosed = closesAt <= new Date() || market.status === 'closed';
            const volume = Math.round(volumeByMarket[market.id] ?? 0);

            return (
              <Link
                key={market.id}
                href={`/markets/${market.id}`}
                className="block rounded-sm border border-border bg-card p-4 transition-colors hover:border-foreground/20"
              >
                <p className="text-sm font-medium leading-snug">
                  {market.question}
                </p>
                <div className="mt-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold text-green-400">
                      {yesProb}%
                    </span>
                    <span className="text-xs text-muted-foreground">YES</span>
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
