export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">Frontrun</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Bet on what happens next
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
