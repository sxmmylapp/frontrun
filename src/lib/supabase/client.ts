// Browser Supabase client — used in Client Components
// Uses anon key with RLS — user context from cookies
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/db';

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
