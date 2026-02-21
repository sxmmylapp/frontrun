import { TopNav } from '@/components/nav/TopNav';
import { BottomNav } from '@/components/nav/BottomNav';
import { WelcomeToast } from '@/components/welcome/WelcomeToast';

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <TopNav />
      <main className="pb-20 pt-14">{children}</main>
      <BottomNav />
      <WelcomeToast />
    </>
  );
}
