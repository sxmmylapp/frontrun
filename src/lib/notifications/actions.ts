'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod/v4';

const preferencesSchema = z.object({
  notifyNewMarkets: z.boolean(),
  notifyMarketResolved: z.boolean(),
});

type ActionResult<T = undefined> =
  | (T extends undefined ? { success: true } : { success: true; data: T })
  | { success: false; error: string };

export type UnreadNotification = {
  id: string;
  title: string | null;
  message: string;
  max_views: number;
  created_at: string;
};

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

// --- Get Unread In-App Notifications ---

export async function getUnreadNotifications(): Promise<ActionResult<UnreadNotification[]>> {
  const ts = new Date().toISOString();

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Fetch all notifications with their dismissal for this user (if any)
    const { data: notifications, error } = await supabase
      .from('notifications')
      .select('id, title, message, max_views, created_at')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error(`[${ts}] getUnreadNotifications ERROR: ${error.message}`);
      return { success: false, error: 'Failed to fetch notifications' };
    }

    if (!notifications || notifications.length === 0) {
      return { success: true, data: [] };
    }

    // Get user's dismissals
    const notifIds = notifications.map((n) => n.id);
    const { data: dismissals } = await supabase
      .from('notification_dismissals')
      .select('notification_id, view_count')
      .in('notification_id', notifIds);

    const dismissalMap = new Map(
      (dismissals ?? []).map((d) => [d.notification_id, d.view_count])
    );

    // Filter to unread: no dismissal or view_count < max_views
    const unread = notifications.filter((n) => {
      const viewCount = dismissalMap.get(n.id);
      return viewCount === undefined || viewCount < n.max_views;
    });

    return { success: true, data: unread.slice(0, 5) };
  } catch (err) {
    console.error(`[${ts}] getUnreadNotifications ERROR: unexpected -`, err);
    return { success: false, error: 'Something went wrong' };
  }
}

// --- Dismiss In-App Notification ---

export async function dismissNotification(notificationId: string): Promise<ActionResult> {
  const ts = new Date().toISOString();

  if (!notificationId) {
    return { success: false, error: 'Notification ID is required' };
  }

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Check if dismissal already exists
    const { data: existing } = await supabase
      .from('notification_dismissals')
      .select('id, view_count')
      .eq('notification_id', notificationId)
      .eq('user_id', user.id)
      .single();

    if (existing) {
      // Increment view_count
      const { error } = await supabase
        .from('notification_dismissals')
        .update({
          view_count: existing.view_count + 1,
          dismissed_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      if (error) {
        console.error(`[${ts}] dismissNotification ERROR: ${error.message}`);
        return { success: false, error: 'Failed to dismiss notification' };
      }
    } else {
      // Insert new dismissal
      const { error } = await supabase
        .from('notification_dismissals')
        .insert({
          notification_id: notificationId,
          user_id: user.id,
          view_count: 1,
        });

      if (error) {
        console.error(`[${ts}] dismissNotification ERROR: ${error.message}`);
        return { success: false, error: 'Failed to dismiss notification' };
      }
    }

    return { success: true };
  } catch (err) {
    console.error(`[${ts}] dismissNotification ERROR: unexpected -`, err);
    return { success: false, error: 'Something went wrong' };
  }
}
