'use client';

import { useState, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { createClient } from '@/lib/supabase/client';

export type ActivityItem = {
  id: string;
  outcome: 'yes' | 'no';
  shares: number;
  cost: number;
  createdAt: string;
  cancelledAt: string | null;
  displayName: string;
};

type ActivityFeedProps = {
  marketId: string;
  initialItems: ActivityItem[];
};

const INITIAL_DISPLAY = 20;

export function ActivityFeed({ marketId, initialItems }: ActivityFeedProps) {
  const [items, setItems] = useState(initialItems);
  const [showAll, setShowAll] = useState(false);

  // Subscribe to new positions for live updates
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`activity:${marketId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'positions',
          filter: `market_id=eq.${marketId}`,
        },
        async (payload) => {
          const row = payload.new as {
            id: string;
            outcome: string;
            shares: number;
            cost: number;
            created_at: string;
            cancelled_at: string | null;
            user_id: string;
          };

          // Fetch display name for the new position's user
          const { data: profile } = await supabase
            .from('profiles')
            .select('display_name')
            .eq('id', row.user_id)
            .single();

          const newItem: ActivityItem = {
            id: row.id,
            outcome: row.outcome as 'yes' | 'no',
            shares: Number(row.shares),
            cost: Number(row.cost),
            createdAt: row.created_at,
            cancelledAt: row.cancelled_at,
            displayName: profile?.display_name ?? 'Anonymous',
          };

          setItems((prev) => [newItem, ...prev]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [marketId]);

  if (items.length === 0) return null;

  const displayed = showAll ? items : items.slice(0, INITIAL_DISPLAY);

  return (
    <div className="mt-4 rounded-sm border border-border bg-card p-4">
      <h3 className="text-xs font-medium text-muted-foreground">Recent Activity</h3>
      <div className="mt-2 space-y-2">
        {displayed.map((item) => (
          <div key={item.id} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span className="truncate text-foreground">{item.displayName}</span>
              {item.cancelledAt ? (
                <span className="shrink-0 rounded-sm bg-yellow-950/30 px-1.5 py-0.5 font-medium text-yellow-400">
                  SOLD
                </span>
              ) : (
                <span
                  className={`shrink-0 rounded-sm px-1.5 py-0.5 font-medium ${
                    item.outcome === 'yes'
                      ? 'bg-green-950/30 text-green-400'
                      : 'bg-red-950/30 text-red-400'
                  }`}
                >
                  {item.outcome.toUpperCase()}
                </span>
              )}
            </div>
            <div className="shrink-0 ml-2 flex items-center gap-2 text-muted-foreground">
              <span>
                {item.cancelledAt
                  ? `${Math.round(item.shares)} shares`
                  : `${Math.round(item.shares)} @ ${Math.round(item.cost)}`}
              </span>
              <span>{formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}</span>
            </div>
          </div>
        ))}
      </div>
      {!showAll && items.length > INITIAL_DISPLAY && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-2 text-xs text-muted-foreground hover:text-foreground"
        >
          Show all ({items.length})
        </button>
      )}
    </div>
  );
}
