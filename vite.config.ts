import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Moitié-Moitié',
        short_name: 'Moitié-Moitié',
        description: 'Les tâches, les courses et les rappels du foyer, à deux.',
        lang: 'fr-FR',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#fff7f8',
        theme_color: '#7a1f3d',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        // Les données viennent toujours de Supabase : on ne met jamais l'API en cache.
        navigateFallbackDenylist: [/^\/auth/],
      },
    }),
  ],
});
