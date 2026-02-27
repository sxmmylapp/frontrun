/**
 * seed-bots.ts — One-time script to create 10 trading bot accounts.
 *
 * Run: npx tsx scripts/seed-bots.ts
 *
 * Requires env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * (reads from .env.local automatically via tsx)
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type Strategy = 'market_maker' | 'threshold' | 'mean_reversion';

interface BotConfig {
  name: string;
  strategy: Strategy;
  seedTokens: number; // Additional tokens on top of 1000 signup bonus
  phone: string;
}

const BOTS: BotConfig[] = [
  { name: 'TradeBot Alpha',   strategy: 'market_maker',    seedTokens: 9000,  phone: '+10000000001' },
  { name: 'TradeBot Beta',    strategy: 'market_maker',    seedTokens: 9000,  phone: '+10000000002' },
  { name: 'TradeBot Gamma',   strategy: 'market_maker',    seedTokens: 7000,  phone: '+10000000003' },
  { name: 'TradeBot Delta',   strategy: 'market_maker',    seedTokens: 7000,  phone: '+10000000004' },
  { name: 'TradeBot Epsilon', strategy: 'threshold',       seedTokens: 7000,  phone: '+10000000005' },
  { name: 'TradeBot Zeta',    strategy: 'threshold',       seedTokens: 7000,  phone: '+10000000006' },
  { name: 'TradeBot Eta',     strategy: 'threshold',       seedTokens: 5000,  phone: '+10000000007' },
  { name: 'TradeBot Theta',   strategy: 'threshold',       seedTokens: 5000,  phone: '+10000000008' },
  { name: 'TradeBot Iota',    strategy: 'mean_reversion',  seedTokens: 9000,  phone: '+10000000009' },
  { name: 'TradeBot Kappa',   strategy: 'mean_reversion',  seedTokens: 9000,  phone: '+10000000010' },
];

async function seedBot(bot: BotConfig) {
  console.log(`Creating ${bot.name}...`);

  // 1. Create auth user (phone_confirm: true skips OTP)
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    phone: bot.phone,
    phone_confirm: true,
    user_metadata: { strategy: bot.strategy },
  });

  if (authError) {
    // If already exists, find by profile and update + seed
    if (authError.message.includes('already') || authError.message.includes('registered')) {
      console.log(`  ${bot.name} already exists, updating...`);

      // Find by profile display_name (set on first run)
      const { data: profile } = await admin
        .from('profiles')
        .select('id')
        .eq('display_name', bot.name)
        .eq('is_bot', true)
        .single();

      if (!profile) {
        console.error(`  Could not find profile for ${bot.name}`);
        return;
      }

      const existingId = profile.id;

      // Update metadata
      await admin.auth.admin.updateUserById(existingId, {
        user_metadata: { strategy: bot.strategy },
      });

      // Check if already seeded
      const { data: seedEntries } = await admin
        .from('token_ledger')
        .select('id')
        .eq('user_id', existingId)
        .eq('reason', 'bot_seed')
        .limit(1);

      if (!seedEntries?.length) {
        const { error: ledgerError } = await admin.from('token_ledger').insert({
          user_id: existingId,
          amount: bot.seedTokens,
          reason: 'bot_seed',
        });
        if (ledgerError) {
          console.error(`  Ledger error for ${bot.name}: ${ledgerError.message}`);
        } else {
          console.log(`  Seeded ${bot.seedTokens} tokens for ${bot.name}`);
        }
      } else {
        console.log(`  ${bot.name} already seeded`);
      }
      console.log(`  Updated ${bot.name} (${existingId})`);
      return;
    }
    console.error(`  Auth error for ${bot.name}: ${authError.message}`);
    return;
  }

  const userId = authData.user.id;
  console.log(`  Created auth user: ${userId}`);

  // 2. handle_new_user trigger auto-creates profile + 1000 signup bonus
  //    Wait briefly for trigger to fire
  await new Promise(r => setTimeout(r, 500));

  // 3. Update profile: set is_bot and display_name
  const { error: profileError } = await admin
    .from('profiles')
    .update({ display_name: bot.name, is_bot: true })
    .eq('id', userId);

  if (profileError) {
    console.error(`  Profile update error for ${bot.name}: ${profileError.message}`);
    return;
  }

  // 4. Insert additional seed tokens
  const { error: ledgerError } = await admin.from('token_ledger').insert({
    user_id: userId,
    amount: bot.seedTokens,
    reason: 'bot_seed',
  });

  if (ledgerError) {
    console.error(`  Ledger error for ${bot.name}: ${ledgerError.message}`);
    return;
  }

  console.log(`  ${bot.name} seeded: ${bot.seedTokens} + 1000 bonus = ${bot.seedTokens + 1000} total tokens (strategy: ${bot.strategy})`);
}

async function main() {
  console.log('Seeding 10 trading bots...\n');

  for (const bot of BOTS) {
    await seedBot(bot);
  }

  // Verify
  console.log('\nVerifying bot accounts...');
  const { data: bots } = await admin
    .from('profiles')
    .select('id, display_name, is_bot')
    .eq('is_bot', true);

  if (bots) {
    for (const bot of bots) {
      const { data: balance } = await admin
        .from('user_balances')
        .select('balance')
        .eq('user_id', bot.id)
        .single();
      console.log(`  ${bot.display_name}: ${Number(balance?.balance ?? 0).toLocaleString()} tokens`);
    }
  }

  console.log(`\nDone! ${bots?.length ?? 0} bots created.`);
}

main().catch(console.error);
