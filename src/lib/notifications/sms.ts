import { twilioClient, TWILIO_PHONE_NUMBER } from '@/lib/twilio/client';
import { createAdminClient } from '@/lib/supabase/admin';

const MAX_QUESTION_LENGTH = 80;

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

/**
 * Send a single SMS and log it. Never throws.
 */
async function sendSms({
  userId,
  phone,
  eventType,
  marketId,
  message,
}: {
  userId: string;
  phone: string;
  eventType: 'new_market' | 'market_resolved';
  marketId: string;
  message: string;
}): Promise<void> {
  const ts = new Date().toISOString();
  const admin = createAdminClient();

  if (!twilioClient || !TWILIO_PHONE_NUMBER) {
    console.warn(`[${ts}] sendSms WARN: Twilio not configured, skipping SMS to ${userId}`);
    return;
  }

  try {
    const result = await twilioClient.messages.create({
      body: message,
      from: TWILIO_PHONE_NUMBER,
      to: phone,
    });

    await admin.from('sms_log').insert({
      user_id: userId,
      phone,
      event_type: eventType,
      market_id: marketId,
      message,
      twilio_sid: result.sid,
      status: 'sent',
    });

    console.info(`[${ts}] sendSms INFO: sent ${eventType} SMS to ${userId} (sid: ${result.sid})`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[${ts}] sendSms ERROR: failed to send ${eventType} SMS to ${userId} - ${errorMsg}`);

    try {
      await admin.from('sms_log').insert({
        user_id: userId,
        phone,
        event_type: eventType,
        market_id: marketId,
        message,
        status: 'failed',
        error: errorMsg,
      });
    } catch {} // Don't let logging failure propagate
  }
}

/**
 * Notify all opted-in users about a new market.
 */
export async function notifyNewMarket({
  marketId,
  question,
}: {
  marketId: string;
  question: string;
}): Promise<void> {
  const ts = new Date().toISOString();
  const admin = createAdminClient();

  const { data: users, error } = await admin
    .from('profiles')
    .select('id, phone')
    .eq('notify_new_markets', true)
    .eq('is_banned', false);

  if (error || !users) {
    console.error(`[${ts}] notifyNewMarket ERROR: failed to fetch users - ${error?.message}`);
    return;
  }

  const q = truncate(question, MAX_QUESTION_LENGTH);
  const msg = `Frontrun: New market! "${q}" — frontrun.bet/markets/${marketId}`;

  console.info(`[${ts}] notifyNewMarket INFO: sending to ${users.length} users for market ${marketId}`);

  await Promise.allSettled(
    users
      .filter((u) => u.phone)
      .map((u) =>
        sendSms({
          userId: u.id,
          phone: u.phone!,
          eventType: 'new_market',
          marketId,
          message: msg,
        })
      )
  );
}

/**
 * Notify bettors when a market resolves (different message for winners vs losers).
 */
export async function notifyMarketResolved({
  marketId,
  question,
  resolvedOutcome,
  marketType,
  winningOutcomeId,
}: {
  marketId: string;
  question: string;
  resolvedOutcome: string;
  marketType: 'binary' | 'multiple_choice';
  winningOutcomeId?: string;
}): Promise<void> {
  const ts = new Date().toISOString();
  const admin = createAdminClient();

  // Get all active (non-cancelled) positions for this market with user phone + notification pref
  const { data: positions, error } = await admin
    .from('positions')
    .select('user_id, outcome, outcome_id')
    .eq('market_id', marketId)
    .is('cancelled_at', null);

  if (error || !positions) {
    console.error(`[${ts}] notifyMarketResolved ERROR: failed to fetch positions - ${error?.message}`);
    return;
  }

  // Get unique user IDs
  const userIds = [...new Set(positions.map((p) => p.user_id))];
  if (userIds.length === 0) return;

  // Fetch user profiles with notification preference
  const { data: users, error: usersError } = await admin
    .from('profiles')
    .select('id, phone')
    .in('id', userIds)
    .eq('notify_market_resolved', true)
    .eq('is_banned', false);

  if (usersError || !users) {
    console.error(`[${ts}] notifyMarketResolved ERROR: failed to fetch user profiles - ${usersError?.message}`);
    return;
  }

  const phoneMap = new Map(users.map((u) => [u.id, u.phone]));
  const q = truncate(question, MAX_QUESTION_LENGTH);
  const outcomeDisplay = resolvedOutcome.toUpperCase();

  console.info(`[${ts}] notifyMarketResolved INFO: sending to ${users.length} users for market ${marketId}`);

  // Determine winner/loser per user
  const smsTasks: Promise<void>[] = [];
  const processedUsers = new Set<string>();

  for (const pos of positions) {
    if (processedUsers.has(pos.user_id)) continue;
    processedUsers.add(pos.user_id);

    const phone = phoneMap.get(pos.user_id);
    if (!phone) continue;

    // Check if this user has any winning position
    const userPositions = positions.filter((p) => p.user_id === pos.user_id);
    let isWinner: boolean;

    if (marketType === 'multiple_choice') {
      isWinner = userPositions.some((p) => p.outcome_id === winningOutcomeId);
    } else {
      isWinner = userPositions.some((p) => p.outcome === resolvedOutcome);
    }

    const msg = isWinner
      ? `Frontrun: You won! "${q}" resolved ${outcomeDisplay}. frontrun.bet/markets/${marketId}`
      : `Frontrun: "${q}" resolved ${outcomeDisplay}. frontrun.bet/markets/${marketId}`;

    smsTasks.push(
      sendSms({
        userId: pos.user_id,
        phone,
        eventType: 'market_resolved',
        marketId,
        message: msg,
      })
    );
  }

  await Promise.allSettled(smsTasks);
}
