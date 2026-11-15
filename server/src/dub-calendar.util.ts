// Dub calendar (12 Nov 2026): English dub air dates from AnimeSchedule.net's timetable, matched to Sonarr series.
// Pure helpers, tested in dub-calendar.spec.ts. The fetching and the cache are in dub-calendar.service.ts.
import { normaliseTitle } from './fill.util';

/** One dub episode on AnimeSchedule's timetable. */
export interface DubEntry {
  route: string;
  title: string;
  /** Every name the timetable gives the show (title, English, romaji). */
  names: string[];
  /** ISO date and time the dub episode airs. */
  date: string;
  episode: number;
  /** Episodes in the season; 0 when AnimeSchedule does not know. */
  total: number;
  /** Set when the episode is delayed: the date it is delayed until, when known. */
  delayedUntil?: string;
  delayedText?: string;
}

export interface CalendarRow extends DubEntry {
  /** True when the date is ours (one a week after the last listed episode), not AnimeSchedule's. */
  estimate: boolean;
  seriesId?: number;
  seriesTitle?: string;
  /** "exact": same name. "loose": same name once "Season 2", "Part 2" and the like are dropped. */
  match: 'exact' | 'loose' | 'none';
  slug?: string;
}

/** The ISO week (Monday first) a date falls in, which is what the timetable's week and year parameters take. */
export function isoWeek(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);            // the Thursday of this week decides the year
  const start = Date.UTC(t.getUTCFullYear(), 0, 1);
  return { year: t.getUTCFullYear(), week: Math.ceil(((t.getTime() - start) / 86400000 + 1) / 7) };
}

/** A real date, or undefined: the API sends year 1 for "none". */
function realDate(v: unknown): string | undefined {
  const d = new Date(String(v ?? ''));
  return Number.isFinite(d.getTime()) && d.getUTCFullYear() > 2000 ? d.toISOString() : undefined;
}

/** The dub entries of a timetable answer. Anything without a route, a date or an episode number is dropped. */
export function parseTimetable(raw: unknown): DubEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: DubEntry[] = [];
  for (const r of raw as any[]) {
    const date = realDate(r?.episodeDate);
    const episode = Number(r?.episodeNumber);
    if (!r?.route || !date || !Number.isFinite(episode) || episode <= 0) continue;
    if (r.airType && String(r.airType).toLowerCase() !== 'dub') continue;
    const names = [...new Set([r.title, r.english, r.romaji].filter((n) => typeof n === 'string' && n.trim()))] as string[];
    // A delay that ended before this episode airs is history (12 Nov 2026: "delayed until 1 Oct" on a 12 Nov episode).
    const until = realDate(r.delayedUntil);
    const live = !!until && until > date;
    out.push({ route: String(r.route), title: String(r.english || r.title || r.route), names, date, episode,
      total: Number(r.episodes) > 0 ? Number(r.episodes) : 0,
      delayedUntil: live ? until : undefined, delayedText: live && r.delayedText ? String(r.delayedText) : undefined });
  }
  return out;
}

/** A name without its season marker: "Re:ZERO Season 3", "Spy x Family Part 2", "Bleach 2nd Season" lose the tail. */
export function looseKey(name: string): string {
  return normaliseTitle(String(name ?? '')
    .replace(/\b(the\s+)?(final|\d+(st|nd|rd|th)|first|second|third|fourth|fifth)\s+season\b/gi, ' ')
    .replace(/\b(season|part|cour)\s+(\d+|[ivx]+|one|two|three|four|five)\b/gi, ' ')
    .replace(/\bseason\b/gi, ' '));
}

export interface SeriesNames { id: number; title: string; alternateTitles?: { title?: string }[] }

/**
 * Which Sonarr series a timetable show is. An exact name wins; a season-stripped name is "loose"; two series that
 * share a name are left unmatched, because a wrong date on the wrong show is worse than none.
 */
export function matchSeries(entries: DubEntry[], series: SeriesNames[]): Map<string, { id: number; title: string; match: 'exact' | 'loose' }> {
  const exact = new Map<string, Set<number>>(), loose = new Map<string, Set<number>>();
  const put = (m: Map<string, Set<number>>, k: string, id: number) => { if (k) (m.get(k) ?? m.set(k, new Set()).get(k)!).add(id); };
  const byId = new Map(series.map((s) => [s.id, s]));
  for (const s of series) for (const n of [s.title, ...(s.alternateTitles ?? []).map((a) => a?.title ?? '')]) {
    put(exact, normaliseTitle(n), s.id); put(loose, looseKey(n), s.id);
  }
  const one = (m: Map<string, Set<number>>, keys: string[]) => {
    const ids = new Set<number>();
    for (const k of keys) for (const id of m.get(k) ?? []) ids.add(id);
    return ids.size === 1 ? [...ids][0] : undefined;
  };
  const out = new Map<string, { id: number; title: string; match: 'exact' | 'loose' }>();
  for (const e of entries) {
    if (out.has(e.route)) continue;
    const a = one(exact, e.names.map(normaliseTitle).filter(Boolean));
    const b = a ?? one(loose, e.names.map(looseKey).filter(Boolean));
    const id = a ?? b;
    if (id !== undefined) out.set(e.route, { id, title: byId.get(id)!.title, match: a !== undefined ? 'exact' : 'loose' });
  }
  return out;
}

/**
 * The listed episodes plus our estimates: for each show, one episode a week after its last listed one, up to the
 * season's length. No estimate when the length is unknown, when the last listed episode is delayed, or past the horizon.
 */
export function project(entries: DubEntry[], now = new Date(), horizonWeeks = 26): (DubEntry & { estimate: boolean })[] {
  const seen = new Set<string>();
  const listed = entries.filter((e) => { const k = `${e.route}:${e.episode}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const out: (DubEntry & { estimate: boolean })[] = listed.map((e) => ({ ...e, estimate: false }));
  const last = new Map<string, DubEntry>();
  for (const e of listed) if (!last.has(e.route) || last.get(e.route)!.episode < e.episode) last.set(e.route, e);
  const horizon = now.getTime() + horizonWeeks * 7 * 86400000;
  for (const e of last.values()) {
    if (!e.total || e.delayedUntil || e.delayedText) continue;
    for (let n = e.episode + 1, t = new Date(e.date).getTime() + 7 * 86400000; n <= e.total && t <= horizon; n++, t += 7 * 86400000) {
      out.push({ ...e, episode: n, date: new Date(t).toISOString(), estimate: true });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}
