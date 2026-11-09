import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import axios from 'axios';
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { promisify } from 'util';
import { APP_CONFIG } from './app-config.provider';
import { AppConfig } from './config';
import { WCO_BASE_URL } from './content-list';
import { CreateShow } from './dto/all.dto';
import { ProcessResult, startProcess } from './process-runner';

const execFileAsync = promisify(execFile);

export type DownloadKind = 'show' | 'episode';
export type DownloadStatus = 'running' | 'completed' | 'failed' | 'timed_out';

export interface StepResult {
  status: 'ok' | 'skipped' | 'failed';
  message?: string;
}

export interface PostProcessResult {
  folder: string;
  permissions: StepResult;
  sonarr: StepResult;
}

export interface DownloadJob {
  id: string;
  kind: DownloadKind;
  name: string;
  url: string;
  outputFolder: string;
  status: DownloadStatus;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  signal?: string | null;
  error?: string;
  postProcess?: PostProcessResult;
  /** Last lines of the Python output, for display in the UI. */
  log: string[];
}

const MAX_LOG_LINES = 30;
const MAX_LOG_LINE_LENGTH = 500;
const MAX_TRACKED_JOBS = 100;

const SLUG_RE = /^[\w%-]{1,300}$/;
const SEASON_RE = /^\d+$/;
const EPISODE_RANGE_RE = /^\d+(-\d+)?$/;
const WCO_URL_PREFIX_RE = /^https?:\/\/(www\.)?wcostream\.tv\//i;

/**
 * Accepts a bare slug, a `/anime/<slug>` path or a full wcostream URL and
 * returns the slug. Rejects anything that could escape the output folder.
 */
export function normalizeSlug(
  input: unknown,
  stripAnimePrefix: boolean,
): string {
  if (typeof input !== 'string' || !input.trim()) {
    throw new BadRequestException('Missing parameter: name');
  }

  let slug = input
    .trim()
    .replace(WCO_URL_PREFIX_RE, '')
    .split(/[?#]/)[0]
    .replace(/^\/+|\/+$/g, '');
  if (stripAnimePrefix) {
    slug = slug.replace(/^anime\//, '');
  }

  if (!SLUG_RE.test(slug)) {
    throw new BadRequestException(`Invalid name: ${input}`);
  }
  return slug;
}

function optionalParam(
  value: unknown,
  pattern: RegExp,
  label: string,
): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const text = String(value).trim();
  if (!pattern.test(text)) {
    throw new BadRequestException(`Invalid ${label}: ${text}`);
  }
  return text;
}

@Injectable()
export class DownloadService {
  private readonly logger = new Logger(DownloadService.name);
  private readonly jobs = new Map<string, DownloadJob>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  showFolder(slug: string): string {
    return `${this.config.outputBase}/${slug}/`;
  }

  async startShowDownload(body: CreateShow): Promise<DownloadJob> {
    const slug = normalizeSlug(body?.name, true);
    const season = optionalParam(body.season, SEASON_RE, 'season');
    const episode = optionalParam(
      body.episode,
      EPISODE_RANGE_RE,
      'episode range',
    );
    const newest = body.newest === true || String(body.newest) === 'true';

    const url = `${WCO_BASE_URL}/anime/${slug}`;
    const outputFolder = this.showFolder(slug);
    const args = ['-i', url];
    if (season) args.push('-se', season);
    if (episode) args.push('-epr', episode);
    args.push('-hd');
    if (newest) args.push('-n');
    args.push('-o', outputFolder, '-t', '2');

    return this.startJob('show', slug, url, outputFolder, args);
  }

  async startEpisodeDownload(name: unknown): Promise<DownloadJob> {
    const slug = normalizeSlug(name, false);
    // Episodes of the same show share a folder: `<show>-episode-2-...` -> `<show>`.
    const title = slug.split('-episode-')[0];

    const url = `${WCO_BASE_URL}/${slug}`;
    const outputFolder = this.showFolder(title);
    const args = ['-i', url, '-o', outputFolder, '-t', '2'];

    return this.startJob('episode', slug, url, outputFolder, args);
  }

  listJobs(): DownloadJob[] {
    return [...this.jobs.values()].reverse();
  }

  getJob(id: string): DownloadJob | undefined {
    return this.jobs.get(id);
  }

  private async startJob(
    kind: DownloadKind,
    name: string,
    url: string,
    outputFolder: string,
    args: string[],
  ): Promise<DownloadJob> {
    const { pythonBin, pythonScript, downloadIdleTimeoutMs } = this.config;
    const fullArgs = [pythonScript, ...args];
    this.logger.log(`Starting: ${pythonBin} ${fullArgs.join(' ')}`);

    const job: DownloadJob = {
      id: randomUUID(),
      kind,
      name,
      url,
      outputFolder,
      status: 'running',
      startedAt: new Date().toISOString(),
      log: [],
    };

    let running;
    try {
      running = await startProcess({
        command: pythonBin,
        args: fullArgs,
        idleTimeoutMs: downloadIdleTimeoutMs,
        // Without this Python block-buffers piped stdout, which starves the
        // idle timeout of output and gets healthy downloads killed.
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        onOutput: (chunk, stream) => {
          (stream === 'stderr' ? process.stderr : process.stdout).write(chunk);
          this.appendLog(job, chunk);
        },
      });
    } catch (error) {
      this.logger.error(`Could not start ${pythonBin}: ${error.message}`);
      throw new InternalServerErrorException(
        `Could not start the downloader (${pythonBin}): ${error.message}`,
      );
    }

    this.trackJob(job);
    running.result.then((result) => this.finishJob(job, result));
    return job;
  }

  private async finishJob(job: DownloadJob, result: ProcessResult) {
    job.status = result.outcome;
    job.exitCode = result.exitCode;
    job.signal = result.signal;
    job.error = result.error;
    job.finishedAt = new Date().toISOString();

    const summary = `Download ${job.name} ${job.status}`;
    if (job.status === 'completed') {
      this.logger.log(summary);
    } else {
      this.logger.warn(`${summary}: ${job.error}`);
    }

    // Episodes finished before a failure or timeout are still worth importing.
    try {
      job.postProcess = await this.postProcess(job.outputFolder);
    } catch (error) {
      this.logger.error(`Post-processing ${job.name} failed: ${error.message}`);
    }
  }

  /** Fixes file ownership and asks Sonarr to import the folder. */
  async postProcess(folder: string): Promise<PostProcessResult> {
    const permissions = await this.applyPermissions(folder);
    const sonarr = await this.triggerSonarrImport(folder);
    return { folder, permissions, sonarr };
  }

  private async applyPermissions(folder: string): Promise<StepResult> {
    const { isProd, puid, pgid } = this.config;
    if (!isProd) {
      return { status: 'skipped', message: 'Only runs in production' };
    }
    if (!puid || !pgid) {
      return { status: 'skipped', message: 'PUID/PGID not set' };
    }

    const script = path.resolve(__dirname, 'change-permissions.sh');
    try {
      const { stdout } = await execFileAsync(
        'bash',
        [script, folder, '775', puid, pgid],
        { timeout: 5 * 60 * 1000 },
      );
      this.logger.log(stdout.trim());
      return { status: 'ok' };
    } catch (error) {
      const message = (error.stderr || error.message || '').toString().trim();
      this.logger.error(`Setting permissions on ${folder} failed: ${message}`);
      return { status: 'failed', message };
    }
  }

  private async triggerSonarrImport(folder: string): Promise<StepResult> {
    const { isProd, sonarrUrl, sonarrApiKey } = this.config;
    if (!isProd) {
      return { status: 'skipped', message: 'Only runs in production' };
    }
    if (!sonarrApiKey) {
      return { status: 'skipped', message: 'SONARR_API_KEY not set' };
    }

    try {
      const { data } = await axios.post(
        `${sonarrUrl}/api/v3/command`,
        { name: 'DownloadedEpisodesScan', path: folder },
        {
          headers: { 'X-Api-Key': sonarrApiKey },
          timeout: 15000,
        },
      );
      this.logger.log(`Sonarr import initiated: ${data?.status}`);
      return { status: 'ok', message: data?.status };
    } catch (error) {
      const message =
        axios.isAxiosError(error) && error.response
          ? `HTTP ${error.response.status} from ${sonarrUrl}`
          : `${sonarrUrl}: ${error.message}`;
      this.logger.error(`Sonarr import failed: ${message}`);
      return { status: 'failed', message };
    }
  }

  private appendLog(job: DownloadJob, chunk: string) {
    for (const line of chunk.split(/\r\n|\r|\n/)) {
      const trimmed = line.trim();
      if (trimmed) job.log.push(trimmed.slice(0, MAX_LOG_LINE_LENGTH));
    }
    if (job.log.length > MAX_LOG_LINES) {
      job.log.splice(0, job.log.length - MAX_LOG_LINES);
    }
  }

  private trackJob(job: DownloadJob) {
    this.jobs.set(job.id, job);
    if (this.jobs.size <= MAX_TRACKED_JOBS) return;
    for (const [id, existing] of this.jobs) {
      if (existing.status !== 'running') {
        this.jobs.delete(id);
        if (this.jobs.size <= MAX_TRACKED_JOBS) return;
      }
    }
  }
}
