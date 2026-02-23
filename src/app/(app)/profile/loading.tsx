export default function ProfileLoading() {
  return (
    <div className="px-4 py-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="h-6 w-28 animate-pulse rounded bg-muted" />
          <div className="mt-1 h-3 w-20 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-8 w-16 animate-pulse rounded bg-muted" />
      </div>
      <div className="mt-6">
        <div className="mb-3 h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-sm border border-border bg-card p-3"
            >
              <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-5 w-10 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-28 animate-pulse rounded bg-muted" />
                </div>
                <div className="h-3 w-8 animate-pulse rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
