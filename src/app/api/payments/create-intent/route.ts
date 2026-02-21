import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { stripe } from '@/lib/stripe/server';
import { TIERS, tierSchema } from '@/lib/stripe/tiers';

export async function POST(request: Request) {
  const ts = new Date().toISOString();

  try {
    // 1. Authenticate via Supabase cookies
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error(`[${ts}] ERROR: create-intent auth failed`, authError?.message);
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // 2. Parse and validate tier from request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = tierSchema.safeParse((body as Record<string, unknown>)?.tier);
    if (!parsed.success) {
      console.error(`[${ts}] ERROR: create-intent invalid tier`, parsed.error.message);
      return NextResponse.json({ error: 'Invalid tier' }, { status: 400 });
    }

    // 3. Look up tier — server determines the price (client never sends amount)
    const tierKey = parsed.data;
    const tier = TIERS[tierKey];

    // 4. Create Stripe PaymentIntent with metadata for webhook handler
    const paymentIntent = await stripe.paymentIntents.create({
      amount: tier.price_cents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: {
        user_id: user.id,
        tier: tierKey,
        tokens: tier.tokens.toString(),
      },
    });

    console.info(
      `[${ts}] INFO: create-intent success pi=${paymentIntent.id} user=${user.id} tier=${tierKey} amount=${tier.price_cents}`
    );

    // 5. Record pending purchase in token_purchases table
    const admin = createAdminClient();
    const { error: insertError } = await admin.from('token_purchases').insert({
      user_id: user.id,
      stripe_payment_intent_id: paymentIntent.id,
      tier: tierKey,
      amount_cents: tier.price_cents,
      tokens_credited: tier.tokens,
      status: 'pending',
    });

    if (insertError) {
      console.error(
        `[${ts}] ERROR: create-intent failed to insert pending purchase pi=${paymentIntent.id}`,
        insertError.message
      );
      // Don't fail the request — the PaymentIntent is already created
      // The webhook handler can still process it via metadata
    }

    // 6. Return clientSecret for Stripe Elements on the client
    return NextResponse.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error(`[${ts}] ERROR: create-intent unexpected error`, err);
    return NextResponse.json(
      { error: 'Failed to create payment intent' },
      { status: 500 }
    );
  }
}
