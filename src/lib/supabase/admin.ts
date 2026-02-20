// Admin Supabase client — used for server-side operations that bypass RLS
// Uses service_role key — NEVER expose to the client
// Use ONLY in: Server Actions, Route Handlers, API routes
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/db';

export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars'
    );
  }

  return createSupabaseClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
