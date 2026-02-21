import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { stripe } from '@/lib/stripe/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(request: Request) {
  const ts = new Date().toISOString();

  // CRITICAL: Use request.text() NOT request.json()
  // Re-stringifying after json() produces different bytes, breaking signature verification
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    console.error(`[${ts}] ERROR: webhook missing stripe-signature header`);
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  // 1. Verify Stripe webhook signature
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error(`[${ts}] ERROR: webhook signature verification failed`, err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  console.info(`[${ts}] INFO: webhook received event=${event.id} type=${event.type}`);

  // 2. Route by event type
  if (event.type === 'payment_intent.succeeded') {
    return handlePaymentSucceeded(event, ts);
  } else if (event.type === 'payment_intent.payment_failed') {
    return handlePaymentFailed(event, ts);
  }

  // Return 200 for all other event types (don't block Stripe retries)
  return NextResponse.json({ received: true });
}

async function handlePaymentSucceeded(event: Stripe.Event, ts: string) {
  const paymentIntent = event.data.object as Stripe.PaymentIntent;
  const userId = paymentIntent.metadata.user_id;
  const tokens = parseInt(paymentIntent.metadata.tokens, 10);

  console.info(
    `[${ts}] INFO: webhook payment_intent.succeeded pi=${paymentIntent.id} user=${userId} tokens=${tokens}`
  );

  const admin = createAdminClient();

  // 3. Deduplication: Insert into stripe_events — UNIQUE on event_id
  const { error: dedupError } = await admin.from('stripe_events').insert({
    event_id: event.id,
    event_type: event.type,
    payment_intent_id: paymentIntent.id,
  });

  if (dedupError?.code === '23505') {
    // Unique violation — already processed
    console.info(`[${ts}] INFO: webhook duplicate event ${event.id}, skipping`);
    return NextResponse.json({ received: true });
  }

  if (dedupError) {
    console.error(`[${ts}] ERROR: webhook stripe_events insert failed`, dedupError.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }

  // 4. Validate metadata
  if (!userId || isNaN(tokens) || tokens <= 0) {
    console.error(
      `[${ts}] ERROR: webhook invalid metadata pi=${paymentIntent.id} user=${userId} tokens=${tokens}`
    );
    return NextResponse.json({ error: 'Invalid metadata' }, { status: 400 });
  }

  // 5. Credit tokens via atomic RPC
  const { data, error: rpcError } = await admin.rpc('credit_token_purchase', {
    p_payment_intent_id: paymentIntent.id,
    p_user_id: userId,
    p_tokens: tokens,
  });

  if (rpcError) {
    console.error(
      `[${ts}] ERROR: webhook credit_token_purchase RPC failed pi=${paymentIntent.id}`,
      rpcError.message
    );
    return NextResponse.json({ error: 'Fulfillment failed' }, { status: 500 });
  }

  const result = data as Record<string, unknown>;

  if (result?.error) {
    console.error(
      `[${ts}] ERROR: webhook credit_token_purchase returned error pi=${paymentIntent.id}`,
      result.error
    );
    return NextResponse.json({ error: 'Fulfillment error' }, { status: 500 });
  }

  if (result?.already_processed) {
    console.info(
      `[${ts}] INFO: webhook credit_token_purchase already processed pi=${paymentIntent.id}`
    );
    return NextResponse.json({ received: true });
  }

  console.info(
    `[${ts}] INFO: webhook tokens credited pi=${paymentIntent.id} user=${userId} tokens=${tokens} ledger_id=${result?.ledger_id}`
  );

  return NextResponse.json({ received: true });
}

async function handlePaymentFailed(event: Stripe.Event, ts: string) {
  const paymentIntent = event.data.object as Stripe.PaymentIntent;

  console.warn(
    `[${ts}] WARN: webhook payment_intent.payment_failed pi=${paymentIntent.id} reason=${paymentIntent.last_payment_error?.message ?? 'unknown'}`
  );

  const admin = createAdminClient();

  // Update purchase record to failed status
  const { error } = await admin
    .from('token_purchases')
    .update({ status: 'failed' })
    .eq('stripe_payment_intent_id', paymentIntent.id);

  if (error) {
    console.error(
      `[${ts}] ERROR: webhook failed to update purchase status pi=${paymentIntent.id}`,
      error.message
    );
  }

  return NextResponse.json({ received: true });
}
