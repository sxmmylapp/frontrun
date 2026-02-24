export default function AdminBalancesLoading() {
  return (
    <div className="px-4 py-4">
      <div className="mb-4 h-3 w-12 animate-pulse rounded bg-muted" />
      <div className="mt-2 h-6 w-40 animate-pulse rounded bg-muted" />
      <div className="mt-1 h-3 w-56 animate-pulse rounded bg-muted" />
      <div className="mt-4 flex gap-2">
        <div className="h-9 flex-1 animate-pulse rounded bg-muted" />
        <div className="h-9 w-20 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}
