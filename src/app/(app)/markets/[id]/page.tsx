import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { MarketDetail } from '@/components/markets/MarketDetail';
import { MCMarketDetail } from '@/components/markets/MCMarketDetail';

export default async function MarketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: market } = await supabase
    .from('markets')
    .select(`
      id,
      question,
      resolution_criteria,
      status,
      resolved_outcome,
      closes_at,
      resolved_at,
      created_at,
      creator_id,
      market_type,
      market_pools ( yes_pool, no_pool ),
      market_options ( id, label, pool, sort_order )
    `)
    .eq('id', id)
    .single();

  if (!market) return notFound();

  // Check if current user is admin
  const { data: { user } } = await supabase.auth.getUser();
  let isAdmin = false;
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();
    isAdmin = profile?.is_admin === true;
  }

  // Fetch user's active positions on this market
  let userPositions: {
    id: string;
    outcome: string;
    shares: number;
    cost: number;
    cancelled_at: string | null;
    market_option_id: string | null;
  }[] = [];
  if (user) {
    const { data: positions } = await supabase
      .from('positions')
      .select('id, outcome, shares, cost, cancelled_at, market_option_id')
      .eq('user_id', user.id)
      .eq('market_id', id)
      .is('cancelled_at', null)
      .order('created_at', { ascending: false });
    if (positions) {
      userPositions = positions;
    }
  }

  const marketProps = {
    id: market.id,
    question: market.question,
    resolutionCriteria: market.resolution_criteria,
    status: market.status,
    resolvedOutcome: market.resolved_outcome,
    closesAt: market.closes_at,
    resolvedAt: market.resolved_at,
    createdAt: market.created_at ?? new Date().toISOString(),
    creatorId: market.creator_id,
  };

  // Render MC or binary market detail
  if (market.market_type === 'multiple_choice') {
    const options = Array.isArray(market.market_options)
      ? market.market_options.map((o) => ({
          id: o.id,
          label: o.label,
          pool: Number(o.pool),
          sort_order: o.sort_order,
        }))
      : [];

    return (
      <MCMarketDetail
        market={marketProps}
        initialOptions={options}
        isAdmin={isAdmin}
        currentUserId={user?.id ?? null}
        userPositions={userPositions}
      />
    );
  }

  // Binary market
  const pool = Array.isArray(market.market_pools)
    ? market.market_pools[0]
    : market.market_pools;

  return (
    <MarketDetail
      market={marketProps}
      initialPool={{
        yesPool: Number(pool?.yes_pool ?? 500),
        noPool: Number(pool?.no_pool ?? 500),
      }}
      isAdmin={isAdmin}
      currentUserId={user?.id ?? null}
      userPositions={userPositions}
    />
  );
}
