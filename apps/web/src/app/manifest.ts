import type { MetadataRoute } from 'next';

/**
 * Installable app (PRD v3): "Add to Home Screen" opens Today full screen. On Android, Helm also
 * appears in the share sheet, so a message from WhatsApp or Instagram can be shared to it.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Helm: your private assistant',
    short_name: 'Helm',
    description:
      'Your private assistant: what to do today, from your email and the messages you share.',
    start_url: '/today',
    scope: '/',
    display: 'standalone',
    background_color: '#f4f5f7',
    theme_color: '#f4f5f7',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    share_target: {
      action: '/share',
      method: 'GET',
      params: { title: 'title', text: 'text', url: 'url' },
    },
  } as MetadataRoute.Manifest;
}
