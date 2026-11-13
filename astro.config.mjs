import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import vercel from '@astrojs/vercel';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// On Vercel (it sets VERCEL=1 during builds) use the Vercel adapter; everywhere else run as a plain Node server.
const onVercel = !!process.env.VERCEL;

export default defineConfig({
  output: 'server',
  // A first bank sync pulls up to two years of history, so give requests a full minute.
  adapter: onVercel ? vercel({ maxDuration: 60 }) : node({ mode: 'standalone' }),
  integrations: [react()],
  server: { port: 4321 },
  vite: { plugins: [tailwindcss()] },
});
