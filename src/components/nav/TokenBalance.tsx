'use client';

import { useUserBalance } from '@/hooks/useUserBalance';

function CoinIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className="shrink-0"
    >
      <circle cx="8" cy="8" r="7" fill="#FACC15" opacity="0.9" />
      <text
        x="8"
        y="11"
        textAnchor="middle"
        fontSize="9"
        fontWeight="bold"
        fill="#422006"
      >
        F
      </text>
    </svg>
  );
}

function formatBalance(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function TokenBalance() {
  const { balance, isLoading } = useUserBalance();

  return (
    <div className="flex items-center gap-1.5 text-sm font-medium tabular-nums">
      <CoinIcon />
      {isLoading ? (
        <span className="inline-block h-4 w-16 animate-pulse rounded bg-muted" />
      ) : (
        <span>{formatBalance(balance)}</span>
      )}
    </div>
  );
}
