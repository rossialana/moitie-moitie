import type { Metadata, Viewport } from 'next';
import { Anton, Poppins } from 'next/font/google';
import './globals.css';

const anton = Anton({ weight: '400', subsets: ['latin'], variable: '--font-anton', display: 'swap' });
const poppins = Poppins({ weight: ['400', '500', '600', '700'], subsets: ['latin'], variable: '--font-poppins', display: 'swap' });

export const metadata: Metadata = {
  title: 'Moitié-Moitié',
  description: 'Les tâches, les courses et les rappels de la maison, à deux.',
  applicationName: 'Moitié-Moitié',
  appleWebApp: { capable: true, title: 'Moitié-Moitié', statusBarStyle: 'default' },
  icons: { icon: '/icon.svg', apple: '/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#fffde9',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${anton.variable} ${poppins.variable}`}>
      <body>{children}</body>
    </html>
  );
}
