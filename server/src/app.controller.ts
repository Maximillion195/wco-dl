import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AppService } from './app.service';
import { ContentItem } from './content-list';
import {
  DownloadJob,
  DownloadService,
  PostProcessResult,
  normalizeSlug,
} from './download.service';
import {
  BatchDownload,
  CreateShow,
  ProcessShow,
  SingleEpisodeReq,
  WebhookReq,
} from './dto/all.dto';
import { JsonRequestGuard } from './json-request.guard';
import { FillJob, FillService } from './fill.service';
import { CatalogueItem, searchCatalogue } from './fill.util';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly downloadService: DownloadService,
    private readonly fillService: FillService,
  ) {}

  // ---- Episode map (11 Nov 2026): look a show up from its wco link, then fill ticked episodes ----
  @Get('show')
  lookupShow(@Query('url') url: string, @Query('seriesId') seriesId?: string, @Query('absolute') absolute?: string) {
    return this.fillService.lookup(url, seriesId, absolute);
  }

  // Numbering check (13 Nov 2026): would the site list more of a show's episodes under the other way of numbering?
  @Get('numbering')
  numbering() {
    return this.fillService.numbering();
  }

  @Post('numbering/scan')
  @UseGuards(JsonRequestGuard)
  numberingScan() {
    return this.fillService.startNumberingScan();
  }

  // Which of a show's episodes wcostream does not list (12 Nov 2026).
  @Get('show/wco')
  showWco(@Query('url') url: string, @Query('seriesId') seriesId?: string, @Query('lang') lang?: string, @Query('absolute') absolute?: string) {
    return this.fillService.wcoCheck(url, seriesId, lang, absolute);
  }

  @Get('series-search')
  searchSeries(@Query('q') q: string) {
    return this.fillService.searchSeries(q);
  }

  @Post('fill')
  @UseGuards(JsonRequestGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  fill(@Body() body: any): Promise<FillJob> {
    return this.fillService.createJob(body);
  }

  @Get('fill/jobs')
  fillJobs(): FillJob[] {
    return this.fillService.listJobs();
  }

  @Get('fill/jobs/:id')
  fillJob(@Param('id') id: string): FillJob {
    return this.fillService.getJob(id);
  }

  @Post('fill/jobs/:id/cancel')
  @UseGuards(JsonRequestGuard)
  cancelFill(@Param('id') id: string): Promise<FillJob> {
    return this.fillService.cancel(id);
  }

  @Get('fill/jobs/:id/log/:episodeId')
  fillLog(@Param('id') id: string, @Param('episodeId') episodeId: string): Promise<string> {
    return this.fillService.episodeLog(id, Number(episodeId));
  }

  @Get('followed')
  followed() {
    return this.fillService.followed();
  }

  @Post('follow')
  @UseGuards(JsonRequestGuard)
  follow(@Body() body: any) {
    return this.fillService.setFollow(body);
  }

  // ---- Library gaps (11 Nov 2026): every animated series with gaps, matched to wcostream's catalogue ----
  private async catalogue(): Promise<{ items: CatalogueItem[]; errors: string[] }> {
    const lists = ['dubbed', 'cartoon', 'subbed'] as const;
    const got = await Promise.allSettled(lists.map((l) => this.appService.getContentList(l)));
    const items: CatalogueItem[] = [];
    const errors: string[] = [];
    got.forEach((r, i) => {
      if (r.status === 'fulfilled') items.push(...r.value.filter((x) => x.kind === 'series').map((x) => ({ name: x.name, path: x.path, list: lists[i] })));
      else errors.push(`${lists[i]} list: ${(r.reason as Error)?.message ?? 'no answer'}`);
    });
    return { items, errors };
  }

  @Get('library/gaps')
  async libraryGaps() {
    const { items, errors } = await this.catalogue();
    return { catalogueSize: items.length, catalogueErrors: errors, rows: await this.fillService.libraryGaps(items) };
  }

  @Get('library/search')
  async librarySearch(@Query('q') q: string) {
    return this.fillService.inSonarr(searchCatalogue((await this.catalogue()).items, q));
  }

  @Post('links')
  @UseGuards(JsonRequestGuard)
  links(@Body() body: any) {
    return this.fillService.setLinks(body);
  }

  @Post('fill/plan-now')
  @UseGuards(JsonRequestGuard)
  async planNow() {
    await this.fillService.nightlyPlan();
    return this.fillService.listJobs().filter((j) => j.auto && !j.finishedAt);
  }

  @Post('fill/jobs/:id/retry')
  @UseGuards(JsonRequestGuard)
  retryFill(@Param('id') id: string): Promise<FillJob> {
    return this.fillService.retry(id);
  }

  // ---- Queue controls and the "Needs you" list (11 Nov 2026) ----
  @Post('fill/jobs/:id/retry/:episodeId')
  @UseGuards(JsonRequestGuard)
  retryEpisode(@Param('id') id: string, @Param('episodeId') episodeId: string): Promise<FillJob> {
    return this.fillService.retryEpisode(id, Number(episodeId));
  }

  @Post('fill/jobs/:id/next')
  @UseGuards(JsonRequestGuard)
  runNext(@Param('id') id: string): Promise<FillJob> {
    return this.fillService.runNext(id);
  }

  @Post('fill/jobs/:id/dismiss/:episodeId')
  @UseGuards(JsonRequestGuard)
  dismiss(@Param('id') id: string, @Param('episodeId') episodeId: string) {
    return this.fillService.dismiss(id, Number(episodeId));
  }

  @Get('fill/state')
  queueState() {
    return this.fillService.queueState();
  }

  @Post('fill/pause')
  @UseGuards(JsonRequestGuard)
  pause(@Body() body: any) {
    return this.fillService.setPaused(!!body?.paused);
  }

  @Get('attention')
  attention() {
    return this.fillService.attention();
  }

  @Get('sonarr/defaults')
  addDefaults() {
    return this.fillService.addDefaults();
  }

  @Post('sonarr/add')
  @UseGuards(JsonRequestGuard)
  addToSonarr(@Body() body: any) {
    return this.fillService.addToSonarr(body);
  }

  @Post('followed/recount')
  @UseGuards(JsonRequestGuard)
  recount() {
    return this.fillService.recount();
  }

  // Settings screen (12 Nov 2026): the overnight window, the nightly limit and the default quality.
  @Get('settings')
  settings() {
    return this.fillService.getSettings();
  }

  @Post('settings')
  @UseGuards(JsonRequestGuard)
  async saveSettings(@Body() body: any) {
    return this.fillService.setSettings(body);
  }

  @Get('get-website')
  getWebsite() {
    return 'https://www.wcostream.tv/';
  }

  @Get('get-all-dubbed-anime-names')
  getAllDubbedAnimes(): Promise<ContentItem[]> {
    return this.appService.getContentList('dubbed');
  }

  @Get('get-all-subbed-anime-names')
  getAllSubbedAnimes(): Promise<ContentItem[]> {
    return this.appService.getContentList('subbed');
  }

  @Get('get-all-cartoon-names')
  getAllCartoons(): Promise<ContentItem[]> {
    return this.appService.getContentList('cartoon');
  }

  @Get('get-all-movie-names')
  getAllMovies(): Promise<ContentItem[]> {
    return this.appService.getContentList('movie');
  }

  @Get('get-all-ova-names')
  getAllOvas(): Promise<ContentItem[]> {
    return this.appService.getContentList('ova');
  }

  @Post('download-anime')
  @HttpCode(HttpStatus.ACCEPTED)
  getShow(@Body() body: CreateShow): Promise<DownloadJob> {
    return this.downloadService.startShowDownload(body);
  }

  @Post('download-batch')
  @HttpCode(HttpStatus.ACCEPTED)
  batchDownload(@Body() body: BatchDownload): Promise<DownloadJob[]> {
    return this.downloadService.startBatchDownload(body);
  }

  @Post('download-single-episode')
  @HttpCode(HttpStatus.ACCEPTED)
  getSingleEpisode(@Body() body: SingleEpisodeReq): Promise<DownloadJob> {
    // e.g. that-time-i-got-reincarnated-as-a-slime-episode-2-english-dubbed
    return this.downloadService.startEpisodeDownload(body?.name);
  }

  @Post('process-anime')
  @HttpCode(HttpStatus.OK)
  processShow(@Body() body: ProcessShow): Promise<PostProcessResult> {
    const slug = normalizeSlug(body?.name, true);
    return this.downloadService.postProcess(
      this.downloadService.showFolder(slug),
    );
  }

  @Get('downloads')
  listDownloads(): DownloadJob[] {
    return this.downloadService.listJobs();
  }

  @Get('downloads/:id')
  getDownload(@Param('id') id: string): DownloadJob {
    const job = this.downloadService.getJob(id);
    if (!job) {
      throw new NotFoundException(`Download ${id} not found`);
    }
    return job;
  }

  @Get('webhooks')
  listWebhooks(): string[] {
    return this.downloadService.listWebhooks();
  }

  @Post('webhooks')
  @UseGuards(JsonRequestGuard)
  @HttpCode(HttpStatus.CREATED)
  addWebhook(@Body() body: WebhookReq): Promise<string[]> {
    return this.downloadService.addWebhook(body?.url);
  }

  // The URL must be percent-encoded (encodeURIComponent) to fit in one path segment.
  @Delete('webhooks/:url')
  @UseGuards(JsonRequestGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeWebhook(@Param('url') url: string): void {
    if (!this.downloadService.removeWebhook(url)) {
      throw new NotFoundException(`Webhook ${url} not found`);
    }
  }
}
