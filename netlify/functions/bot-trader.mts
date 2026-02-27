/**
 * bot-trader.mts — Netlify Scheduled Function
 *
 * Runs every 10 minutes. Selects 1-3 random bots, picks open markets,
 * applies strategy logic, and places trades via place_bet RPC.
 *
 * Cannot import from src/lib/ — Netlify functions have separate build context.
 * All logic is inline.
 */

import type { Config } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

// ---------- Supabase client ----------

function getAdmin() {
  const url = Netlify.env.get('NEXT_PUBLIC_SUPABASE_URL');
  const key = Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---------- Types ----------

interface Bot {
  id: string;
  display_name: string;
  strategy: string;
  balance: number;
}

interface Market {
  id: string;
  question: string;
  yes_pool: number;
  no_pool: number;
}

interface TradeDecision {
  action: 'buy_yes' | 'buy_no' | 'skip';
  amount: number;
  skipReason?: string;
}

// ---------- Strategy configs ----------

const STRATEGY_CONFIG: Record<string, {
  tradeProbability: number;
  maxPositionsPerMarket: number;
  maxBetAmount: number;
  maxBalancePct: number;
}> = {
  market_maker: {
    tradeProbability: 0.6,
    maxPositionsPerMarket: 4,
    maxBetAmount: 250,
    maxBalancePct: 0.15,
  },
  threshold: {
    tradeProbability: 0.5,
    maxPositionsPerMarket: 3,
    maxBetAmount: 200,
    maxBalancePct: 0.12,
  },
  mean_reversion: {
    tradeProbability: 0.7,
    maxPositionsPerMarket: 2,
    maxBetAmount: 300,
    maxBalancePct: 0.15,
  },
};

// ---------- Strategy decision functions ----------

function marketMakerDecision(yesProb: number, maxAmount: number): TradeDecision {
  // Buy the underdog when prob drifts >15% from 50%
  const drift = Math.abs(yesProb - 0.5);
  if (drift < 0.15) {
    return { action: 'skip', amount: 0, skipReason: `drift ${(drift * 100).toFixed(1)}% < 15% threshold` };
  }
  // Bet size proportional to drift (more drift = bigger bet)
  const sizeFactor = Math.min(drift / 0.5, 1); // 0-1 scale
  const amount = Math.max(20, Math.round(maxAmount * sizeFactor));
  return {
    action: yesProb > 0.5 ? 'buy_no' : 'buy_yes',
    amount,
  };
}

function thresholdDecision(yesProb: number, maxAmount: number): TradeDecision {
  // Buy the cheap side at extreme odds
  if (yesProb >= 0.30 && yesProb <= 0.70) {
    return { action: 'skip', amount: 0, skipReason: `prob ${(yesProb * 100).toFixed(1)}% within 30-70% range` };
  }
  const amount = Math.max(20, Math.round(maxAmount * 0.6));
  return {
    action: yesProb < 0.30 ? 'buy_yes' : 'buy_no',
    amount,
  };
}

function meanReversionDecision(yesProb: number, maxAmount: number): TradeDecision {
  // Combines market-maker + threshold with lower thresholds
  const drift = Math.abs(yesProb - 0.5);

  // Mean-reversion triggers at lower threshold (10%)
  if (drift < 0.10) {
    return { action: 'skip', amount: 0, skipReason: `drift ${(drift * 100).toFixed(1)}% < 10% threshold` };
  }

  // Larger bets at extreme odds (>35% from center)
  const sizeFactor = Math.min(drift / 0.4, 1);
  const amount = Math.max(20, Math.round(maxAmount * sizeFactor));
  return {
    action: yesProb > 0.5 ? 'buy_no' : 'buy_yes',
    amount,
  };
}

function getDecision(strategy: string, yesProb: number, maxAmount: number): TradeDecision {
  switch (strategy) {
    case 'market_maker': return marketMakerDecision(yesProb, maxAmount);
    case 'threshold': return thresholdDecision(yesProb, maxAmount);
    case 'mean_reversion': return meanReversionDecision(yesProb, maxAmount);
    default: return { action: 'skip', amount: 0, skipReason: `unknown strategy: ${strategy}` };
  }
}

// ---------- Helpers ----------

function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// ---------- Main handler ----------

export default async (req: Request) => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] bot-trader: starting invocation`);

  const admin = getAdmin();

  // 1. Fetch all bot profiles
  const { data: botProfiles, error: botError } = await admin
    .from('profiles')
    .select('id, display_name, is_bot')
    .eq('is_bot', true);

  if (botError || !botProfiles?.length) {
    console.log(`[${ts}] bot-trader: no bots found or error: ${botError?.message}`);
    return;
  }

  // 2. Get strategy from auth user_metadata for each bot
  const bots: Bot[] = [];
  for (const profile of botProfiles) {
    const { data: authUser } = await admin.auth.admin.getUserById(profile.id);
    if (!authUser?.user) continue;

    const { data: balance } = await admin
      .from('user_balances')
      .select('balance')
      .eq('user_id', profile.id)
      .single();

    bots.push({
      id: profile.id,
      display_name: profile.display_name ?? 'Unknown Bot',
      strategy: (authUser.user.user_metadata?.strategy as string) ?? 'market_maker',
      balance: Number(balance?.balance ?? 0),
    });
  }

  if (!bots.length) {
    console.log(`[${ts}] bot-trader: no valid bots with metadata`);
    return;
  }

  // 3. Pick 1-3 bots randomly
  const numBots = Math.floor(Math.random() * 3) + 1;
  const selectedBots = pickRandom(bots, numBots);
  console.log(`[${ts}] bot-trader: selected ${selectedBots.length} bots: ${selectedBots.map(b => b.display_name).join(', ')}`);

  // 4. Fetch open binary markets with pools
  const { data: markets } = await admin
    .from('markets')
    .select('id, question, market_type, closes_at, market_pools(yes_pool, no_pool)')
    .eq('status', 'open')
    .eq('market_type', 'binary')
    .gt('closes_at', new Date().toISOString());

  if (!markets?.length) {
    console.log(`[${ts}] bot-trader: no open binary markets`);
    return;
  }

  const openMarkets: Market[] = markets
    .map(m => {
      const pool = Array.isArray(m.market_pools) ? m.market_pools[0] : m.market_pools;
      if (!pool) return null;
      return {
        id: m.id,
        question: m.question,
        yes_pool: Number(pool.yes_pool),
        no_pool: Number(pool.no_pool),
      };
    })
    .filter((m): m is Market => m !== null);

  if (!openMarkets.length) {
    console.log(`[${ts}] bot-trader: no markets with pools`);
    return;
  }

  // 5. Process each selected bot
  for (const bot of selectedBots) {
    const config = STRATEGY_CONFIG[bot.strategy] ?? STRATEGY_CONFIG.market_maker;

    // Probability gate
    if (Math.random() > config.tradeProbability) {
      console.log(`[${ts}] bot-trader: ${bot.display_name} skipped by probability gate`);
      continue;
    }

    // Pick a random market
    const market = pickRandom(openMarkets, 1)[0];
    const totalPool = market.yes_pool + market.no_pool;
    const yesProb = market.yes_pool > 0 ? market.no_pool / totalPool : 0.5;

    // Check existing positions on this market
    const { count: posCount } = await admin
      .from('positions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', bot.id)
      .eq('market_id', market.id)
      .is('cancelled_at', null);

    if ((posCount ?? 0) >= config.maxPositionsPerMarket) {
      await admin.from('bot_trade_log').insert({
        bot_id: bot.id,
        market_id: market.id,
        strategy: bot.strategy,
        action: 'skip',
        amount: 0,
        yes_prob: yesProb,
        skip_reason: `already at max positions (${posCount}/${config.maxPositionsPerMarket})`,
      });
      console.log(`[${ts}] bot-trader: ${bot.display_name} max positions on "${market.question}"`);
      continue;
    }

    // Cap bet to balance and config limits
    const balanceCap = Math.floor(bot.balance * config.maxBalancePct);
    const poolCap = Math.floor(totalPool * 0.24); // Stay under 25% pool cap
    const maxAmount = Math.min(config.maxBetAmount, balanceCap, poolCap);

    if (maxAmount < 10) {
      await admin.from('bot_trade_log').insert({
        bot_id: bot.id,
        market_id: market.id,
        strategy: bot.strategy,
        action: 'skip',
        amount: 0,
        yes_prob: yesProb,
        skip_reason: `insufficient budget (max=${maxAmount}, balance=${bot.balance})`,
      });
      console.log(`[${ts}] bot-trader: ${bot.display_name} insufficient budget`);
      continue;
    }

    // Run strategy
    const decision = getDecision(bot.strategy, yesProb, maxAmount);

    if (decision.action === 'skip') {
      await admin.from('bot_trade_log').insert({
        bot_id: bot.id,
        market_id: market.id,
        strategy: bot.strategy,
        action: 'skip',
        amount: 0,
        yes_prob: yesProb,
        skip_reason: decision.skipReason,
      });
      console.log(`[${ts}] bot-trader: ${bot.display_name} skipped "${market.question}" — ${decision.skipReason}`);
      continue;
    }

    // Place the bet via RPC
    const outcome = decision.action === 'buy_yes' ? 'yes' : 'no';
    const { data: rpcResult, error: rpcError } = await admin.rpc('place_bet', {
      p_user_id: bot.id,
      p_market_id: market.id,
      p_outcome: outcome,
      p_amount: decision.amount,
    });

    if (rpcError) {
      console.error(`[${ts}] bot-trader: RPC error for ${bot.display_name}: ${rpcError.message}`);
      await admin.from('bot_trade_log').insert({
        bot_id: bot.id,
        market_id: market.id,
        strategy: bot.strategy,
        action: decision.action,
        amount: decision.amount,
        yes_prob: yesProb,
        skip_reason: `RPC error: ${rpcError.message}`,
      });
      continue;
    }

    const result = rpcResult as Record<string, unknown>;
    if (result.error) {
      console.warn(`[${ts}] bot-trader: ${bot.display_name} bet rejected: ${result.error}`);
      await admin.from('bot_trade_log').insert({
        bot_id: bot.id,
        market_id: market.id,
        strategy: bot.strategy,
        action: decision.action,
        amount: decision.amount,
        yes_prob: yesProb,
        skip_reason: `RPC rejected: ${result.error}`,
      });
      continue;
    }

    // Log successful trade
    await admin.from('bot_trade_log').insert({
      bot_id: bot.id,
      market_id: market.id,
      strategy: bot.strategy,
      action: decision.action,
      amount: decision.amount,
      position_id: result.position_id as string,
      yes_prob: yesProb,
    });

    console.log(`[${ts}] bot-trader: ${bot.display_name} ${decision.action} ${decision.amount} tokens on "${market.question}" (prob=${(yesProb * 100).toFixed(1)}%)`);
  }

  console.log(`[${ts}] bot-trader: invocation complete`);
};

export const config: Config = {
  schedule: '*/10 * * * *',
};
