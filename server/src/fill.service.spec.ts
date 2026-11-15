import axios from 'axios';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AppConfig } from './config';
import { FillService } from './fill.service';

/**
 * End-to-end tests of the fill worker with a fake Sonarr (axios mocked) and a fake downloader (a node script
 * that writes the file name given in FAKE_FILE, or prints a premium-only line). They pin the rules from
 * 11 Nov 2026: import only the episode asked for, never a sub as a dub swap, premium goes to Sonarr.
 */
// These tests start a real child process and wait on it; on a busy machine 5 seconds is not enough.
jest.setTimeout(30000);

describe('FillService worker', () => {
  let dir: string;
  let calls: { method: string; url: string; data?: any }[];
  let hasFile: Record<number, boolean>;
  let fakeOut: { file?: string; premium?: boolean };

  const episodes = [
    { id: 101, seasonNumber: 2, episodeNumber: 14, absoluteEpisodeNumber: 39, title: 'Straight Bet', airDate: '2021-01-13', airDateUtc: '2021-01-13T15:00:00Z' },
    { id: 102, seasonNumber: 2, episodeNumber: 15, absoluteEpisodeNumber: 40, title: 'Otto Suwen', airDate: '2021-01-20', airDateUtc: '2021-01-20T15:00:00Z', episodeFileId: 9 },
    { id: 103, seasonNumber: 2, episodeNumber: 16, absoluteEpisodeNumber: 41, title: 'Bonds of Lust', airDate: '2021-01-27', airDateUtc: '2021-01-27T15:00:00Z', episodeFileId: 10 },
  ];

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fill-'));
    calls = [];
    hasFile = { 101: false, 102: true, 103: true };
    fakeOut = {};
    const script = path.join(dir, 'fake.js');
    await fs.writeFile(script, `
      const fs = require('fs'), path = require('path');
      const o = process.argv[process.argv.indexOf('-o') + 1];
      const want = JSON.parse(process.env.FAKE || '{}');
      if (want.args) fs.writeFileSync(want.args, JSON.stringify(process.argv.slice(2)));
      if (want.skip) { console.log('[wco-dl] - x skipped, already downloaded.'); process.exit(0); }
      if (want.busy) { console.log('[wco-dl] - Could not find a video for x: Embed player returned HTTP 503: Servers Busy'); process.exit(0); }
      if (want.premium) { console.log('[wco-dl] - Skipping https://www.wcostream.tv/x-episode-14-english-dubbed, it is only available to WCO Premium users.'); process.exit(0); }
      console.log('Downloading:  50%|#####'); fs.writeFileSync(path.join(o, want.file), 'x'); console.log('Downloading: 100%|##########');
    `);
    jest.spyOn(axios, 'request').mockImplementation(async (req: any) => {
      const url = String(req.url).replace(/^.*\/api\/v3\//, '');
      calls.push({ method: req.method, url, data: req.data });
      if (url.startsWith('episode?seriesId')) return { data: episodes.map((e) => ({ ...e, hasFile: hasFile[e.id] })) };
      if (url.startsWith('episodefile?')) return { data: [
        { id: 9, relativePath: 'x - 2x15.mkv', mediaInfo: { audioLanguages: 'jpn' }, quality: { quality: { name: 'HDTV-1080p' } } },
        { id: 10, relativePath: 'x - 2x16.mkv', mediaInfo: { audioLanguages: 'jpn/eng' }, quality: { quality: { name: 'HDTV-1080p' } } }] };
      if (url.startsWith('series/')) return { data: { id: 575, title: 'Re: ZERO' } };
      if (url.startsWith('manualimport?')) {
        const folder = decodeURIComponent(url.match(/folder=([^&]+)/)![1]);
        const files = (await fs.readdir(folder)).filter((f) => f.endsWith('.mp4'));
        return { data: files.map((f) => ({ path: path.join(folder, f), quality: { quality: { name: 'WEBDL-1080p' } } })) };
      }
      if (url === 'command' && req.data?.name === 'ManualImport') { hasFile[req.data.files[0].episodeIds[0]] = true; return { data: { id: 1 } }; }
      if (url === 'command') return { data: { id: 2 } };
      if (url.startsWith('command/')) return { data: { status: 'completed' } };
      if (url.startsWith('episode/')) { const id = Number(url.split('/')[1]); return { data: { hasFile: !!hasFile[id] } }; }
      return { data: {} };
    });
    const config = {
      sonarrUrl: 'http://sonarr', sonarrApiKey: 'k', outputBase: path.join(dir, 'out'), sonarrImportBase: undefined,
      configDir: path.join(dir, 'config'), pythonBin: process.execPath, pythonScript: script, downloadIdleTimeoutMs: 20000,
    } as unknown as AppConfig;
    service = new FillService(config);
    process.env.FAKE = '{}';
  });
  // The service may still be writing when a test ends, and Windows refuses to delete until it stops: retry.
  afterEach(async () => { jest.restoreAllMocks(); await fs.rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });
  let service: FillService;

  async function run(episodeIds: number[], fake: object) {
    process.env.FAKE = JSON.stringify(fake);
    const job = await service.createJob({ seriesId: 575, slug: 're-zero', language: 'dub', episodeIds });
    for (let i = 0; i < 250 && job.episodes.some((e) => ['queued', 'downloading', 'importing'].includes(e.state)); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return job;
  }

  it('downloads a missing episode and imports it into that episode only', async () => {
    const job = await run([101], { file: 'Re Zero-S02E14-English Dubbed.mp4' });
    expect(job.episodes[0]).toMatchObject({ state: 'done', mode: 'missing' });
    const imp = calls.find((c) => c.data?.name === 'ManualImport');
    expect(imp!.data.files[0].episodeIds).toEqual([101]);
    expect(calls.find((c) => c.url.startsWith('manualimport?'))!.url).not.toMatch(/seriesId/);
  });

  it('keeps a file that is a different episode', async () => {
    const job = await run([101], { file: 'Re Zero-S02E15-English Dubbed.mp4' });
    expect(job.episodes[0].state).toBe('kept');
    expect(calls.some((c) => c.data?.name === 'ManualImport')).toBe(false);
  });

  it('hands a premium-only episode to Sonarr', async () => {
    const job = await run([101], { premium: true });
    expect(job.episodes[0].state).toBe('premium');
    expect(calls.find((c) => c.url === 'episode/monitor')!.data).toEqual({ episodeIds: [101], monitored: true });
    expect(calls.find((c) => c.data?.name === 'EpisodeSearch')!.data.episodeIds).toEqual([101]);
  });

  it('never swaps in a file that is not a dub', async () => {
    const job = await run([102], { file: 'Re Zero-S02E15-English Subbed.mp4' });
    expect(job.episodes[0]).toMatchObject({ mode: 'swap', state: 'kept' });
    expect(calls.some((c) => c.data?.name === 'ManualImport')).toBe(false);
  });

  it('swaps in a dub and refuses episodes that need no work', async () => {
    const job = await run([102], { file: 'Re Zero-S02E15-English Dubbed.mp4' });
    expect(job.episodes[0]).toMatchObject({ mode: 'swap', state: 'done' });
    await expect(service.createJob({ seriesId: 575, slug: 're-zero', episodeIds: [103] })).rejects.toThrow(/needs work/);
  });

  // 13 Nov 2026: Sonarr's history showed files filed under the wrong episode where the site packs two segments
  // into one numbered episode. These pin the cure: the title picks the link, one file can fill two episodes, and
  // a file whose own title is another episode is never imported.
  describe('which link is which episode', () => {
    const W = 'https://www.wcostream.tv/';
    const was = [...episodes];
    const paw = [
      { id: 201, seasonNumber: 1, episodeNumber: 1, title: 'Pups Make a Splash', airDate: '2013-08-12', airDateUtc: '2013-08-12T15:00:00Z', episodeFileId: 10 },
      { id: 202, seasonNumber: 1, episodeNumber: 2, title: 'Pups Fall Festival', airDate: '2013-08-12', airDateUtc: '2013-08-12T15:00:00Z' },
      { id: 203, seasonNumber: 1, episodeNumber: 3, title: 'Pups Save the Sea Turtles', airDate: '2013-08-13', airDateUtc: '2013-08-13T15:00:00Z' },
      { id: 204, seasonNumber: 1, episodeNumber: 4, title: 'Pup and the Very Big Baby', airDate: '2013-08-13', airDateUtc: '2013-08-13T15:00:00Z' },
      { id: 205, seasonNumber: 1, episodeNumber: 5, title: 'Pups and the Kitty-tastrophe', airDate: '2013-08-14', airDateUtc: '2013-08-14T15:00:00Z' },
    ];
    const links = [W + 'paw-episode-1-pups-make-a-splash-pups-fall-festival', W + 'paw-episode-2-pups-save-the-sea-turtles-pup-and-the-very-big-baby',
      W + 'paw-episode-5-video-storybook-pup-pup-and-away'];
    let argsFile: string;
    const stub = (listing: unknown) => { (service as any).wco = { listing: jest.fn().mockResolvedValue(listing), peek: () => undefined }; };
    beforeEach(() => {
      episodes.splice(0, episodes.length, ...(paw as any[]));
      hasFile = { 201: true, 202: false, 203: false, 204: false, 205: false };
      argsFile = path.join(dir, 'args.json');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      stub(require('./wco-episodes.util').buildListing(links));
    });
    afterEach(() => { episodes.splice(0, episodes.length, ...was); });
    const sentArgs = async () => JSON.parse(await fs.readFile(argsFile, 'utf8').catch(() => 'null'));

    it('downloads the link that carries the title and files it under both of its episodes', async () => {
      const job = await run([203], { file: 'Paw-S01E02-Pups Save The Sea Turtles Pup And The Very Big Baby.mp4', args: argsFile });
      expect(job.episodes[0]).toMatchObject({ state: 'done' });
      expect(job.episodes[0].message).toMatch(/one file for 2 episodes/);
      const args = await sentArgs();
      expect(args).toContain(links[1]);                  // the episode link itself, not the show by number
      expect(args).not.toContain('-se');
      const file = calls.find((c) => c.data?.name === 'ManualImport')!.data.files[0];
      expect(file.episodeIds).toEqual([203, 204]);
      expect(file.releaseType).toBe('multiEpisode');
    });

    it('leaves alone an episode of the pair that already has a file', async () => {
      const job = await run([202], { file: 'Paw-S01E01-Pups Make A Splash Pups Fall Festival.mp4', args: argsFile });
      expect(job.episodes[0].state).toBe('done');
      const file = calls.find((c) => c.data?.name === 'ManualImport')!.data.files[0];
      expect(file.episodeIds).toEqual([202]);            // 201 keeps the file it has
      expect(file.releaseType).toBe('singleEpisode');
    });

    it('does not start a download when the number is a different episode and no link has the title', async () => {
      const job = await run([205], { file: 'never.mp4', args: argsFile });
      expect(job.episodes[0].state).toBe('failed');
      expect(job.episodes[0].message).toMatch(/is another episode/);
      expect(await sentArgs()).toBeNull();
    });

    it('with the site list unreadable, a file whose own title is another episode is kept and not imported', async () => {
      stub(undefined);
      const job = await run([202], { file: 'Paw-S01E02-Pups Save The Sea Turtles Pup And The Very Big Baby.mp4', args: argsFile });
      expect(job.episodes[0].state).toBe('kept');
      expect(job.episodes[0].message).toMatch(/different episode from "Pups Fall Festival"/);
      expect(calls.some((c) => c.data?.name === 'ManualImport')).toBe(false);
    });
  });

  it('waits and retries when wcostream says its servers are busy', async () => {
    process.env.FAKE = JSON.stringify({ busy: true });
    const job = await service.createJob({ seriesId: 575, slug: 're-zero', language: 'dub', episodeIds: [101] });
    for (let i = 0; i < 50 && !job.episodes[0].notBefore; i++) await new Promise((r) => setTimeout(r, 100));
    expect(job.episodes[0]).toMatchObject({ state: 'queued', busy: 1 });
    expect(job.episodes[0].message).toMatch(/busy; trying again in 5 minutes/);
  });

  it('refuses a second run for episodes already queued', async () => {
    process.env.FAKE = JSON.stringify({ file: 'Re Zero-S02E14-English Dubbed.mp4' });
    (service as any).running = true;   // hold the queue so the first run stays queued
    await service.createJob({ seriesId: 575, slug: 're-zero', language: 'dub', episodeIds: [101] });
    await expect(service.createJob({ seriesId: 575, slug: 're-zero', language: 'dub', episodeIds: [101] })).rejects.toThrow(/already in the queue/);
    (service as any).running = false;
  });

  it('does not download an episode that another run filled while it waited', async () => {
    process.env.FAKE = JSON.stringify({ file: 'Re Zero-S02E14-English Dubbed.mp4' });
    (service as any).running = true;   // hold the queue so the run stays queued
    const job = await service.createJob({ seriesId: 575, slug: 're-zero', language: 'dub', episodeIds: [101] });
    hasFile[101] = true;               // filled meanwhile
    (service as any).running = false;
    await (service as any).pump();
    expect(job.episodes[0]).toMatchObject({ state: 'done', message: 'Already in the library' });
    expect(calls.some((c) => c.data?.name === 'ManualImport')).toBe(false);
  });

  it('starts nothing while paused, and a run moved to the front goes first', async () => {
    process.env.FAKE = JSON.stringify({ file: 'Re Zero-S02E14-English Dubbed.mp4' });
    await service.setPaused(true);
    const first = await service.createJob({ seriesId: 575, slug: 're-zero', language: 'dub', episodeIds: [101] });
    const second = await service.createJob({ seriesId: 575, slug: 're-zero', language: 'dub', episodeIds: [102], auto: true });
    await new Promise((r) => setTimeout(r, 300));
    expect(first.episodes[0].state).toBe('queued');
    await service.runNext(second.id);
    expect(service.listJobs().map((j) => j.id)).toEqual([first.id, second.id]);   // listed newest first, so the head of the queue is last
    expect(second.auto).toBe(false);
    expect(service.queueState().paused).toBe(true);
    await service.setPaused(false);
    for (let i = 0; i < 100 && first.episodes[0].state !== 'done'; i++) await new Promise((r) => setTimeout(r, 100));
    expect(first.episodes[0].state).toBe('done');
  });

  it('lists what needs a person, until it is dismissed or retried', async () => {
    const job = await run([101], { file: 'Re Zero-S02E15-English Dubbed.mp4' });   // the wrong episode: kept
    expect(await service.attention()).toMatchObject([{ jobId: job.id, id: 101, state: 'kept', show: 'Re: ZERO' }]);
    await service.dismiss(job.id, 101);
    expect(await service.attention()).toEqual([]);
    process.env.FAKE = JSON.stringify({ file: 'Re Zero-S02E14-English Dubbed.mp4' });
    await service.retryEpisode(job.id, 101);
    for (let i = 0; i < 100 && job.episodes[0].state !== 'done'; i++) await new Promise((r) => setTimeout(r, 100));
    expect(job.episodes[0]).toMatchObject({ state: 'done', dismissed: undefined });
    expect(await service.attention()).toEqual([]);
  });

  it('gives a failed episode one more go when the queue runs dry, and only one', async () => {
    const job = await run([101], {});   // the fake downloader writes no file and crashes: failed
    expect(job.episodes[0]).toMatchObject({ state: 'failed', autoRetried: true });
    await (service as any).pump();
    expect(job.episodes[0].state).toBe('failed');
    expect(await service.attention()).toMatchObject([{ id: 101, state: 'failed' }]);
  });

  it('leaves unlisted episodes out of tonight\'s plan and counts them as a try', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { buildListing } = require('./wco-episodes.util');
    const wco = { listing: jest.fn().mockResolvedValue(buildListing(['https://www.wcostream.tv/catdog-episode-1-english-dubbed', 'https://www.wcostream.tv/catdog-episode-2-english-dubbed'])) };
    const svc = new FillService({ configDir: path.join(dir, 'config') } as unknown as AppConfig, wco as any);
    const pref: any = { seriesId: 1, title: 'CatDog', language: 'dub' };
    const tries: any = {};
    const map: any[] = [1, 2, 3, 23].map((e, i) => ({ id: 100 + i, s: 1, e, st: 'missing' }));
    const kept = await (svc as any).dropUnlisted('catdog', pref, map, [100, 101, 102, 103], tries, Date.now() + 60000);
    expect(kept).toEqual([100, 101]);
    expect(pref.unlisted.ids).toEqual([102, 103]);
    expect(tries[102].n).toBe(1);
    // an unreadable list drops nothing
    wco.listing.mockResolvedValue(undefined);
    expect(await (svc as any).dropUnlisted('catdog', { ...pref }, map, [100, 102], {}, Date.now() + 60000)).toEqual([100, 102]);
    // past the deadline nothing is read
    wco.listing.mockClear();
    expect(await (svc as any).dropUnlisted('catdog', { ...pref }, map, [100, 102], {}, Date.now() - 1)).toEqual([100, 102]);
    expect(wco.listing).not.toHaveBeenCalled();
  });

  it('a parked overnight run names the next night, not a time outside the window', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { brakeMessage } = require('./fill.service');
    expect(brakeMessage(5, new Date(2026, 10, 13, 7, 35), true)).toMatch(/the rest wait for the next overnight run$/);
    expect(brakeMessage(5, new Date(2026, 10, 13, 3, 5), true)).toMatch(/the rest wait until 03:05$/);
    expect(brakeMessage(5, new Date(2026, 10, 13, 17, 40), false)).toMatch(/the rest wait until 17:40$/);
  });

  it('checks settings and runs a window past midnight', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { cleanSettings, isNight, NIGHT } = require('./fill.service');
    expect(cleanSettings({ nightFrom: 23, nightTo: 6, nightBudget: 60, quality: '480' })).toEqual({ nightFrom: 23, nightTo: 6, nightBudget: 60, quality: '480' });
    expect(cleanSettings({ nightFrom: 3, nightTo: 3, nightBudget: 0, quality: '4k', dubToken: 'x' })).toEqual({});
    expect(cleanSettings({ nightFrom: 24, nightTo: 6, nightBudget: '50' })).toEqual({ nightBudget: 50 });
    const was = { ...NIGHT };
    try {
      NIGHT.from = 23; NIGHT.to = 6;
      expect(isNight(new Date(2026, 10, 12, 23, 30))).toBe(true);
      expect(isNight(new Date(2026, 10, 12, 5, 59))).toBe(true);
      expect(isNight(new Date(2026, 10, 12, 6, 0))).toBe(false);
      expect(isNight(new Date(2026, 10, 12, 12, 0))).toBe(false);
    } finally { NIGHT.from = was.from; NIGHT.to = was.to; }
  });

  it('names an episode wcostream does not list, and never shows a video token', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { failureReason, NOT_LISTED, VIDEO_REFUSED } = require('./fill.service');
    const gone = failureReason('Threads started\nError: list index out of range\nError: list index out of range\n[wco-dl] - 0 episode(s) downloaded, 0 premium-only skipped.');
    expect(gone).toBe('Not downloaded: wcostream does not list this episode under this season and number');
    expect(require('./fill.service').NOT_LISTED.test(gone)).toBe(true);   // so no second attempt is wasted on it
    const said = failureReason('[wco-dl] - No episode matches season 1 episode 23: wcostream lists 60 episode(s) for this show, numbered differently or without this one.\n[wco-dl] - 1 episode(s) failed to download.');
    expect(NOT_LISTED.test(said)).toBe(true);
    expect(said).toContain('season 1 episode 23: wcostream lists 60');
    const refused = failureReason('[wco-dl] - https://m01.wcostream.com/getvid?evid=' + 'aB3'.repeat(90) + ' returned HTTP 404 (text/html) instead of a video.');
    expect(refused).toBe("Not downloaded: wcostream's video server returned HTTP 404 (text/html) instead of a video.");
    expect(VIDEO_REFUSED.test(refused)).toBe(true);
  });

  it('names a refused video and matches the brake pattern', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { failureReason, VIDEO_REFUSED } = require('./fill.service');
    const text = '[wco-dl] - https://m01.wcostream.com/getvid?evid=abc returned HTTP 404 (text/html) instead of a video.\n' +
      '[wco-dl] - Download for Hercules-S02E01 did not complete, please create an issue on GitHub.\n[wco-dl] - 1 episode(s) failed to download.';
    expect(failureReason(text)).toMatch(/returned HTTP 404 \(text\/html\) instead of a video/);
    expect(VIDEO_REFUSED.test(failureReason(text))).toBe(true);
    expect(VIDEO_REFUSED.test('Not downloaded: Could not find a video for x: No video player iframe found')).toBe(false);
  });

  it('keeps an automatic run waiting outside the night window', async () => {
    jest.spyOn(require('./fill.service'), 'isNight');
    const job = await service.createJob({ seriesId: 575, slug: 're-zero', language: 'dub', episodeIds: [101], auto: true });
    await new Promise((r) => setTimeout(r, 300));
    const hour = new Date().getHours();
    expect(job.episodes[0].state).toBe(hour >= 1 && hour < 7 ? job.episodes[0].state : 'queued');
  });

  it('imports a complete file already in staging (the downloader skips it)', async () => {
    const staged = path.join(dir, 'out', 'wco-gaps', 're-zero-dub', 'S02E14');
    await fs.mkdir(staged, { recursive: true });
    await fs.writeFile(path.join(staged, 'Re Zero-S02E14-English Dubbed.mp4'), 'x');
    const job = await run([101], { skip: true });   // the downloader checks the size and skips it
    expect(job.episodes[0].state).toBe('done');
  });
});

describe('nightly schedule rules', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { retryDue, isNight } = require('./fill.service');
  const at = (s: string) => new Date(s);
  it('waits a day after airing, then backs off 3, 7 and 14 days, then gives up', () => {
    expect(retryDue('2026-11-10', undefined, at('2026-11-10T20:00:00Z'))).toBe('wait');
    expect(retryDue('2026-11-10', undefined, at('2026-11-11T13:00:00Z'))).toBe('due');
    expect(retryDue('2026-11-10', { n: 1, last: '2026-11-11T01:05:00Z' }, at('2026-11-13T01:05:00Z'))).toBe('wait');
    expect(retryDue('2026-11-10', { n: 1, last: '2026-11-11T01:05:00Z' }, at('2026-11-14T01:06:00Z'))).toBe('due');
    expect(retryDue('2026-11-10', { n: 4, last: '2026-11-30T01:05:00Z' }, at('2027-01-01T01:05:00Z'))).toBe('give-up');
  });
  it('treats 01:00 to 06:59 local time as night', () => {
    expect(isNight(new Date(2026, 10, 12, 1, 0))).toBe(true);
    expect(isNight(new Date(2026, 10, 12, 6, 59))).toBe(true);
    expect(isNight(new Date(2026, 10, 12, 7, 0))).toBe(false);
    expect(isNight(new Date(2026, 10, 11, 21, 30))).toBe(false);
  });
});

describe('FillService start-up', () => {
  it('requeues interrupted episodes and cancels duplicates', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fillboot-'));
    const ep = (id: number, state: string) => ({ id, s: 1, e: id, title: 't', mode: 'missing', state });
    const jobs = [
      { id: 'a', seriesId: 1, title: 'x', slug: 'x', quality: '1080', absolute: false, createdAt: '1', episodes: [ep(1, 'downloading'), ep(2, 'queued')] },
      { id: 'b', seriesId: 1, title: 'x', slug: 'x', quality: '1080', absolute: false, createdAt: '2', episodes: [ep(2, 'queued'), ep(3, 'queued'), ep(1, 'queued')] },
    ];
    await fs.mkdir(path.join(dir, 'config'), { recursive: true });
    await fs.writeFile(path.join(dir, 'config', 'fill-jobs.json'), JSON.stringify(jobs));
    const svc = new FillService({ configDir: path.join(dir, 'config') } as unknown as AppConfig);
    (svc as any).running = true;   // do not start the worker
    await svc.onApplicationBootstrap();
    const [b, a] = svc.listJobs();
    expect(a.episodes.map((e) => e.state)).toEqual(['queued', 'queued']);
    expect(a.episodes[0].message).toMatch(/Resumed/);
    expect(b.episodes.map((e) => e.state)).toEqual(['cancelled', 'queued', 'cancelled']);
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });
});

describe('FillService without Sonarr', () => {
  it('answers the map screens without crashing when SONARR_API_KEY is not set', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fillnosonarr-'));
    const unhandled: unknown[] = [];
    const onRejection = (r: unknown) => unhandled.push(r);
    process.on('unhandledRejection', onRejection);
    try {
      const svc = new FillService({ configDir: path.join(dir, 'config'), sonarrUrl: 'http://sonarr' } as unknown as AppConfig);
      await expect(svc.splitFolders()).resolves.toEqual(new Map());
      await expect(svc.followed()).resolves.toEqual([]);
      await new Promise((r) => setTimeout(r, 50));   // let any stray rejection surface
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  });
});

describe('failure messages', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { failureReason } = require('./fill.service');
  it("gives the downloader's own reason, not its summary", () => {
    const out = '[wco-dl] - Waiting 11s for the embed ad gate...\n[wco-dl] - Could not find a video for https://www.wcostream.tv/x-episode-10: Embed player returned HTTP 503: Servers Busy\n[wco-dl] - 0 episode(s) downloaded, 0 premium-only skipped.\n[wco-dl] - 1 episode(s) failed to download.';
    expect(failureReason(out)).toBe('Not downloaded: Could not find a video for x-episode-10: Embed player returned HTTP 503: Servers Busy');
  });
});

describe('show links and follows', () => {
  let dir: string;
  let prefsFile: string;
  let gate: Promise<void> | undefined;
  let planAsked: () => void;
  const config = () => ({ sonarrUrl: 'http://sonarr', sonarrApiKey: 'k', configDir: dir, outputBase: path.join(dir, 'out') } as unknown as AppConfig);
  const saved = async () => JSON.parse(await fs.readFile(prefsFile, 'utf8'));

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'prefs-'));
    prefsFile = path.join(dir, 'show-prefs.json');
    gate = undefined;
    planAsked = () => undefined;
    jest.spyOn(axios, 'request').mockImplementation(async (req: any) => {
      const url = String(req.url).replace(/^.*\/api\/v3\//, '');
      if (url.startsWith('episode?seriesId')) { planAsked(); await gate; return { data: [] }; }
      if (url.startsWith('series/')) return { data: { id: Number(url.split('/')[1]), title: 'Show ' + url.split('/')[1] } };
      return { data: [] };
    });
  });
  afterEach(async () => { jest.restoreAllMocks(); await fs.rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });

  it('keeps a follow made while the nightly plan is running', async () => {
    const svc = new FillService(config());
    await svc.setFollow({ slug: 'first-show', seriesId: 1, follow: true });
    let release!: () => void;
    gate = new Promise<void>((ok) => { release = ok; });
    const asked = new Promise<void>((ok) => { planAsked = ok; });
    const plan = svc.nightlyPlan();
    await asked;                          // the plan has read the list and is waiting for Sonarr
    await svc.setFollow({ slug: 'second-show', seriesId: 2, follow: true });
    release();
    await plan;
    const now = await saved();
    expect(now['second-show']?.follow).toBe(true);
    expect(now['first-show'].counts).toEqual(expect.objectContaining({ missing: 0, undub: 0 }));   // the plan's own work is kept too
  });

  it('runs one plan at a time: a second call joins the first', async () => {
    const svc = new FillService(config());
    await svc.setFollow({ slug: 'first-show', seriesId: 1, follow: true });
    const calls = () => (axios.request as jest.Mock).mock.calls.filter(([r]) => String(r.url).includes('episode?seriesId')).length;
    const before = calls();
    await Promise.all([svc.nightlyPlan(), svc.nightlyPlan()]);
    expect(calls() - before).toBe(1);
  });

  it('does not take a list cut short by a restart for "no shows"', async () => {
    const svc = new FillService(config());
    await svc.setFollow({ slug: 'first-show', seriesId: 1, follow: true });
    await svc.setFollow({ slug: 'second-show', seriesId: 2, follow: true });   // the copy from before now holds first-show
    await fs.writeFile(prefsFile, '{"first-show": {"seriesId"');
    expect((await svc.followed()).map((f) => f.slug)).toEqual(['first-show']);
    // With no copy to fall back on, the screens say so and nothing is written over the file.
    await fs.rm(prefsFile + '.bak');
    await fs.writeFile(prefsFile, '{"first-show": {"seriesId"');
    await expect(svc.followed()).rejects.toThrow(/cannot be read/);
    await expect(svc.setFollow({ slug: 'third-show', seriesId: 3, follow: true })).rejects.toThrow(/Nothing was changed/);
    expect(await fs.readFile(prefsFile, 'utf8')).toBe('{"first-show": {"seriesId"');
  });
});
