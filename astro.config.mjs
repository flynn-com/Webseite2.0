import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://flynn-com.github.io',
  base: '/Webseite2.0',
  // Bei eigener Domain (z. B. flynnbertsch.com) sp\u00e4ter stattdessen:
  //   site: 'https://flynnbertsch.com',
  //   base: '/',  (oder Zeile entfernen)
  i18n: {
    defaultLocale: 'de',
    locales: ['de', 'en'],
    routing: {
      prefixDefaultLocale: false, // DE ohne /de-Pr\u00e4fix, EN unter /en/...
    },
  },
  trailingSlash: 'ignore',
});
