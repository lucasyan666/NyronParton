import type { Metadata, Viewport } from 'next';
import { Inter, Instrument_Serif } from 'next/font/google';
import { SwRegister } from '@/components/SwRegister';
import './globals.css';

/**
 * Both faces are fetched at build time and self-hosted from /_next/static, so
 * there is no runtime request to Google and no layout shift on load.
 */
const serif = Instrument_Serif({
  weight: '400',
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-serif',
  display: 'swap',
});

const sans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Nyron Parton — Film Photography',
  description:
    'A moving exhibition of film photography by Nyron Parton. Nights, friends, ' +
    'and the places in between. Manchester and the West Midlands.',
  openGraph: {
    title: 'Nyron Parton — Film Photography',
    description: 'Step into the light — a moving exhibition of film photography.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#0c0b0a',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <head>
        {/*
          * The landing image is what the visitor waits on, so ask for it in
          * the HTML rather than when React reaches the <img>. imageSrcSet
          * mirrors the markup exactly so the browser preloads the same
          * candidate it will later use, not a second one.
          */}
        <link
          rel="preload"
          as="image"
          href="/photos/hero.mid.webp"
          imageSrcSet="/photos/hero.thumb.webp 400w, /photos/hero.mid.webp 1280w, /photos/hero.webp 2048w"
          imageSizes="(max-width: 900px) 100vw, 1280px"
          fetchPriority="high"
        />
      </head>
      <body>
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
