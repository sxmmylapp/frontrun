'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';

type BalanceState = {
  balance: number;
  isLoading: boolean;
  error: string | null;
};

/**
 * Real-time token balance hook.
 * Queries the user_balances view on mount and applies optimistic updates
 * from Realtime INSERTs on token_ledger. Periodically syncs with the DB
 * to correct any drift.
 */
export function useUserBalance(): BalanceState {
  const [state, setState] = useState<BalanceState>({
    balance: 0,
    isLoading: true,
    error: null,
  });
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userIdRef = useRef<string | null>(null);

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

      userIdRef.current = user.id;

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
            const inserted = payload.new as { amount: number };
            // Optimistic update: apply the delta immediately
            setState((prev) => ({
              ...prev,
              balance: prev.balance + Number(inserted.amount),
              isLoading: false,
              error: null,
            }));

            // Debounced background sync to correct any drift
            if (syncTimeoutRef.current) {
              clearTimeout(syncTimeoutRef.current);
            }
            syncTimeoutRef.current = setTimeout(() => {
              if (userIdRef.current) {
                fetchBalance(userIdRef.current);
              }
            }, 5000);
          }
        )
        .subscribe();
    }

    init();

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, [fetchBalance]);

  return state;
}
