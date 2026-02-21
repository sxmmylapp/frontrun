'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Elements } from '@stripe/react-stripe-js';
import { stripePromise } from '@/lib/stripe/client';
import { TIERS, type TierKey } from '@/lib/stripe/tiers';
import { TierSelector } from '@/components/payments/TierSelector';
import { CheckoutForm } from '@/components/payments/CheckoutForm';
import Link from 'next/link';

export function BuyTokensClient() {
  const searchParams = useSearchParams();
  const success = searchParams.get('success') === 'true';
  const [selectedTier, setSelectedTier] = useState<TierKey>('medium');
  const [showCheckout, setShowCheckout] = useState(false);

  // Success state after payment redirect
  if (success) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-green-400"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h2 className="text-xl font-bold">Tokens purchased!</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Your tokens are being added to your account. Your balance will update
          momentarily.
        </p>
        <Link
          href="/feed"
          className="mt-6 rounded-md bg-foreground px-6 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
        >
          Back to markets
        </Link>
      </div>
    );
  }

  const tier = TIERS[selectedTier];

  return (
    <div className="px-4 py-4">
      <h2 className="mb-1 text-lg font-semibold">Buy Tokens</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        Select a token pack to get started
      </p>

      <TierSelector
        selected={selectedTier}
        onSelect={(t) => {
          setSelectedTier(t);
          setShowCheckout(false);
        }}
        disabled={showCheckout}
      />

      {!showCheckout ? (
        <button
          onClick={() => setShowCheckout(true)}
          className="mt-6 w-full rounded-md bg-foreground py-3 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
        >
          Continue to payment
        </button>
      ) : (
        <div className="mt-6">
          <div className="mb-4 rounded-md bg-muted/50 p-3 text-center text-sm">
            <span className="text-muted-foreground">Paying </span>
            <span className="font-semibold">
              ${(tier.price_cents / 100).toFixed(0)}
            </span>
            <span className="text-muted-foreground"> for </span>
            <span className="font-semibold">
              {tier.tokens.toLocaleString()} tokens
            </span>
          </div>

          <Elements
            key={selectedTier}
            stripe={stripePromise}
            options={{
              mode: 'payment',
              amount: tier.price_cents,
              currency: 'usd',
              appearance: {
                theme: 'night',
                variables: {
                  colorPrimary: '#22c55e',
                  colorBackground: '#09090b',
                  colorText: '#fafafa',
                  colorDanger: '#ef4444',
                  borderRadius: '6px',
                },
              },
            }}
          >
            <CheckoutForm tier={selectedTier} />
          </Elements>

          <button
            onClick={() => setShowCheckout(false)}
            className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground"
          >
            Change pack
          </button>
        </div>
      )}
    </div>
  );
}
