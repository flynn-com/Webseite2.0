import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://flynnbertsch.com',
  i18n: {
    defaultLocale: 'de',
    locales: ['de', 'en'],
    routing: {
      prefixDefaultLocale: false, // DE ohne /de-Pr\u00e4fix, EN unter /en/...
    },
  },
  trailingSlash: 'ignore',
});
