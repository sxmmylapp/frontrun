import { TopNav } from '@/components/nav/TopNav';
import { BottomNav } from '@/components/nav/BottomNav';
import { WelcomeToast } from '@/components/welcome/WelcomeToast';
import { NotificationPopup } from '@/components/notifications/NotificationPopup';

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <TopNav />
      <main className="min-h-[100dvh] pb-20 pt-14">{children}</main>
      <BottomNav />
      <WelcomeToast />
      <NotificationPopup />
    </>
  );
}
