import { TokenBalance } from './TokenBalance';

export function TopNav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 flex h-14 items-center justify-between border-b border-border bg-background px-4 will-change-transform">
      <span className="text-lg font-bold tracking-tight">Frontrun</span>
      <TokenBalance />
    </header>
  );
}
