// Dub calendar (12 Nov 2026): fetches AnimeSchedule.net's English dub timetable and matches it to Sonarr.
// The token is read from <config>/animeschedule.token (saved from the settings dialog); it is never logged or sent
// back to the browser. Terms: personal use, a visible credit link on the screen.
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { promises as fs } from 'fs';
import * as path from 'path';
import { APP_CONFIG } from './app-config.provider';
import { AppConfig } from './config';
import { FillService } from './fill.service';
import { CalendarRow, DubEntry, isoWeek, matchSeries, parseTimetable, project } from './dub-calendar.util';

const API = 'https://animeschedule.net/api/v3';
/** This week and the five after it: what AnimeSchedule lists. Later episodes are our estimates. */
const WEEKS = 6;
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

interface Cache { fetchedAt: string; entries: DubEntry[]; errors: string[] }

@Injectable()
export class DubCalendarService {
  private readonly logger = new Logger(DubCalendarService.name);
  private cache?: Cache;
  private fetching?: Promise<Cache>;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig, private readonly fill: FillService) {}

  private get tokenFile() { return path.join(this.config.configDir, 'animeschedule.token'); }
  private get cacheFile() { return path.join(this.config.configDir, 'dub-calendar.json'); }

  private async token(): Promise<string | undefined> {
    try { return (await fs.readFile(this.tokenFile, 'utf8')).trim() || undefined; } catch { return undefined; }
  }

  async hasToken() { return !!(await this.token()); }

  /** Save a token typed into the settings screen. It is written to the settings folder and never sent back. */
  async setToken(value: unknown) {
    const t = String(value ?? '').trim();
    if (!/^[\x21-\x7e]{10,400}$/.test(t)) throw new BadRequestException('That does not look like a token: 10 to 400 characters, no spaces');
    await fs.mkdir(this.config.configDir, { recursive: true });
    const tmp = this.tokenFile + '.tmp';
    await fs.writeFile(tmp, t, { mode: 0o600 });
    await fs.rename(tmp, this.tokenFile);
    this.cache = undefined;       // the next load of the calendar fetches with the new token
    await fs.rm(this.cacheFile, { force: true });
  }

  private async fetchAll(token: string): Promise<Cache> {
    const entries: DubEntry[] = [], errors: string[] = [];
    for (let i = 0; i < WEEKS; i++) {
      const { year, week } = isoWeek(new Date(Date.now() + i * 7 * 86400000));
      try {
        const r = await axios.get(`${API}/timetables/dub`, { params: { year, week, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }, timeout: 30000,
          headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'wco-dl dub calendar (personal use)' } });
        entries.push(...parseTimetable(r.data));
      } catch (e: any) {
        const status = e?.response?.status;
        if (status === 404 && i > 0) continue;       // a later week AnimeSchedule has not published yet is not an error
        errors.push(`week ${week} of ${year}: ${status ? `AnimeSchedule answered ${status}` : 'no answer'}`);
        if (status === 401 || status === 403) break;     // a bad token fails every week the same way
      }
    }
    const cache: Cache = { fetchedAt: new Date().toISOString(), entries, errors };
    if (entries.length) await fs.writeFile(this.cacheFile, JSON.stringify(cache)).catch(() => undefined);
    this.logger.log(`Dub timetable: ${entries.length} episodes over ${WEEKS} weeks${errors.length ? `, ${errors.length} weeks failed` : ''}`);
    return cache;
  }

  private async load(force: boolean): Promise<Cache | { needsToken: true }> {
    if (!this.cache) {
      try { this.cache = JSON.parse(await fs.readFile(this.cacheFile, 'utf8')); } catch { /* no cache yet */ }
    }
    const fresh = this.cache && Date.now() - new Date(this.cache.fetchedAt).getTime() < MAX_AGE_MS;
    if (fresh && !force) return this.cache!;
    const token = await this.token();
    if (!token) return this.cache ?? { needsToken: true };
    this.fetching ??= this.fetchAll(token).finally(() => { this.fetching = undefined; });
    const got = await this.fetching;
    // A failed refresh keeps yesterday's dates and reports why, instead of showing an empty calendar.
    this.cache = got.entries.length || !this.cache ? got : { ...this.cache, errors: got.errors };
    return this.cache;
  }

  /** The calendar: listed and estimated dub episodes from today on, each with its Sonarr series when one matches. */
  async calendar(force = false) {
    const data = await this.load(force);
    if ('needsToken' in data) return { needsToken: true as const, rows: [] as CalendarRow[] };
    const series = await this.fill.allSeries();
    const matched = matchSeries(data.entries, series);
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const rows: CalendarRow[] = project(data.entries).filter((e) => new Date(e.date) >= from).map((e) => {
      const m = matched.get(e.route);
      return { ...e, seriesId: m?.id, seriesTitle: m?.title, match: m?.match ?? 'none' };
    });
    return { needsToken: false as const, fetchedAt: data.fetchedAt, errors: data.errors, hasToken: !!(await this.token()), rows };
  }

  /** The next dub episodes of one Sonarr series, for the note on its episode map. */
  async forSeries(seriesId: number) {
    const c = await this.calendar().catch(() => ({ rows: [] as CalendarRow[] }));
    return c.rows.filter((r) => r.seriesId === seriesId).slice(0, 3);
  }
}
