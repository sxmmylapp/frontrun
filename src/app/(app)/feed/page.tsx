import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { CreateMarketButton } from '@/components/markets/CreateMarketButton';

function probability(yesPool: number, noPool: number): number {
  const total = yesPool + noPool;
  if (total === 0) return 50;
  return Math.round((noPool / total) * 100);
}

function mcTopProbability(options: { label: string; pool: number }[]): { label: string; prob: number } {
  if (options.length === 0) return { label: '', prob: 0 };
  const inverses = options.map((o) => ({ label: o.label, inv: 1 / o.pool }));
  const sumInv = inverses.reduce((s, o) => s + o.inv, 0);
  let best = inverses[0];
  for (const o of inverses) {
    if (o.inv > best.inv) best = o;
  }
  return { label: best.label, prob: Math.round((best.inv / sumInv) * 100) };
}

export default async function FeedPage() {
  const supabase = await createClient();

  // Try the full query with MC fields first; fall back to binary-only if
  // the migration hasn't been applied yet (market_type / market_options
  // columns won't exist).
  let markets: {
    id: string;
    question: string;
    status: string;
    closes_at: string;
    created_at: string | null;
    market_type?: string;
    market_pools: { yes_pool: number; no_pool: number } | { yes_pool: number; no_pool: number }[] | null;
    market_options?: { label: string; pool: number; sort_order: number }[] | null;
  }[] | null = null;

  const { data: fullData, error: fullError } = await supabase
    .from('markets')
    .select(`
      id,
      question,
      status,
      closes_at,
      created_at,
      market_type,
      market_pools ( yes_pool, no_pool ),
      market_options ( label, pool, sort_order )
    `)
    .in('status', ['open', 'closed'])
    .order('created_at', { ascending: false });

  if (!fullError && fullData) {
    markets = fullData;
  } else {
    // Fallback: migration not applied yet, query without MC fields
    const { data: fallbackData } = await supabase
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
      .order('created_at', { ascending: false });

    markets = fallbackData;
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
            const closesAt = new Date(market.closes_at);
            const isClosed = closesAt <= new Date() || market.status === 'closed';
            const isMC = market.market_type === 'multiple_choice';

            if (isMC) {
              const options = Array.isArray(market.market_options)
                ? market.market_options.map((o) => ({ label: o.label, pool: Number(o.pool) }))
                : [];
              const top = mcTopProbability(options);

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
                      <span className="text-lg font-bold text-blue-400">
                        {top.prob}%
                      </span>
                      <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                        {top.label}
                      </span>
                      <span className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {options.length} options
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {isClosed ? (
                        <span className="text-yellow-500">Closed</span>
                      ) : (
                        <>Closes {formatDistanceToNow(closesAt, { addSuffix: true })}</>
                      )}
                    </div>
                  </div>
                </Link>
              );
            }

            // Binary market card
            const pool = Array.isArray(market.market_pools)
              ? market.market_pools[0]
              : market.market_pools;
            const yesProb = pool
              ? probability(Number(pool.yes_pool), Number(pool.no_pool))
              : 50;

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
                  <div className="text-xs text-muted-foreground">
                    {isClosed ? (
                      <span className="text-yellow-500">Closed</span>
                    ) : (
                      <>Closes {formatDistanceToNow(closesAt, { addSuffix: true })}</>
                    )}
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
