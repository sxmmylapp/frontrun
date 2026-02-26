import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { MarketDetail } from '@/components/markets/MarketDetail';

export default async function MarketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // Parallel fetch: market data + user auth at the same time
  const [marketResult, userResult] = await Promise.all([
    supabase
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
        market_pools ( yes_pool, no_pool )
      `)
      .eq('id', id)
      .single(),
    supabase.auth.getUser(),
  ]);

  const market = marketResult.data;
  if (!market) return notFound();

  const user = userResult.data.user;
  const isMultiChoice = market.market_type === 'multiple_choice';

  // Parallel fetch: positions + activity + multi-choice data
  const [allPositionsResult, activityResult, outcomesResult, poolsResult] = await Promise.all([
    supabase
      .from('positions')
      .select('outcome, outcome_id, shares, cost, created_at, cancelled_at')
      .eq('market_id', id)
      .is('cancelled_at', null)
      .order('created_at', { ascending: true }),
    supabase
      .from('positions')
      .select('id, outcome, outcome_id, shares, cost, created_at, cancelled_at, profiles!positions_user_id_fkey ( display_name )')
      .eq('market_id', id)
      .order('created_at', { ascending: false }),
    isMultiChoice
      ? supabase.from('market_outcomes').select('id, label, sort_order').eq('market_id', id).order('sort_order', { ascending: true })
      : Promise.resolve({ data: null }),
    isMultiChoice
      ? supabase.from('outcome_pools').select('outcome_id, pool').eq('market_id', id)
      : Promise.resolve({ data: null }),
  ]);

  const allPositions = allPositionsResult.data ?? [];
  const positionHistory = allPositions.map((p) => ({
    outcome: p.outcome as 'yes' | 'no',
    shares: Number(p.shares),
    cost: Number(p.cost),
    createdAt: p.created_at!,
  }));
  const volume = allPositions.reduce((sum, p) => sum + Number(p.cost), 0);

  // Aggregate total outstanding shares per outcome for realistic payout estimates
  // Binary: keyed by 'yes'/'no'. Multi-choice: keyed by outcome_id (UUID).
  const totalSharesByOutcome: Record<string, number> = {};
  for (const p of allPositions) {
    const key = (isMultiChoice && p.outcome_id) ? p.outcome_id : p.outcome;
    totalSharesByOutcome[key] = (totalSharesByOutcome[key] ?? 0) + Number(p.shares);
  }

  const activityFeed = (activityResult.data ?? []).map((p) => {
    const profile = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles;
    return {
      id: p.id,
      outcome: p.outcome,
      outcome_id: p.outcome_id,
      shares: Number(p.shares),
      cost: Number(p.cost),
      createdAt: p.created_at!,
      cancelledAt: p.cancelled_at,
      displayName: profile?.display_name ?? 'Anonymous',
    };
  });

  // Multi-choice data
  let marketOutcomes: { id: string; label: string; sortOrder: number }[] | undefined;
  let outcomePools: { outcomeId: string; pool: number }[] | undefined;

  if (isMultiChoice && outcomesResult.data && poolsResult.data) {
    marketOutcomes = (outcomesResult.data as { id: string; label: string; sort_order: number }[]).map(o => ({
      id: o.id,
      label: o.label,
      sortOrder: o.sort_order,
    }));

    outcomePools = (poolsResult.data as { outcome_id: string; pool: number }[]).map(p => ({
      outcomeId: p.outcome_id,
      pool: Number(p.pool),
    }));
  }

  let isAdmin = false;
  let userPositions: {
    id: string;
    outcome: string;
    outcome_id: string | null;
    shares: number;
    cost: number;
    cancelled_at: string | null;
  }[] = [];

  if (user) {
    const [profileResult, positionsResult] = await Promise.all([
      supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single(),
      supabase
        .from('positions')
        .select('id, outcome, outcome_id, shares, cost, cancelled_at')
        .eq('user_id', user.id)
        .eq('market_id', id)
        .is('cancelled_at', null)
        .order('created_at', { ascending: false }),
    ]);

    isAdmin = profileResult.data?.is_admin === true;
    if (positionsResult.data) {
      userPositions = positionsResult.data;
    }
  }

  const pool = Array.isArray(market.market_pools)
    ? market.market_pools[0]
    : market.market_pools;

  return (
    <MarketDetail
      market={{
        id: market.id,
        question: market.question,
        resolutionCriteria: market.resolution_criteria,
        status: market.status,
        resolvedOutcome: market.resolved_outcome,
        closesAt: market.closes_at,
        resolvedAt: market.resolved_at,
        createdAt: market.created_at ?? new Date().toISOString(),
        creatorId: market.creator_id,
        marketType: (market.market_type ?? 'binary') as 'binary' | 'multiple_choice',
      }}
      initialPool={{
        yesPool: Number(pool?.yes_pool ?? 500),
        noPool: Number(pool?.no_pool ?? 500),
      }}
      isAdmin={isAdmin}
      currentUserId={user?.id ?? null}
      userPositions={userPositions}
      positionHistory={positionHistory}
      volume={volume}
      activityFeed={activityFeed}
      outcomes={marketOutcomes}
      initialOutcomePools={outcomePools}
      totalSharesByOutcome={totalSharesByOutcome}
    />
  );
}
