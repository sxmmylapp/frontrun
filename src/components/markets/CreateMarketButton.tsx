'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CreateMarketDialog } from './CreateMarketDialog';

export function CreateMarketButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button className="h-8 rounded-sm text-xs" onClick={() => setOpen(true)}>
        + New Market
      </Button>
      {open && <CreateMarketDialog onClose={() => setOpen(false)} />}
    </>
  );
}
