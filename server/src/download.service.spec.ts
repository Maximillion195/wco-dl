import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import * as path from 'path';
import { loadConfig } from './config';
import {
  DownloadJob,
  DownloadService,
  normalizeSlug,
} from './download.service';

const fakeScript = path.resolve(__dirname, '../test/fixtures/fake-wco-dl.js');

function createService(overrides = {}) {
  return new DownloadService({
    ...loadConfig({}),
    outputBase: '/tmp/wco-test-output',
    pythonBin: process.execPath,
    pythonScript: fakeScript,
    ...overrides,
  });
}

async function waitForFinish(service: DownloadService, job: DownloadJob) {
  for (let i = 0; i < 100; i++) {
    const current = service.getJob(job.id);
    if (current.status !== 'running' && current.postProcess) return current;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Job did not finish');
}

describe('normalizeSlug', () => {
  it.each([
    ['naruto', 'naruto'],
    ['https://www.wcostream.tv/anime/naruto', 'naruto'],
    ['https://wcostream.tv/anime/naruto/', 'naruto'],
    ['/anime/naruto?season=all&lang=dub', 'naruto'],
    ['magical%e2%98%85explorer', 'magical%e2%98%85explorer'],
    ['_summer', '_summer'],
  ])('accepts %s', (input, expected) => {
    expect(normalizeSlug(input, true)).toBe(expected);
  });

  it.each([
    '',
    undefined,
    '../../etc',
    'foo/bar',
    'foo bar',
    'a;rm -rf /',
    '$(id)',
  ])('rejects %p', (input) => {
    expect(() => normalizeSlug(input, true)).toThrow(BadRequestException);
  });

  it('keeps anime/ for single episodes so show URLs are rejected', () => {
    expect(() => normalizeSlug('anime/naruto', false)).toThrow(
      BadRequestException,
    );
  });
});

describe('DownloadService', () => {
  it('builds the show download arguments and tracks the job', async () => {
    const service = createService();
    const job = await service.startShowDownload({
      name: 'naruto',
      season: '2',
      episode: '1-5',
      newest: true,
    });

    expect(job.status).toBe('running');
    const finished = await waitForFinish(service, job);
    expect(finished.status).toBe('completed');
    expect(JSON.parse(finished.log[0])).toEqual([
      '-i',
      'https://www.wcostream.tv/anime/naruto',
      '-se',
      '2',
      '-epr',
      '1-5',
      '-hd',
      '-n',
      '-o',
      '/tmp/wco-test-output/naruto/',
      '-t',
      '2',
    ]);
    expect(finished.postProcess.sonarr.status).toBe('skipped');
    expect(service.listJobs()[0].id).toBe(job.id);
  });

  it('downloads single episodes into the show folder', async () => {
    const service = createService();
    const job = await service.startEpisodeDownload(
      'https://www.wcostream.tv/some-show-episode-2-english-dubbed',
    );

    expect(job.url).toBe(
      'https://www.wcostream.tv/some-show-episode-2-english-dubbed',
    );
    expect(job.outputFolder).toBe('/tmp/wco-test-output/some-show/');
    expect((await waitForFinish(service, job)).status).toBe('completed');
  });

  it('marks the job failed with the error when the downloader fails', async () => {
    const service = createService();
    const job = await service.startShowDownload({ name: 'fail-me' } as never);
    const finished = await waitForFinish(service, job);

    expect(finished.status).toBe('failed');
    expect(finished.exitCode).toBe(2);
    expect(finished.error).toBe('Process exited with code 2');
    expect(finished.log).toContain('Simulated download failure');
  });

  it('rejects invalid season and episode values', async () => {
    const service = createService();
    await expect(
      service.startShowDownload({ name: 'naruto', season: '1; ls' } as never),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.startShowDownload({ name: 'naruto', episode: '1-' } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('reports a spawn failure instead of silently doing nothing', async () => {
    const service = createService({ pythonBin: 'no-such-python-binary' });
    await expect(
      service.startShowDownload({ name: 'naruto' } as never),
    ).rejects.toThrow(InternalServerErrorException);
    expect(service.listJobs()).toEqual([]);
  });

  it('skips Sonarr when no API key is configured', async () => {
    const service = createService({ isProd: true, sonarrApiKey: undefined });
    const result = await service.postProcess('/tmp/wco-test-output/naruto/');
    expect(result.sonarr).toEqual({
      status: 'skipped',
      message: 'SONARR_API_KEY not set',
    });
    expect(result.permissions).toEqual({
      status: 'skipped',
      message: 'PUID/PGID not set',
    });
  });
});
