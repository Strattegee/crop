import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { parseTheme, serverMode, SYSTEM_MODE_SCRIPT, THEME_COOKIE } from '../lib/theme';
import localFont from 'next/font/local';
import './globals.css';

/** Poppins SemiBold for the CROP wordmark, served from CROP itself (no outside font service). Open Font License. */
const poppins = localFont({ src: './fonts/poppins-600.woff2', weight: '600', variable: '--font-brand', display: 'swap' });

export const metadata: Metadata = {
  title: 'CROP Workforce Management',
  description: 'Credentials, Rostering, Operations, People',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en-AU" className={poppins.variable} data-theme={theme} data-mode={serverMode(theme)} suppressHydrationWarning>
      <head>
        {theme === 'system' && <script dangerouslySetInnerHTML={{ __html: SYSTEM_MODE_SCRIPT }} />}
      </head>
      <body>{children}</body>
    </html>
  );
}
