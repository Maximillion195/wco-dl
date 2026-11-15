// What wcostream lists for a show, fetched through Byparr by the existing AppService and remembered for six hours.
// One fetch at a time: Byparr is slow and the downloader shares it.
import { Inject, Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { APP_CONFIG } from './app-config.provider';
import { AppConfig } from './config';
import { AppService } from './app.service';
import { buildListing, parseEpisodeLinks, WcoListing } from './wco-episodes.util';

const TTL_MS = 6 * 60 * 60 * 1000;
const SHOW = 'https://www.wcostream.tv/anime/';

@Injectable()
export class WcoEpisodesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WcoEpisodesService.name);
  private cache = new Map<string, { at: number; listing: WcoListing }>();
  private queue: Promise<unknown> = Promise.resolve();
  /** Set once any page has parsed with episodes in it: only then is an empty page believed (else the layout may have changed). */
  private parserWorks = false;

  constructor(private readonly app: AppService, @Optional() @Inject(APP_CONFIG) private readonly config?: AppConfig) {}

  // The lists are kept on disk too (13 Nov 2026): a restart used to throw away fifteen minutes of reading.
  private get file() { return this.config ? path.join(this.config.configDir, 'wco-listings.json') : undefined; }
  async onApplicationBootstrap() {
    if (!this.file) return;
    try {
      const saved: Record<string, { at: number; links: string[] }> = JSON.parse(await fs.readFile(this.file, 'utf8'));
      for (const [key, v] of Object.entries(saved)) {
        if (Date.now() - v.at < TTL_MS && Array.isArray(v.links)) this.cache.set(key, { at: v.at, listing: buildListing(v.links) });
        if (v.links?.length) this.parserWorks = true;
      }
    } catch { /* no saved lists */ }
  }
  private saveTimer?: NodeJS.Timeout;
  private saveSoon() {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = undefined;
      const out: Record<string, { at: number; links: string[] }> = {};
      for (const [key, v] of this.cache) if (Date.now() - v.at < TTL_MS) out[key] = { at: v.at, links: v.listing.links };
      try { const tmp = this.file + '.tmp'; await fs.writeFile(tmp, JSON.stringify(out)); await fs.rename(tmp, this.file!); } catch { /* next time */ }
    }, 5000);
    this.saveTimer.unref?.();
  }

  /** The cached listing, or undefined when it has not been read (or could not be). */
  peek(slug: string, language: string): WcoListing | undefined {
    const hit = this.cache.get(`${slug}|${language}`);
    return hit && Date.now() - hit.at < TTL_MS ? hit.listing : undefined;
  }

  /**
   * The show's listing, or undefined when unknown (the fetch failed, or the page gave nothing while the parser has
   * never found an episode anywhere). Unknown never blocks a download.
   */
  listing(slug: string, language: string): Promise<WcoListing | undefined> {
    const key = `${slug}|${language}`;
    const hit = this.peek(slug, language);
    if (hit) return Promise.resolve(hit.count === 0 && !this.parserWorks ? undefined : hit);
    const run = this.queue.then(async () => {
      const again = this.peek(slug, language);
      if (again) return again;
      const url = `${SHOW}${slug}?lang=${language}`;
      try {
        const html = await this.app.fetchPageHtml(url);
        const listing = buildListing(parseEpisodeLinks(html, url, language));
        if (listing.count > 0) this.parserWorks = true;
        this.cache.set(key, { at: Date.now(), listing });
        this.saveSoon();
        return listing.count === 0 && !this.parserWorks ? undefined : listing;
      } catch (e) {
        this.logger.warn(`Could not read wcostream's episode list for ${slug}: ${(e as Error).message}`);
        return undefined;
      }
    });
    this.queue = run.catch(() => undefined);
    return run as Promise<WcoListing | undefined>;
  }
}
