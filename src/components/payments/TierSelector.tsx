'use client';

import { TIERS, type TierKey } from '@/lib/stripe/tiers';

interface TierSelectorProps {
  selected: TierKey;
  onSelect: (tier: TierKey) => void;
  disabled?: boolean;
}

const tierOrder: TierKey[] = ['small', 'medium', 'large'];

export function TierSelector({ selected, onSelect, disabled }: TierSelectorProps) {
  return (
    <div className="space-y-3">
      {tierOrder.map((key) => {
        const tier = TIERS[key];
        const isSelected = selected === key;
        const price = (tier.price_cents / 100).toFixed(0);

        return (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(key)}
            className={`w-full rounded-lg border-2 p-4 text-left transition-all ${
              isSelected
                ? 'border-green-500 bg-green-500/10'
                : 'border-border bg-card hover:border-foreground/30'
            } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold">${price}</span>
                  {'bonus' in tier && (
                    <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-400">
                      {tier.bonus}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {tier.tokens.toLocaleString()} tokens
                </p>
              </div>
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors ${
                  isSelected
                    ? 'border-green-500 bg-green-500'
                    : 'border-muted-foreground/40'
                }`}
              >
                {isSelected && (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
