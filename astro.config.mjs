import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  // site: 'https://<github-username>.github.io',
  // base: '/<repo-name>',   // nur n\u00f6tig falls die Seite NICHT unter einer eigenen Domain l\u00e4uft
  //                         // bei eigener Domain (z. B. flynnbertsch.com) bleibt beides kommentiert
  //                         // bzw. nur `site` auf die Domain setzen.
  i18n: {
    defaultLocale: 'de',
    locales: ['de', 'en'],
    routing: {
      prefixDefaultLocale: false, // DE ohne /de-Pr\u00e4fix, EN unter /en/...
    },
  },
  trailingSlash: 'ignore',
});
