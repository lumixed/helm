import type { Metadata, Viewport } from 'next';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Helm', template: '%s · Helm' },
  description:
    'A private assistant for everyone: one agent that reads your email and messages, plans your day, and handles routine hand-ins with your OK.',
  applicationName: 'Helm',
  appleWebApp: { capable: true, title: 'Helm', statusBarStyle: 'default' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Lets the bottom tab bar use env(safe-area-inset-bottom) in the iPhone app and home-screen app.
  viewportFit: 'cover',
  themeColor: '#f4f5f7',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh bg-canvas font-sans text-ink-soft antialiased">{children}</body>
    </html>
  );
}
