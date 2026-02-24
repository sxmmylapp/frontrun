export default function AdminPrizesLoading() {
  return (
    <div className="px-4 py-4">
      <div className="mb-4 h-3 w-12 animate-pulse rounded bg-muted" />
      <div className="mt-2 h-6 w-36 animate-pulse rounded bg-muted" />
      <div className="mt-1 h-3 w-56 animate-pulse rounded bg-muted" />
      <div className="mt-4 rounded-sm border border-border bg-card p-4">
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        <div className="mt-2 flex gap-2">
          <div className="h-9 flex-1 animate-pulse rounded bg-muted" />
          <div className="h-9 w-20 animate-pulse rounded bg-muted" />
        </div>
      </div>
      <div className="mt-6 space-y-6">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-sm border border-border bg-card p-4">
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
            <div className="mt-3 space-y-2">
              {Array.from({ length: 5 }).map((_, j) => (
                <div key={j} className="h-8 animate-pulse rounded bg-muted" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
