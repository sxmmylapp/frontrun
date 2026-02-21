import { Suspense } from 'react';
import { BuyTokensClient } from './BuyTokensClient';

export default function BuyPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      }
    >
      <BuyTokensClient />
    </Suspense>
  );
}
