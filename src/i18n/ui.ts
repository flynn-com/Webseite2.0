export const languages = {
  de: 'Deutsch',
  en: 'English',
} as const;

export const defaultLang = 'de';

export type Lang = keyof typeof languages;

export const ui = {
  de: {
    'nav.home': 'Start',
    'nav.projects': 'Projekte',
    'nav.about': '\u00dcber mich',
    'nav.imprint': 'Impressum',
    'nav.privacy': 'Datenschutz',
    'nav.menu': 'Men\u00fc',
    'home.intro.headline': 'Flynn Bertsch',
    'home.intro.subline': 'Fotografie \u00b7 Videografie \u00b7 Webdesign \u00b7 Design',
    'home.featured.title': 'Ausgew\u00e4hlte Projekte',
    'home.portfolio': 'PORTFOLIO',
    'home.cta.allProjects': 'Alle Projekte ansehen',
    'projects.title': 'Projekte',
    'projects.filter.all': 'Alle',
    'projects.filter.fotografie': 'Fotografie',
    'projects.filter.video': 'Videografie',
    'projects.filter.webdesign': 'Webdesign',
    'projects.filter.design': 'Design',
    'projects.empty': 'Noch keine Projekte ver\u00f6ffentlicht.',
    'project.back': '\u2190 Zur\u00fcck zu den Projekten',
    'project.gallery': 'Galerie',
    'project.videos': 'Videos',
    'project.youtube': 'YouTube',
    'project.tags': 'Tags',
    'project.published': 'Ver\u00f6ffentlicht',
    'youtube.loadHint': 'Zum Laden des Videos klicken. Erst dann werden Daten von YouTube geladen.',
    'youtube.play': 'Video abspielen',
    'footer.copyright': 'Alle Rechte vorbehalten.',
  },
  en: {
    'nav.home': 'Home',
    'nav.projects': 'Projects',
    'nav.about': 'About',
    'nav.imprint': 'Imprint',
    'nav.privacy': 'Privacy',
    'nav.menu': 'Menu',
    'home.intro.headline': 'Flynn Bertsch',
    'home.intro.subline': 'Photography \u00b7 Videography \u00b7 Web design \u00b7 Design',
    'home.featured.title': 'Featured projects',
    'home.portfolio': 'PORTFOLIO',
    'home.cta.allProjects': 'See all projects',
    'projects.title': 'Projects',
    'projects.filter.all': 'All',
    'projects.filter.fotografie': 'Photography',
    'projects.filter.video': 'Videography',
    'projects.filter.webdesign': 'Web design',
    'projects.filter.design': 'Design',
    'projects.empty': 'No projects published yet.',
    'project.back': '\u2190 Back to projects',
    'project.gallery': 'Gallery',
    'project.videos': 'Videos',
    'project.youtube': 'YouTube',
    'project.tags': 'Tags',
    'project.published': 'Published',
    'youtube.loadHint': 'Click to load. Data will only be fetched from YouTube once you click.',
    'youtube.play': 'Play video',
    'footer.copyright': 'All rights reserved.',
  },
} as const;

export function t(lang: Lang, key: keyof (typeof ui)['de']): string {
  return ui[lang][key] ?? ui[defaultLang][key];
}

// H\u00e4ngt das Astro-`base` (z.B. "/Webseite2.0") vor einen absoluten Pfad,
// damit Links und Bildquellen auch unter GitHub Pages funktionieren.
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL ?? '/';
  const baseTrim = base.endsWith('/') ? base.slice(0, -1) : base;
  const norm = path.startsWith('/') ? path : '/' + path;
  // Kein doppelter Prefix falls Decap den Base schon mitspeichert
  if (baseTrim && norm.startsWith(baseTrim + '/')) return norm;
  return (baseTrim + norm) || '/';
}

// Entfernt ein evtl. vorhandenes base-Pr\u00e4fix (n\u00fctzlich f\u00fcr Pfadvergleiche).
export function stripBase(path: string): string {
  const base = import.meta.env.BASE_URL ?? '/';
  const baseTrim = base.endsWith('/') ? base.slice(0, -1) : base;
  if (baseTrim && path.startsWith(baseTrim)) return path.slice(baseTrim.length) || '/';
  return path;
}

export function getLangFromUrl(url: URL): Lang {
  const path = stripBase(url.pathname);
  const [, segment] = path.split('/');
  if (segment in languages) return segment as Lang;
  return defaultLang;
}

export function pathForLang(lang: Lang, pageKey: PageKey): string {
  return withBase(routes[lang][pageKey]);
}

export type PageKey =
  | 'home'
  | 'projects'
  | 'about'
  | 'imprint'
  | 'privacy';

export const routes: Record<Lang, Record<PageKey, string>> = {
  de: {
    home: '/',
    projects: '/projekte/',
    about: '/ueber-mich/',
    imprint: '/impressum/',
    privacy: '/datenschutz/',
  },
  en: {
    home: '/en/',
    projects: '/en/projects/',
    about: '/en/about/',
    imprint: '/en/imprint/',
    privacy: '/en/privacy/',
  },
};

export function projectDetailPath(lang: Lang, slug: string): string {
  return withBase(lang === 'de' ? `/projekte/${slug}/` : `/en/projects/${slug}/`);
}
