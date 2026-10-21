import type { NextConfig } from 'next';

// Accepte aussi les anciens noms VITE_* (déjà saisis sur Netlify).
const env = (name: string) => process.env[`NEXT_PUBLIC_${name}`] ?? process.env[`VITE_${name}`] ?? '';

const config: NextConfig = {
  env: {
    NEXT_PUBLIC_SUPABASE_URL: env('SUPABASE_URL'),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: env('SUPABASE_ANON_KEY'),
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: env('VAPID_PUBLIC_KEY'),
  },
  async headers() {
    return [{ source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }, { key: 'Service-Worker-Allowed', value: '/' }] }];
  },
};

export default config;
