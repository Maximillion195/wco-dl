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

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly downloadService: DownloadService,
  ) {}

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
  @HttpCode(HttpStatus.CREATED)
  addWebhook(@Body() body: WebhookReq): string[] {
    return this.downloadService.addWebhook(body?.url);
  }

  // The URL must be percent-encoded (encodeURIComponent) to fit in one path segment.
  @Delete('webhooks/:url')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeWebhook(@Param('url') url: string): void {
    if (!this.downloadService.removeWebhook(url)) {
      throw new NotFoundException(`Webhook ${url} not found`);
    }
  }
}
