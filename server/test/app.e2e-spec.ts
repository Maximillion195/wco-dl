import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import * as path from 'path';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { APP_CONFIG } from './../src/app-config.provider';
import { loadConfig } from './../src/config';
import { ScheduledTaskService } from './../src/scheduled-task.service';

const listPages: Record<string, string> = {
  'dubbed-anime-list':
    '<a href="/anime/naruto?season=all&amp;lang=dub">Naruto</a>',
  'subbed-anime-list':
    '<a href="/anime/bleach?season=all&amp;lang=sub">Bleach</a>',
  'cartoon-list': '<a href="/anime/tom-and-jerry">Tom &amp; Jerry</a>',
  'movie-list': '<a href="/akira-english-dubbed">Akira</a>',
  'ova-list':
    '<a href="/hellsing-ova-episode-1-english-dubbed">Hellsing OVA 1</a>',
};

describe('AppController (e2e)', () => {
  let app: INestApplication;
  let byparr: Server;
  let byparrRequests: string[];
  let byparrFailing: boolean;

  beforeAll(async () => {
    byparr = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const { cmd, url } = JSON.parse(body);
        byparrRequests.push(url);
        res.setHeader('Content-Type', 'application/json');
        if (byparrFailing) {
          res.statusCode = 500;
          res.end(
            JSON.stringify({
              status: 'error',
              message: 'Challenge not solved',
            }),
          );
          return;
        }
        const listName = new URL(url).pathname.replace(/\//g, '');
        const links = listPages[listName];
        res.end(
          JSON.stringify({
            status: 'ok',
            solution: {
              url,
              status: links && cmd === 'request.get' ? 200 : 404,
              response: `<html><div id="ddmcc_container">${links ?? ''}</div></html>`,
            },
          }),
        );
      });
    });
    await new Promise<void>((resolve) =>
      byparr.listen(0, '127.0.0.1', resolve),
    );
    const { port } = byparr.address() as AddressInfo;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(APP_CONFIG)
      .useValue({
        ...loadConfig({}),
        byparrUrl: `http://127.0.0.1:${port}`,
        outputBase: '/tmp/wco-e2e-output',
        pythonBin: process.execPath,
        pythonScript: path.resolve(__dirname, 'fixtures/fake-wco-dl.js'),
      })
      .overrideProvider(ScheduledTaskService)
      .useValue({})
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    byparrRequests = [];
    byparrFailing = false;
  });

  afterAll(async () => {
    await app.close();
    await new Promise((resolve) => byparr.close(resolve));
  });

  it.each([
    [
      'get-all-dubbed-anime-names',
      { name: 'Naruto', path: 'naruto', kind: 'series' },
    ],
    [
      'get-all-subbed-anime-names',
      { name: 'Bleach', path: 'bleach', kind: 'series' },
    ],
    [
      'get-all-cartoon-names',
      { name: 'Tom & Jerry', path: 'tom-and-jerry', kind: 'series' },
    ],
    [
      'get-all-movie-names',
      { name: 'Akira', path: 'akira-english-dubbed', kind: 'episode' },
    ],
    [
      'get-all-ova-names',
      {
        name: 'Hellsing OVA 1',
        path: 'hellsing-ova-episode-1-english-dubbed',
        kind: 'episode',
      },
    ],
  ])(
    'GET /%s returns the parsed list and caches it',
    async (endpoint, item) => {
      await request(app.getHttpServer())
        .get(`/${endpoint}`)
        .expect(200, [item]);
      await request(app.getHttpServer())
        .get(`/${endpoint}`)
        .expect(200, [item]);
      expect(byparrRequests).toHaveLength(1);
    },
  );

  it('returns 502 with the Byparr error when the list cannot be fetched', async () => {
    const app2 = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue({ ...loadConfig({}), byparrUrl: 'http://127.0.0.1:1' })
      .overrideProvider(ScheduledTaskService)
      .useValue({})
      .compile()
      .then((moduleRef) => moduleRef.createNestApplication().init());

    const res = await request(app2.getHttpServer())
      .get('/get-all-movie-names')
      .expect(502);
    expect(res.body.message).toMatch(/Byparr request to http:\/\/127.0.0.1:1/);
    await app2.close();
  });

  it('starts a show download and exposes its status', async () => {
    const started = await request(app.getHttpServer())
      .post('/download-anime')
      .send({ name: 'naruto', season: '1', episode: '', newest: false })
      .expect(202);
    expect(started.body).toMatchObject({
      status: 'running',
      kind: 'show',
      url: 'https://www.wcostream.tv/anime/naruto',
    });

    let job;
    for (let i = 0; i < 50; i++) {
      job = (
        await request(app.getHttpServer())
          .get(`/downloads/${started.body.id}`)
          .expect(200)
      ).body;
      if (job.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(job.status).toBe('completed');

    const list = await request(app.getHttpServer())
      .get('/downloads')
      .expect(200);
    expect(list.body.map((j) => j.id)).toContain(started.body.id);
  });

  it('starts a single episode download', async () => {
    const res = await request(app.getHttpServer())
      .post('/download-single-episode')
      .send({ name: 'akira-english-dubbed' })
      .expect(202);
    expect(res.body).toMatchObject({
      kind: 'episode',
      outputFolder: '/tmp/wco-e2e-output/akira-english-dubbed/',
    });
  });

  it('rejects invalid download input with 400', async () => {
    await request(app.getHttpServer())
      .post('/download-anime')
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .post('/download-anime')
      .send({ name: '../../etc' })
      .expect(400);
  });

  it('returns 404 for unknown downloads', async () => {
    await request(app.getHttpServer()).get('/downloads/unknown').expect(404);
  });

  it('reports skipped post-processing outside production', async () => {
    const res = await request(app.getHttpServer())
      .post('/process-anime')
      .send({ name: 'naruto' })
      .expect(200);
    expect(res.body).toMatchObject({
      folder: '/tmp/wco-e2e-output/naruto/',
      permissions: { status: 'skipped' },
      sonarr: { status: 'skipped' },
    });
  });
});
