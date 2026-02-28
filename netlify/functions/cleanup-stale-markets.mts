/**
 * cleanup-stale-markets.mts — Netlify Scheduled Function
 *
 * Runs every hour. Deletes open markets that are 3+ days old with zero trades.
 * Since no positions exist, no refunds are needed — just remove market + pool rows.
 */

import type { Config } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

function getAdmin() {
  const url = Netlify.env.get('NEXT_PUBLIC_SUPABASE_URL');
  const key = Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export default async (req: Request) => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] cleanup-stale-markets: starting`);

  const admin = getAdmin();

  // Find open markets created 3+ days ago
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 3);

  const { data: staleMarkets, error: fetchError } = await admin
    .from('markets')
    .select('id, question, market_type, created_at')
    .eq('status', 'open')
    .lte('created_at', cutoff.toISOString());

  if (fetchError) {
    console.error(`[${ts}] cleanup-stale-markets ERROR: failed to fetch markets - ${fetchError.message}`);
    return;
  }

  if (!staleMarkets || staleMarkets.length === 0) {
    console.log(`[${ts}] cleanup-stale-markets: no stale candidates found`);
    return;
  }

  let deleted = 0;

  for (const market of staleMarkets) {
    // Check if any positions exist (including cancelled ones — if anyone ever traded, keep it)
    const { count, error: countError } = await admin
      .from('positions')
      .select('id', { count: 'exact', head: true })
      .eq('market_id', market.id);

    if (countError) {
      console.error(`[${ts}] cleanup-stale-markets ERROR: count positions for ${market.id} - ${countError.message}`);
      continue;
    }

    if ((count ?? 0) > 0) {
      continue; // Has trade history, skip
    }

    // No trades ever — safe to delete. Remove pool rows first (FK constraint).
    if (market.market_type === 'multiple_choice') {
      await admin.from('outcome_pools').delete().eq('market_id', market.id);
      await admin.from('market_outcomes').delete().eq('market_id', market.id);
    } else {
      await admin.from('market_pools').delete().eq('market_id', market.id);
    }

    const { error: deleteError } = await admin
      .from('markets')
      .delete()
      .eq('id', market.id);

    if (deleteError) {
      console.error(`[${ts}] cleanup-stale-markets ERROR: delete market ${market.id} - ${deleteError.message}`);
      continue;
    }

    deleted++;
    console.log(`[${ts}] cleanup-stale-markets: deleted "${market.question}" (${market.id}), created ${market.created_at}`);
  }

  console.log(`[${ts}] cleanup-stale-markets: done — deleted ${deleted} of ${staleMarkets.length} candidates`);
};

export const config: Config = {
  schedule: '@hourly',
};
