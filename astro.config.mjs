// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  // Production URL, used for canonical links and absolute social image URLs.
  site: 'https://peregrinecreativegroup.com',
  redirects: {
    '/olive-oil-supplements': { destination: '/liva', status: 301 },
  },
  vite: {
    plugins: [tailwindcss()]
  }
});
