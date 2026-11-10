import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
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

  it('requests subbed episodes with ?lang=sub', async () => {
    const service = createService();
    const job = await service.startShowDownload({
      name: 'bleach',
      language: 'sub',
    } as never);

    expect(job.url).toBe('https://www.wcostream.tv/anime/bleach?lang=sub');
    expect(job.language).toBe('sub');
    expect(job.quality).toBe('720');
    const finished = await waitForFinish(service, job);
    expect(JSON.parse(finished.log[0]).slice(0, 2)).toEqual([
      '-i',
      'https://www.wcostream.tv/anime/bleach?lang=sub',
    ]);
    expect(finished.outputFolder).toBe('/tmp/wco-test-output/bleach/');
  });

  it('rejects unknown languages', async () => {
    const service = createService();
    for (const language of ['fr', 'sub&x=1', 'SUBBED']) {
      await expect(
        service.startShowDownload({ name: 'bleach', language } as never),
      ).rejects.toThrow(BadRequestException);
    }
  });

  it.each([
    [undefined, true],
    ['480', false],
    ['720', true],
    ['1080', true],
  ])('quality %p passes -hd: %p', async (quality, hd) => {
    const service = createService();
    const job = await service.startShowDownload({
      name: 'naruto',
      quality,
    } as never);
    const args = JSON.parse((await waitForFinish(service, job)).log[0]);
    expect(args.includes('-hd')).toBe(hd);
  });

  it('rejects unsupported qualities', async () => {
    const service = createService();
    for (const quality of ['360', '720p', 'hd']) {
      await expect(
        service.startShowDownload({ name: 'naruto', quality } as never),
      ).rejects.toThrow(BadRequestException);
    }
  });
});

describe('DownloadService batch downloads', () => {
  it('starts one job per name with the shared options', async () => {
    const service = createService();
    const jobs = await service.startBatchDownload({
      names: ['naruto', 'https://www.wcostream.tv/anime/bleach', 'naruto'],
      season: '1',
      language: 'sub',
      quality: '480',
    });

    expect(jobs.map((job) => job.name)).toEqual(['naruto', 'bleach']);
    expect(jobs.map((job) => job.url)).toEqual([
      'https://www.wcostream.tv/anime/naruto?lang=sub',
      'https://www.wcostream.tv/anime/bleach?lang=sub',
    ]);
    for (const job of jobs) {
      expect(job).toMatchObject({ language: 'sub', quality: '480' });
    }
    for (const job of jobs) {
      const finished = await waitForFinish(service, job);
      expect(finished.status).toBe('completed');
      const args = JSON.parse(finished.log[0]);
      expect(args).toEqual(expect.arrayContaining(['-se', '1']));
      expect(args).not.toContain('-hd');
    }
    expect(service.listJobs()).toHaveLength(2);
  });

  it('starts nothing when any name is invalid', async () => {
    const service = createService();
    await expect(
      service.startBatchDownload({ names: ['naruto', '../../etc'] }),
    ).rejects.toThrow(BadRequestException);
    expect(service.listJobs()).toEqual([]);
  });

  it.each([undefined, [], 'naruto', new Array(51).fill('naruto')])(
    'rejects names = %p',
    async (names) => {
      const service = createService();
      await expect(
        service.startBatchDownload({ names } as never),
      ).rejects.toThrow(BadRequestException);
    },
  );
});

describe('DownloadService webhooks', () => {
  let receiver: Server;
  let receiverUrl: string;
  let received: { path: string; body: unknown }[];
  let onReceive: () => void;

  beforeAll(async () => {
    receiver = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        received.push({ path: req.url, body: JSON.parse(body) });
        res.statusCode = req.url === '/broken' ? 500 : 204;
        res.end();
        onReceive?.();
      });
    });
    await new Promise<void>((resolve) =>
      receiver.listen(0, '127.0.0.1', resolve),
    );
    const { port } = receiver.address() as AddressInfo;
    receiverUrl = `http://127.0.0.1:${port}`;
  });

  beforeEach(() => {
    received = [];
    onReceive = undefined;
  });

  afterAll(async () => {
    await new Promise((resolve) => receiver.close(resolve));
  });

  function waitForWebhooks(count: number) {
    return new Promise<void>((resolve) => {
      onReceive = () => received.length >= count && resolve();
    });
  }

  it('adds, lists and removes webhooks', () => {
    const service = createService();
    expect(service.listWebhooks()).toEqual([]);
    expect(service.addWebhook('http://a.test/hook')).toEqual([
      'http://a.test/hook',
    ]);
    service.addWebhook(' https://b.test/hook ');
    expect(service.listWebhooks()).toEqual([
      'http://a.test/hook',
      'https://b.test/hook',
    ]);
    expect(service.removeWebhook('http://a.test/hook')).toBe(true);
    expect(service.removeWebhook('http://a.test/hook')).toBe(false);
    expect(service.listWebhooks()).toEqual(['https://b.test/hook']);
  });

  it('rejects a webhook that is already registered', () => {
    const service = createService();
    service.addWebhook('http://a.test/hook');
    expect(() => service.addWebhook(' http://a.test/hook ')).toThrow(
      ConflictException,
    );
    expect(service.listWebhooks()).toEqual(['http://a.test/hook']);
  });

  it.each(['', 'not a url', 'ftp://a.test/hook', 'file:///etc/passwd', 42])(
    'rejects webhook URL %p',
    (url) => {
      expect(() => createService().addWebhook(url)).toThrow(
        BadRequestException,
      );
    },
  );

  it('seeds webhooks from config and skips invalid entries', () => {
    const service = createService({
      webhookUrls: ['http://a.test/hook', 'nope'],
    });
    expect(service.listWebhooks()).toEqual(['http://a.test/hook']);
  });

  it('posts the finished job to every webhook', async () => {
    const service = createService();
    service.addWebhook(`${receiverUrl}/one`);
    service.addWebhook(`${receiverUrl}/two`);
    const delivered = waitForWebhooks(2);

    const job = await service.startShowDownload({ name: 'fail-me' } as never);
    await delivered;

    expect(received.map((r) => r.path).sort()).toEqual(['/one', '/two']);
    expect(received[0].body).toEqual({
      id: job.id,
      name: 'fail-me',
      status: 'failed',
      url: 'https://www.wcostream.tv/anime/fail-me',
      outputFolder: '/tmp/wco-test-output/fail-me/',
      error: 'Process exited with code 2',
    });
  });

  it('keeps the job result when a webhook fails', async () => {
    const service = createService();
    service.addWebhook('http://127.0.0.1:1/unreachable');
    service.addWebhook(`${receiverUrl}/broken`);
    service.addWebhook(`${receiverUrl}/ok`);
    const delivered = waitForWebhooks(2);

    const job = await service.startShowDownload({ name: 'naruto' } as never);
    await delivered;

    expect(received.map((r) => r.path).sort()).toEqual(['/broken', '/ok']);
    expect((await waitForFinish(service, job)).status).toBe('completed');
  });
});
