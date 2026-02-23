export default function LeaderboardLoading() {
  return (
    <div className="px-4 py-4">
      <div className="h-6 w-32 animate-pulse rounded bg-muted" />
      <div className="mt-1 h-3 w-40 animate-pulse rounded bg-muted" />
      <div className="mt-4 space-y-1">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className={`flex items-center justify-between rounded-sm px-3 py-2.5 ${
              i < 3 ? 'bg-secondary/50' : ''
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="h-4 w-6 animate-pulse rounded bg-muted" />
              <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            </div>
            <div className="h-4 w-14 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
