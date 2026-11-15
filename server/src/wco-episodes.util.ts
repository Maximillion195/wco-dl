// What wcostream lists for a show (12 Nov 2026): read from the show page, numbered the way the downloader numbers
// them (Lifter.py download_show), so "listed here" and "the downloader can find it" mean the same thing.
import * as cheerio from 'cheerio';
import { normaliseTitle } from './fill.util';

/** The classes the downloader looks for, in its order (Lifter.py EPISODE_LINK_CLASSES). */
const CLASSES = ['sidebar-episode-item', 'dark-episode-item', 'sonra'];

export interface WcoListing {
  /** Episode links found (after the language filter). 0 means the page lists none. */
  count: number;
  /** Season number to its episode numbers, season-relative. A link with no "season" in it is season 1. */
  seasons: Map<number, Set<number>>;
  /** Every number that appears as "episode-N-" in any link, for shows numbered straight through (absolute). */
  absolute: Set<number>;
  /** The last season and episode listed, for "wcostream has up to 2x04". */
  latest?: { s: number; e: number };
  /** The links as read, kept so the listing can be saved and rebuilt. */
  links: string[];
  /** The episode title in each link ("...-episode-23-siege-on-fort-catdog"), normalised; '' when the link has none. */
  bySeason: Map<string, string>;      // "s|e" -> title
  byNumber: Map<number, string[]>;    // any "episode-N-" -> titles of the links that carry it
  /** Normalised title -> its link; a title two links share is left out. */
  byTitle: Map<string, string>;
}

/** The title words after "episode-N-" in a link, without the audio words; '' when there are none. */
export function linkTitle(url: string): string {
  const m = /episode-\d+-(.*?)\/?$/.exec(url.toLowerCase().split('?')[0]);
  if (!m) return '';
  // "...-english-dubbed-2" is the site's own duplicate marker, not a title
  return normaliseTitle(m[1].replace(/-?(english-)?(dubbed|subbed)(-\d+)?$/, '').replace(/-/g, ' ').replace(/\b(english|dubbed|subbed|dub|sub)\b/g, ' '));
}
/** A Sonarr title worth comparing: not empty, not "Episode 5" or "TBA". */
export function realTitle(t: string): string {
  const k = normaliseTitle(String(t ?? ''));
  return !k || /^(episode|ep|part)?\d+$/.test(k) || k === 'tba' || k === 'tbd' ? '' : k;
}

/** The episode links of a show page, filtered by language the way the downloader does when both are listed. */
export function parseEpisodeLinks(html: string, pageUrl: string, requestedLang?: string): string[] {
  const $ = cheerio.load(html);
  let anchors: { href: string; lang?: string }[] = [];
  for (const c of CLASSES) {
    anchors = $('a.' + c).toArray().map((a) => ({ href: String($(a).attr('href') ?? ''), lang: $(a).attr('data-lang') || undefined })).filter((a) => a.href);
    if (anchors.length) break;
  }
  const langs = new Set(anchors.map((a) => a.lang).filter(Boolean));
  const keep = langs.size >= 2 ? (requestedLang && langs.has(requestedLang) ? requestedLang : [...langs][0]) : undefined;
  const out: string[] = [];
  for (const a of anchors) {
    if (keep && a.lang && a.lang !== keep) continue;
    let link = a.href;
    try { link = new URL(a.href, pageUrl).toString(); } catch { /* keep as given */ }
    if (!out.includes(link)) out.push(link);
  }
  return out;
}

export function buildListing(links: string[]): WcoListing {
  const seasons = new Map<number, Set<number>>(), absolute = new Set<number>();
  const bySeason = new Map<string, string>(), byNumber = new Map<number, string[]>(), byTitle = new Map<string, string>();
  const dup = new Set<string>();
  let latest: WcoListing['latest'];
  for (const raw of links) {
    const url = raw.toLowerCase().replace(/^https?:\/\/[^/]+/, '');
    const title = linkTitle(url);
    for (const m of url.matchAll(/episode-(\d+)-/g)) {
      absolute.add(Number(m[1]));
      (byNumber.get(Number(m[1])) ?? byNumber.set(Number(m[1]), []).get(Number(m[1]))!).push(title);
    }
    if (title) { if (byTitle.has(title) || dup.has(title)) { byTitle.delete(title); dup.add(title); } else byTitle.set(title, raw); }
    const ep = /episode-(\d+)/.exec(url);
    if (!ep) continue;
    const e = Number(ep[1]);
    const inSeasons = new Set<number>();
    if (!url.includes('season')) inSeasons.add(1);
    for (const m of url.matchAll(/season-(\d+)-/g)) inSeasons.add(Number(m[1]));
    for (const s of inSeasons) {
      (seasons.get(s) ?? seasons.set(s, new Set()).get(s)!).add(e);
      if (!bySeason.has(`${s}|${e}`)) bySeason.set(`${s}|${e}`, title);
      if (!latest || s > latest.s || (s === latest.s && e > latest.e)) latest = { s, e };
    }
  }
  return { count: links.length, seasons, absolute, latest, links, bySeason, byNumber, byTitle };
}

/** Would the downloader find this episode? `absolute` shows are asked for by their overall number. */
export function isListed(l: WcoListing, ep: { s: number; e: number; abs?: number }, absolute: boolean): boolean {
  if (absolute) return ep.abs !== undefined && l.absolute.has(ep.abs);
  return !!l.seasons.get(ep.s)?.has(ep.e);
}

export function latestText(l: WcoListing): string {
  if (!l.latest) return '';
  return l.seasons.size === 1 && l.latest.s === 1 ? `episode ${l.latest.e}` : `${l.latest.s}x${String(l.latest.e).padStart(2, '0')}`;
}

// ---------- Which link is which episode (13 Nov 2026) ----------
// Sonarr's import history showed 36 of 71 checkable files filed under the wrong episode: on shows like Paw Patrol and
// SpongeBob the site packs two story segments into one "episode" while Sonarr numbers each segment, so the same
// number is a different episode. Titles decide; numbers are only trusted when the titles agree or cannot be compared.

/** How alike two normalised titles are, 0 to 1: 1 minus the edit distance over the longer length. */
export function alike(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}
const SAME = 0.85;

export type Source =
  /** This link is the episode, found by its title. `ids` are all the episodes the link's title names, in order. */
  | { kind: 'title'; url: string; ids: number[]; partial?: boolean }
  /** Ask by season and number: the titles agree, or one side has none to compare (most anime). */
  | { kind: 'number' }
  /** Not there: no link under that number, or the link under that number is a different episode. */
  | { kind: 'none'; why: 'unlisted' | 'different'; got?: string };

export interface EpisodeLike { id: number; s: number; e: number; abs?: number; t?: string }

/** Where each episode of a show can be had from, given the site's list. */
export function resolveSources(l: WcoListing, all: EpisodeLike[], absolute: boolean): Map<number, Source> {
  const order = [...all].filter((e) => e.s > 0).sort((a, b) => a.s - b.s || a.e - b.e);
  const titles = order.map((e) => realTitle(e.t ?? ''));
  // Each link's title as a run of whole episode titles: "pupsmakeasplashpupsfallfestival" = 1x01 + 1x02.
  const runs = new Map<number, { url: string; ids: number[]; partial?: boolean }[]>();
  const offer = (ids: number[], url: string, partial?: boolean) => {
    for (const id of ids) (runs.get(id) ?? runs.set(id, []).get(id)!).push({ url, ids, partial });
  };
  const linkTitles = l.links.map((url) => ({ url, title: linkTitle(url) })).filter((x) => x.title);
  for (const { url, title } of linkTitles) {
    const found: number[][] = [];
    const walk = (rest: string, used: number[]) => {
      if (found.length > 1) return;
      if (!rest) { found.push(used); return; }
      if (used.length >= 4) return;
      for (let i = 0; i < titles.length; i++) {
        if (titles[i] && !used.includes(i) && rest.startsWith(titles[i])) walk(rest.slice(titles[i].length), [...used, i]);
      }
    };
    walk(title, []);
    if (found.length === 1) { offer(found[0].map((i) => order[i].id), url); continue; }
    if (found.length > 1) continue;                                   // two readings: leave it to the number check
    const near = titles.map((t, i) => (t && alike(t, title) >= 0.9 ? i : -1)).filter((i) => i >= 0);
    if (near.length === 1) { offer([order[near[0]].id], url); continue; }
    // The link names this episode and something Sonarr calls differently: the file still holds the episode.
    const inside = titles.map((t, i) => (t.length >= 8 && title.includes(t) ? i : -1)).filter((i) => i >= 0);
    if (inside.length === 1) offer([order[inside[0]].id], url, true);
  }
  const out = new Map<number, Source>();
  order.forEach((e, i) => {
    const mine = (runs.get(e.id) ?? []).sort((a, b) => Number(!!a.partial) - Number(!!b.partial) || a.ids.length - b.ids.length);
    if (mine.length) { out.set(e.id, { kind: 'title', ...mine[0] }); return; }
    if (!isListed(l, e, absolute)) { out.set(e.id, { kind: 'none', why: 'unlisted' }); return; }
    const theirs = (absolute ? l.byNumber.get(e.abs!) ?? [] : [l.bySeason.get(`${e.s}|${e.e}`) ?? '']).filter(Boolean);
    if (!titles[i] || !theirs.length || theirs.some((t) => alike(t, titles[i]) >= SAME)) { out.set(e.id, { kind: 'number' }); return; }
    out.set(e.id, { kind: 'none', why: 'different', got: theirs[0] });
  });
  return out;
}

/** The title in a downloaded file's name ("Show-S01E02-Cabbagezilla Name Game.mp4"), normalised; '' when it has none. */
export function fileTitle(name: string): string {
  const m = /-S\d+E\d+-(.*)\.[a-z0-9]{2,4}$/i.exec(name);
  return m ? normaliseTitle(m[1].replace(/\b(english|dubbed|subbed)\b/gi, ' ')) : '';
}
/** After a download by number: is the file's own title the episode's? Unknown counts as yes. */
export function fileIsEpisode(name: string, episodeTitle: string): boolean {
  const got = fileTitle(name), want = realTitle(episodeTitle);
  return !got || !want || alike(got, want) >= SAME;
}

/**
 * How much of a show's work the site can supply under each way of numbering (13 Nov 2026).
 * season / absolute: episodes that need work with a source, under that numbering. byTitle: of those (in the show's
 * own mode), how many are found by title. different: listed under the number but a different episode.
 */
export interface NumberingFit {
  work: number; season: number; absolute: number; byTitle: number; unlisted: number; different: number;
  /** True when every link on the site is season-less, so "episode-N" can only mean one episode. */
  flat: boolean;
  /** For the note on the screen: "68 episodes, numbered 1 to 68" or "seasons 1 to 4". */
  wco: string;
}
export function numberingFit(l: WcoListing, all: EpisodeLike[], workIds: Set<number>, absolute: boolean): NumberingFit {
  const count = (m: Map<number, Source>, test: (s: Source) => boolean) => [...workIds].filter((id) => { const s = m.get(id); return !!s && test(s); }).length;
  const bySeason = resolveSources(l, all, false), byAbs = resolveSources(l, all, true);
  const mine = absolute ? byAbs : bySeason;
  const flat = l.seasons.size === 1 && l.seasons.has(1);
  const seasons = [...l.seasons.keys()].sort((a, b) => a - b);
  const nums = [...l.absolute].sort((a, b) => a - b);
  return {
    work: workIds.size, season: count(bySeason, (s) => s.kind !== 'none'), absolute: count(byAbs, (s) => s.kind !== 'none'),
    byTitle: count(mine, (s) => s.kind === 'title'),
    unlisted: count(mine, (s) => s.kind === 'none' && s.why === 'unlisted'), different: count(mine, (s) => s.kind === 'none' && s.why === 'different'),
    flat,
    wco: !l.count ? 'no episodes' : flat ? `${l.count} episodes, numbered ${nums[0]} to ${nums[nums.length - 1]}`
      : `${l.count} episodes in season${seasons.length === 1 ? '' : 's'} ${seasons.join(', ')}`,
  };
}
