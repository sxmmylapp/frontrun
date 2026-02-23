export const dynamic = 'force-dynamic';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

type LeaderboardEntry = {
  rank: number;
  displayName: string;
  balance: number;
};

export default async function LeaderboardPage() {
  // Use admin client to query across all users (RLS on profiles only allows own)
  const admin = createAdminClient();

  // Get all user balances from the view
  const { data: balances } = await admin
    .from('user_balances')
    .select('user_id, balance')
    .order('balance', { ascending: false })
    .limit(100);

  if (!balances || balances.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
        <h2 className="text-xl font-semibold">Leaderboard</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          No activity yet. Be the first to place a bet!
        </p>
      </div>
    );
  }

  // Get display names for all users on the leaderboard
  const userIds = balances.map((b) => b.user_id).filter(Boolean) as string[];
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, display_name')
    .in('id', userIds);

  const nameMap = new Map(
    (profiles ?? []).map((p) => [p.id, p.display_name])
  );

  // Check if current user is on the board
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const entries: LeaderboardEntry[] = balances.map((b, i) => ({
    rank: i + 1,
    displayName: nameMap.get(b.user_id ?? '') ?? 'Unknown',
    balance: Number(b.balance ?? 0),
  }));

  return (
    <div className="px-4 py-4">
      <h2 className="text-lg font-semibold">Leaderboard</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Ranked by token balance
      </p>

      <div className="mt-4 space-y-1">
        {entries.map((entry) => {
          const isCurrentUser =
            user &&
            nameMap.get(user.id) === entry.displayName;

          return (
            <div
              key={entry.rank}
              className={`flex items-center justify-between rounded-sm px-3 py-2.5 text-sm ${
                isCurrentUser
                  ? 'border border-primary/30 bg-primary/5'
                  : entry.rank <= 3
                    ? 'bg-secondary/50'
                    : ''
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`w-6 text-right font-mono text-xs ${
                    entry.rank === 1
                      ? 'text-yellow-400'
                      : entry.rank === 2
                        ? 'text-gray-300'
                        : entry.rank === 3
                          ? 'text-amber-600'
                          : 'text-muted-foreground'
                  }`}
                >
                  {entry.rank <= 3
                    ? ['', '1st', '2nd', '3rd'][entry.rank]
                    : `#${entry.rank}`}
                </span>
                <span className={isCurrentUser ? 'font-medium' : ''}>
                  {entry.displayName}
                  {isCurrentUser && (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      (you)
                    </span>
                  )}
                </span>
              </div>
              <span className="font-mono text-xs">
                {Math.round(entry.balance).toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
