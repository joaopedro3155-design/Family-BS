import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Family BS',
    short_name: 'Family BS',
    description: 'Agenda, finanças e casa da família',
    start_url: '/',
    display: 'standalone',
    background_color: '#F6F7F9',
    theme_color: '#14213D',
    lang: 'pt-BR',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
