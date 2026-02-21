'use client';

import { useState, useCallback } from 'react';
import {
  useStripe,
  useElements,
  ExpressCheckoutElement,
  PaymentElement,
} from '@stripe/react-stripe-js';
import type { StripeExpressCheckoutElementConfirmEvent } from '@stripe/stripe-js';
import { Button } from '@/components/ui/button';

interface CheckoutFormProps {
  tier: string;
}

export function CheckoutForm({ tier }: CheckoutFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [walletAvailable, setWalletAvailable] = useState<boolean | null>(null);

  const handleExpressCheckoutReady = useCallback(
    ({ availablePaymentMethods }: { availablePaymentMethods?: Record<string, boolean> | null }) => {
      // If no payment methods available, show fallback
      if (!availablePaymentMethods || Object.keys(availablePaymentMethods).length === 0) {
        setWalletAvailable(false);
      } else {
        setWalletAvailable(true);
      }
    },
    []
  );

  const createIntentAndConfirm = useCallback(async () => {
    if (!stripe || !elements) return;

    setError(null);
    setProcessing(true);

    try {
      // 1. Submit elements (validates payment details)
      const { error: submitError } = await elements.submit();
      if (submitError) {
        setError(submitError.message ?? 'Payment validation failed');
        setProcessing(false);
        return;
      }

      // 2. Create PaymentIntent server-side (deferred creation)
      const res = await fetch('/api/payments/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? 'Failed to create payment');
        setProcessing(false);
        return;
      }

      const { clientSecret } = await res.json();

      // 3. Confirm payment with Stripe
      const { error: confirmError } = await stripe.confirmPayment({
        elements,
        clientSecret,
        confirmParams: {
          return_url: `${window.location.origin}/buy?success=true`,
        },
      });

      // If we get here, confirmPayment failed (otherwise it redirects)
      if (confirmError) {
        setError(confirmError.message ?? 'Payment failed');
      }
    } catch (err) {
      console.error('[CheckoutForm] ERROR: payment flow failed', err);
      setError('Something went wrong. Please try again.');
    }

    setProcessing(false);
  }, [stripe, elements, tier]);

  const handleExpressCheckoutConfirm = useCallback(
    async (_event: StripeExpressCheckoutElementConfirmEvent) => {
      await createIntentAndConfirm();
    },
    [createIntentAndConfirm]
  );

  const handleCardSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      await createIntentAndConfirm();
    },
    [createIntentAndConfirm]
  );

  return (
    <div className="space-y-4">
      {/* Express Checkout (Apple Pay / Google Pay) */}
      <div className="min-h-[48px]">
        <ExpressCheckoutElement
          onConfirm={handleExpressCheckoutConfirm}
          onReady={handleExpressCheckoutReady}
        />
      </div>

      {/* Fallback: Payment Element for card entry */}
      {walletAvailable === false && (
        <form onSubmit={handleCardSubmit}>
          <div className="mb-2 text-center text-xs text-muted-foreground">
            Or pay with card
          </div>
          <PaymentElement />
          <Button
            type="submit"
            disabled={!stripe || processing}
            className="mt-4 w-full"
          >
            {processing ? 'Processing...' : 'Pay now'}
          </Button>
        </form>
      )}

      {/* Error display */}
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Processing overlay */}
      {processing && (
        <div className="text-center text-sm text-muted-foreground">
          Processing your payment...
        </div>
      )}
    </div>
  );
}
