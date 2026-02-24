import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { ProfileClient } from '@/components/profile/ProfileClient';
import { APP_VERSION } from '@/lib/version';

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Parallel fetch: profile + positions at the same time
  const [profileResult, positionsResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('display_name, is_admin')
      .eq('id', user.id)
      .single(),
    supabase
      .from('positions')
      .select(`
        id,
        outcome,
        shares,
        cost,
        created_at,
        cancelled_at,
        markets ( id, question, status, resolved_outcome, market_pools ( yes_pool, no_pool ) )
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
  ]);

  const profile = profileResult.data;
  const positions = (positionsResult.data ?? []).map((p) => {
    const market = Array.isArray(p.markets) ? p.markets[0] : p.markets;
    const poolData = market?.market_pools;
    const pool = Array.isArray(poolData) ? poolData[0] : poolData;
    return {
      id: p.id,
      outcome: p.outcome,
      shares: p.shares,
      cost: p.cost,
      cancelled_at: p.cancelled_at,
      market: market ? { id: market.id, question: market.question, status: market.status, resolved_outcome: market.resolved_outcome } : null,
      pool: pool ? { yes_pool: Number(pool.yes_pool), no_pool: Number(pool.no_pool) } : null,
    };
  });

  return (
    <ProfileClient
      displayName={profile?.display_name ?? ''}
      isAdmin={profile?.is_admin === true}
      positions={positions}
      appVersion={APP_VERSION}
    />
  );
}
