'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod/v4';

const preferencesSchema = z.object({
  notifyNewMarkets: z.boolean(),
  notifyMarketResolved: z.boolean(),
});

type ActionResult =
  | { success: true }
  | { success: false; error: string };

export async function updateNotificationPreferences(input: {
  notifyNewMarkets: boolean;
  notifyMarketResolved: boolean;
}): Promise<ActionResult> {
  const ts = new Date().toISOString();

  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from('profiles')
      .update({
        notify_new_markets: parsed.data.notifyNewMarkets,
        notify_market_resolved: parsed.data.notifyMarketResolved,
      })
      .eq('id', user.id);

    if (error) {
      console.error(`[${ts}] updateNotificationPreferences ERROR: ${error.message}`);
      return { success: false, error: 'Failed to update preferences' };
    }

    console.info(`[${ts}] updateNotificationPreferences INFO: user ${user.id} updated prefs`);
    return { success: true };
  } catch (err) {
    console.error(`[${ts}] updateNotificationPreferences ERROR: unexpected -`, err);
    return { success: false, error: 'Something went wrong' };
  }
}
