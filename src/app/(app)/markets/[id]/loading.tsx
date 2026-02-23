export default function MarketLoading() {
  return (
    <div className="px-4 py-4">
      <div className="h-3 w-28 animate-pulse rounded bg-muted" />
      <div className="mt-4 h-5 w-4/5 animate-pulse rounded bg-muted" />
      <div className="mt-1 h-3 w-24 animate-pulse rounded bg-muted" />
      {/* Odds grid */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-sm border border-green-800/40 bg-green-950/20 p-4">
          <div className="mx-auto h-7 w-14 animate-pulse rounded bg-muted" />
          <div className="mx-auto mt-1 h-3 w-8 animate-pulse rounded bg-muted" />
        </div>
        <div className="rounded-sm border border-red-800/40 bg-red-950/20 p-4">
          <div className="mx-auto h-7 w-14 animate-pulse rounded bg-muted" />
          <div className="mx-auto mt-1 h-3 w-8 animate-pulse rounded bg-muted" />
        </div>
      </div>
      {/* Pool info */}
      <div className="mt-3 flex justify-between">
        <div className="h-3 w-28 animate-pulse rounded bg-muted" />
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
      </div>
      {/* Bet slip skeleton */}
      <div className="mt-4 rounded-sm border border-border bg-card p-4">
        <div className="h-3 w-16 animate-pulse rounded bg-muted" />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="h-10 animate-pulse rounded-sm bg-muted" />
          <div className="h-10 animate-pulse rounded-sm bg-muted" />
        </div>
        <div className="mt-3 h-10 animate-pulse rounded-sm bg-muted" />
        <div className="mt-3 h-10 animate-pulse rounded-sm bg-muted" />
      </div>
    </div>
  );
}
