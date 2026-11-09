import * as cheerio from 'cheerio';

export const WCO_BASE_URL = 'https://www.wcostream.tv';

export const CONTENT_TYPES = [
  'dubbed',
  'subbed',
  'cartoon',
  'movie',
  'ova',
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

/**
 * `series` items link to `/anime/<path>` and are downloaded as a whole show,
 * `episode` items link to `/<path>` and are downloaded as a single video.
 */
export type ContentItemKind = 'series' | 'episode';

export interface ContentItem {
  name: string;
  path: string;
  kind: ContentItemKind;
}

export interface ContentListDefinition {
  type: ContentType;
  listUrl: string;
  cacheKey: string;
}

export const CONTENT_LISTS: Record<ContentType, ContentListDefinition> = {
  dubbed: {
    type: 'dubbed',
    listUrl: `${WCO_BASE_URL}/dubbed-anime-list/`,
    cacheKey: 'allDubbedAnimes',
  },
  subbed: {
    type: 'subbed',
    listUrl: `${WCO_BASE_URL}/subbed-anime-list/`,
    cacheKey: 'allSubbedAnimes',
  },
  cartoon: {
    type: 'cartoon',
    listUrl: `${WCO_BASE_URL}/cartoon-list/`,
    cacheKey: 'allCartoons',
  },
  movie: {
    type: 'movie',
    listUrl: `${WCO_BASE_URL}/movie-list/`,
    cacheKey: 'allMovies',
  },
  ova: {
    type: 'ova',
    listUrl: `${WCO_BASE_URL}/ova-list/`,
    cacheKey: 'allOvas',
  },
};

export const CONTENT_LIST_TTL_MS = 2 * 24 * 60 * 60 * 1000;

const LIST_LINK_RE = /^\/(anime\/)?([^/]+)\/?$/;

/**
 * Extracts the title links from a wcostream list page. Show links look like
 * `/anime/<slug>?season=all&lang=dub`, movie and OVA links like `/<slug>`.
 */
export function parseContentList(html: string): ContentItem[] {
  const $ = cheerio.load(html);
  const items: ContentItem[] = [];
  const seen = new Set<string>();

  $('#ddmcc_container a[href]').each((_, element) => {
    const href = $(element).attr('href').trim();
    // Skips letter navigation (`#A`, `/movie-list#A`) and ad links (`//host/...`).
    if (href.includes('#') || href.startsWith('//')) return;

    const match = LIST_LINK_RE.exec(href.split('?')[0]);
    if (!match) return;

    const kind: ContentItemKind = match[1] ? 'series' : 'episode';
    const path = match[2];
    const key = `${kind}:${path}`;
    if (seen.has(key)) return;

    const name = ($(element).text() || $(element).attr('title') || path).trim();
    seen.add(key);
    items.push({ name, path, kind });
  });

  return items;
}
