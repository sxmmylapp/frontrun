'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { verifyOtp, sendOtp } from '@/lib/auth/actions';
import { toast } from 'sonner';

function VerifyForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const phone = searchParams.get('phone') ?? '';

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(30);

  // Countdown timer for resend
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Redirect if no phone
  useEffect(() => {
    if (!phone) {
      router.replace('/login');
    }
  }, [phone, router]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!code.trim() || !phone) return;

      setLoading(true);
      const result = await verifyOtp(phone, code);
      setLoading(false);

      if (result.success) {
        router.push('/feed');
      } else {
        toast.error(result.error);
        setCode('');
      }
    },
    [code, phone, router]
  );

  async function handleResend() {
    if (resendCooldown > 0 || !phone) return;
    const result = await sendOtp(phone);
    if (result.success) {
      toast.success('New code sent');
      setResendCooldown(30);
    } else {
      toast.error(result.error);
    }
  }

  // Mask phone: show last 4 digits
  const maskedPhone = phone
    ? phone.slice(0, -4).replace(/\d/g, '*') + phone.slice(-4)
    : '';

  if (!phone) return null;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="otp" className="text-sm font-medium">
          Verification code
        </label>
        <p className="text-sm text-muted-foreground">
          Enter the code sent to {maskedPhone}
        </p>
        <Input
          id="otp"
          type="text"
          inputMode="numeric"
          placeholder="000000"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          className="h-10 rounded-sm text-center text-lg tracking-widest"
          autoFocus
          autoComplete="one-time-code"
        />
      </div>
      <Button
        type="submit"
        className="h-10 w-full rounded-sm"
        disabled={loading || code.length !== 6}
      >
        {loading ? 'Verifying...' : 'Verify'}
      </Button>
      <div className="text-center">
        <button
          type="button"
          onClick={handleResend}
          disabled={resendCooldown > 0}
          className="text-sm text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {resendCooldown > 0
            ? `Resend code in ${resendCooldown}s`
            : 'Resend code'}
        </button>
      </div>
    </form>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="text-center text-muted-foreground text-sm">Loading...</div>}>
      <VerifyForm />
    </Suspense>
  );
}
