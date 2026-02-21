'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

type BalanceState = {
  balance: number;
  isLoading: boolean;
  error: string | null;
};

/**
 * Real-time token balance hook.
 * Queries the user_balances view (SUM of token_ledger) and subscribes
 * to Realtime INSERTs on token_ledger for live updates.
 */
export function useUserBalance(): BalanceState {
  const [state, setState] = useState<BalanceState>({
    balance: 0,
    isLoading: true,
    error: null,
  });

  const fetchBalance = useCallback(async (userId: string) => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('user_balances')
      .select('balance')
      .eq('user_id', userId)
      .single();

    if (error) {
      console.warn(
        `[useUserBalance] WARN: balance query failed - ${error.message}`
      );
      setState((prev) => ({ ...prev, isLoading: false, error: error.message }));
      return;
    }

    setState({
      balance: Number(data?.balance ?? 0),
      isLoading: false,
      error: null,
    });
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setState({ balance: 0, isLoading: false, error: null });
        return;
      }

      // Initial fetch
      await fetchBalance(user.id);

      // Subscribe to Realtime INSERTs on token_ledger for this user
      channel = supabase
        .channel(`balance:${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'token_ledger',
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            console.debug(
              '[useUserBalance] DEBUG: ledger insert received',
              payload.new
            );
            // Re-fetch balance from the view to stay consistent
            fetchBalance(user.id);
          }
        )
        .subscribe();
    }

    init();

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [fetchBalance]);

  return state;
}
