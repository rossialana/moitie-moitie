import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Moitié-Moitié',
    short_name: 'Moitié-Moitié',
    description: 'Les tâches, les courses et les rappels de la maison, à deux.',
    lang: 'fr-FR',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#fffde9',
    theme_color: '#fffde9',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
