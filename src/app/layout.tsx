import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

const geistSans = localFont({
  src: './fonts/GeistVF.woff2',
  variable: '--font-geist-sans',
  display: 'swap',
});

const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff2',
  variable: '--font-geist-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Frontrun',
  description: 'Community prediction markets — bet tokens on what happens next',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#171717',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseHost = supabaseUrl ? new URL(supabaseUrl).hostname : null;

  return (
    <html lang="en" className="dark">
      <head>
        {supabaseHost && (
          <>
            <link rel="dns-prefetch" href={`//${supabaseHost}`} />
            <link rel="preconnect" href={supabaseUrl!} crossOrigin="anonymous" />
          </>
        )}
        <link rel="dns-prefetch" href="//js.stripe.com" />
        <link rel="dns-prefetch" href="//api.stripe.com" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased overscroll-none`}
      >
        {children}
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
