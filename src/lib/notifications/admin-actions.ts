'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod/v4';

type ActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string };

// --- Create Notification ---

const createNotificationSchema = z.object({
  title: z.string().optional(),
  message: z.string().min(1, 'Message is required'),
  maxViews: z.number().int().min(1).max(100).default(1),
});

export async function createNotification(input: {
  title?: string;
  message: string;
  maxViews: number;
}): Promise<ActionResult<{ id: string }>> {
  const ts = new Date().toISOString();

  const parsed = createNotificationSchema.safeParse(input);
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
    const { data: profile } = await admin
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (!profile?.is_admin) {
      return { success: false, error: 'Not authorized — admin only' };
    }

    const { data, error } = await admin
      .from('notifications')
      .insert({
        title: parsed.data.title || null,
        message: parsed.data.message,
        max_views: parsed.data.maxViews,
        created_by: user.id,
      })
      .select('id')
      .single();

    if (error || !data) {
      console.error(`[${ts}] createNotification ERROR: ${error?.message}`);
      return { success: false, error: 'Failed to create notification' };
    }

    console.info(`[${ts}] createNotification INFO: admin=${user.id} created notification=${data.id}`);
    return { success: true, data: { id: data.id } };
  } catch (err) {
    console.error(`[${ts}] createNotification ERROR: unexpected -`, err);
    return { success: false, error: 'Something went wrong' };
  }
}

// --- List Notifications (admin history) ---

export type NotificationHistoryItem = {
  id: string;
  title: string | null;
  message: string;
  max_views: number;
  created_at: string;
};

export async function listNotifications(): Promise<ActionResult<NotificationHistoryItem[]>> {
  const ts = new Date().toISOString();

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (!profile?.is_admin) {
      return { success: false, error: 'Not authorized — admin only' };
    }

    const { data, error } = await admin
      .from('notifications')
      .select('id, title, message, max_views, created_at')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error(`[${ts}] listNotifications ERROR: ${error.message}`);
      return { success: false, error: 'Failed to fetch notifications' };
    }

    console.info(`[${ts}] listNotifications INFO: admin=${user.id} fetched ${data?.length ?? 0} notifications`);
    return { success: true, data: data ?? [] };
  } catch (err) {
    console.error(`[${ts}] listNotifications ERROR: unexpected -`, err);
    return { success: false, error: 'Something went wrong' };
  }
}
