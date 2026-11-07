import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Helm',
  description: 'A private deadline agent for every student.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#143e5c',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-sea-50 text-sea-950 antialiased dark:bg-sea-950 dark:text-sea-50">
        {children}
      </body>
    </html>
  );
}
