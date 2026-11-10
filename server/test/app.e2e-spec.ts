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

  it('passes language to the show URL and rejects unknown values', async () => {
    const res = await request(app.getHttpServer())
      .post('/download-anime')
      .send({ name: 'bleach', language: 'sub', quality: '1080' })
      .expect(202);
    expect(res.body.url).toBe('https://www.wcostream.tv/anime/bleach?lang=sub');

    await request(app.getHttpServer())
      .post('/download-anime')
      .send({ name: 'bleach', language: 'raw' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/download-anime')
      .send({ name: 'bleach', quality: '4k' })
      .expect(400);
  });

  it('starts a batch of show downloads', async () => {
    const res = await request(app.getHttpServer())
      .post('/download-batch')
      .send({ names: ['naruto', 'bleach'], language: 'dub', newest: true })
      .expect(202);
    expect(res.body).toHaveLength(2);
    expect(res.body.map((job) => job.url)).toEqual([
      'https://www.wcostream.tv/anime/naruto?lang=dub',
      'https://www.wcostream.tv/anime/bleach?lang=dub',
    ]);

    await request(app.getHttpServer())
      .post('/download-batch')
      .send({ names: [] })
      .expect(400);
  });

  it('manages webhooks', async () => {
    // TEST-NET-3 literal: public, and needs no DNS.
    const hook = 'http://203.0.113.10:9/hook?token=a/b';
    await request(app.getHttpServer()).get('/webhooks').expect(200, []);
    await request(app.getHttpServer())
      .post('/webhooks')
      .send({ url: hook })
      .expect(201, [hook]);
    const duplicate = await request(app.getHttpServer())
      .post('/webhooks')
      .send({ url: hook })
      .expect(409);
    expect(duplicate.body.message).toBe(
      `Webhook ${hook} is already registered`,
    );
    await request(app.getHttpServer())
      .post('/webhooks')
      .send({ url: 'javascript:alert(1)' })
      .expect(400);
    await request(app.getHttpServer()).get('/webhooks').expect(200, [hook]);
    await request(app.getHttpServer())
      .delete(`/webhooks/${encodeURIComponent(hook)}`)
      .set('Content-Type', 'application/json')
      .expect(204);
    await request(app.getHttpServer())
      .delete(`/webhooks/${encodeURIComponent(hook)}`)
      .set('Content-Type', 'application/json')
      .expect(404);
    await request(app.getHttpServer()).get('/webhooks').expect(200, []);
  });

  describe('webhook CSRF protection', () => {
    const hook = 'http://203.0.113.10/csrf';

    afterEach(async () => {
      await request(app.getHttpServer())
        .delete(`/webhooks/${encodeURIComponent(hook)}`)
        .set('Content-Type', 'application/json');
    });

    it.each([
      ['form-encoded', 'application/x-www-form-urlencoded', `url=${hook}`],
      ['multipart', 'multipart/form-data; boundary=x', `--x\r\n--x--`],
      ['text/plain', 'text/plain', JSON.stringify({ url: hook })],
    ])('rejects a %s POST /webhooks with 415', async (_, type, body) => {
      await request(app.getHttpServer())
        .post('/webhooks')
        .set('Content-Type', type)
        .send(body)
        .expect(415);
      await request(app.getHttpServer()).get('/webhooks').expect(200, []);
    });

    it('rejects DELETE /webhooks/:url without a JSON content type', async () => {
      await request(app.getHttpServer())
        .post('/webhooks')
        .send({ url: hook })
        .expect(201);
      await request(app.getHttpServer())
        .delete(`/webhooks/${encodeURIComponent(hook)}`)
        .expect(415);
      await request(app.getHttpServer())
        .delete(`/webhooks/${encodeURIComponent(hook)}`)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .expect(415);
      await request(app.getHttpServer()).get('/webhooks').expect(200, [hook]);
    });

    it('rejects requests from a foreign Origin with 403', async () => {
      await request(app.getHttpServer())
        .post('/webhooks')
        .set('Origin', 'https://evil.example')
        .send({ url: hook })
        .expect(403);
      await request(app.getHttpServer()).get('/webhooks').expect(200, []);
    });

    it('accepts the configured CORS origin and same-host origins', async () => {
      await request(app.getHttpServer())
        .post('/webhooks')
        .set('Origin', loadConfig({}).corsOrigin)
        .send({ url: hook })
        .expect(201);
      await request(app.getHttpServer())
        .delete(`/webhooks/${encodeURIComponent(hook)}`)
        .set('Host', '192.168.1.5:3000')
        .set('Origin', 'http://192.168.1.5:3000')
        .set('Content-Type', 'application/json; charset=utf-8')
        .expect(204);
    });

    it('rejects internal webhook targets with 400', async () => {
      for (const url of [
        'http://127.0.0.1:8989/api',
        'http://169.254.169.254/latest/meta-data/',
        'http://192.168.1.1/',
      ]) {
        const res = await request(app.getHttpServer())
          .post('/webhooks')
          .send({ url })
          .expect(400);
        expect(res.body.message).toMatch(/resolves to internal address/);
      }
    });
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
