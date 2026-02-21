'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useUserBalance } from '@/hooks/useUserBalance';

const WELCOME_SHOWN_KEY = 'frontrun_welcome_shown';

export function WelcomeToast() {
  const { balance, isLoading } = useUserBalance();
  const shown = useRef(false);

  useEffect(() => {
    if (isLoading || shown.current) return;

    // Only show for users who haven't seen it
    const alreadyShown = localStorage.getItem(WELCOME_SHOWN_KEY);
    if (alreadyShown) return;

    // Show welcome toast for new users (balance = 1000 = just signed up)
    if (balance === 1000) {
      shown.current = true;
      localStorage.setItem(WELCOME_SHOWN_KEY, 'true');

      toast.success('You got 1,000 tokens! Start betting.', {
        duration: 4000,
      });

      // Show tooltip hint after a short delay
      setTimeout(() => {
        toast('Bet tokens on markets. Top earners win prizes.', {
          duration: 5000,
        });
      }, 1500);
    }
  }, [balance, isLoading]);

  return null;
}
