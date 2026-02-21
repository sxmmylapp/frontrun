'use server';

import { createClient } from '@/lib/supabase/server';
import { z } from 'zod/v4';

// E.164 phone format: +[country code][number], 8-15 digits total
const phoneSchema = z.string().regex(
  /^\+[1-9]\d{7,14}$/,
  'Invalid phone number format'
);

const otpSchema = z.string().regex(/^\d{6}$/, 'Code must be 6 digits');

type ActionResult = { success: true } | { success: false; error: string };

/**
 * Send OTP to phone number via Supabase Auth (Twilio Verify)
 */
export async function sendOtp(phone: string): Promise<ActionResult> {
  const ts = new Date().toISOString();
  const maskedPhone = phone.slice(0, -4).replace(/\d/g, '*') + phone.slice(-4);

  // Validate phone format
  const parsed = phoneSchema.safeParse(phone);
  if (!parsed.success) {
    console.warn(`[${ts}] sendOtp WARN: invalid phone format - ${maskedPhone}`);
    return { success: false, error: 'Please enter a valid phone number' };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithOtp({ phone });

    if (error) {
      console.error(`[${ts}] sendOtp ERROR: ${error.message} - ${maskedPhone}`);
      return {
        success: false,
        error: 'Could not send verification code. Please try again.',
      };
    }

    console.info(`[${ts}] sendOtp INFO: OTP sent to ${maskedPhone}`);
    return { success: true };
  } catch (err) {
    console.error(`[${ts}] sendOtp ERROR: unexpected -`, err);
    return {
      success: false,
      error: 'Something went wrong. Please try again.',
    };
  }
}

/**
 * Verify OTP code for phone number
 * On success for new users, the DB trigger auto-creates profile + grants tokens
 */
export async function verifyOtp(
  phone: string,
  token: string
): Promise<ActionResult> {
  const ts = new Date().toISOString();
  const maskedPhone = phone.slice(0, -4).replace(/\d/g, '*') + phone.slice(-4);

  // Validate inputs
  const phoneResult = phoneSchema.safeParse(phone);
  if (!phoneResult.success) {
    return { success: false, error: 'Invalid phone number' };
  }

  const otpResult = otpSchema.safeParse(token);
  if (!otpResult.success) {
    return { success: false, error: 'Code must be 6 digits' };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      phone,
      token,
      type: 'sms',
    });

    if (error) {
      console.warn(
        `[${ts}] verifyOtp WARN: ${error.message} - ${maskedPhone}`
      );
      return {
        success: false,
        error: 'Invalid code, please try again.',
      };
    }

    console.info(`[${ts}] verifyOtp INFO: verified ${maskedPhone}`);
    return { success: true };
  } catch (err) {
    console.error(`[${ts}] verifyOtp ERROR: unexpected -`, err);
    return {
      success: false,
      error: 'Something went wrong. Please try again.',
    };
  }
}
