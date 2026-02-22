'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { sendOtp } from '@/lib/auth/actions';
import { toast } from 'sonner';

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim()) return;

    // Normalize: strip non-digits, remove leading 1 (country code), then prepend +1
    let digits = phone.replace(/\D/g, '');
    if (digits.startsWith('1') && digits.length === 11) {
      digits = digits.slice(1);
    }
    const normalized = `+1${digits}`;

    setLoading(true);
    const result = await sendOtp(normalized);
    setLoading(false);

    if (result.success) {
      // Pass phone via search params to verify page
      router.push(`/verify?phone=${encodeURIComponent(normalized)}`);
    } else {
      toast.error(result.error);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="phone" className="text-sm font-medium">
          Phone number
        </label>
        <div className="flex gap-2">
          <div className="flex h-10 items-center rounded-sm border border-border bg-secondary px-3 text-sm text-muted-foreground">
            +1
          </div>
          <Input
            id="phone"
            type="tel"
            inputMode="tel"
            placeholder="(555) 123-4567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="h-10 rounded-sm"
            autoFocus
            autoComplete="tel"
          />
        </div>
      </div>
      <Button
        type="submit"
        className="h-10 w-full rounded-sm"
        disabled={loading || !phone.trim()}
      >
        {loading ? 'Sending...' : 'Send Code'}
      </Button>
    </form>
  );
}
