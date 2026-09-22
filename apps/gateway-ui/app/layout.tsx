import type { Metadata } from 'next';
import '@fontsource-variable/ibm-plex-sans';
import './globals.css';

export const metadata: Metadata = {
  title: 'Elos · Gateway',
  description: 'Configure seus agentes, canais e conexões em um só lugar.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
