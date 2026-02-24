export default function BannedPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-xl font-semibold text-red-400">Account Banned</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account has been permanently banned from Frontrun.
        </p>
      </div>
    </div>
  );
}
