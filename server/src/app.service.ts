import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import axios from 'axios';
import { APP_CONFIG } from './app-config.provider';
import { AppConfig } from './config';
import {
  CONTENT_LISTS,
  CONTENT_LIST_TTL_MS,
  ContentItem,
  ContentType,
  parseContentList,
} from './content-list';

interface ByparrRequest {
  cmd: 'request.get';
  url: string;
  maxTimeout: number;
}

interface ByparrResponse {
  status?: string;
  message?: string;
  solution?: {
    url?: string;
    status?: number;
    response?: string;
  };
}

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);
  private readonly inflight = new Map<ContentType, Promise<ContentItem[]>>();

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Returns the cached list, fetching it through Byparr when missing. */
  async getContentList(
    type: ContentType,
    forceRefresh = false,
  ): Promise<ContentItem[]> {
    const { cacheKey } = CONTENT_LISTS[type];

    if (!forceRefresh) {
      const cached = await this.cacheManager.get<ContentItem[]>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    let pending = this.inflight.get(type);
    if (!pending) {
      pending = this.fetchAndCacheList(type).finally(() =>
        this.inflight.delete(type),
      );
      this.inflight.set(type, pending);
    }
    return pending;
  }

  getAllDubbedAnimes(): Promise<ContentItem[]> {
    return this.getContentList('dubbed');
  }

  private async fetchAndCacheList(type: ContentType): Promise<ContentItem[]> {
    const { listUrl, cacheKey } = CONTENT_LISTS[type];
    const html = await this.fetchPageHtml(listUrl);
    const items = parseContentList(html);

    if (items.length === 0) {
      throw new BadGatewayException(
        `No titles found on ${listUrl}; the page layout may have changed`,
      );
    }

    await this.cacheManager.set(cacheKey, items, CONTENT_LIST_TTL_MS);
    this.logger.log(`Cached ${items.length} ${type} titles`);
    return items;
  }

  async fetchPageHtml(url: string): Promise<string> {
    const { byparrUrl, byparrMaxTimeoutMs } = this.config;
    const requestData: ByparrRequest = {
      cmd: 'request.get',
      url,
      maxTimeout: byparrMaxTimeoutMs,
    };

    let data: ByparrResponse;
    try {
      const response = await axios.post<ByparrResponse>(
        `${byparrUrl}/v1`,
        requestData,
        {
          headers: { 'Content-Type': 'application/json' },
          // Byparr may spend up to maxTimeout solving the challenge.
          timeout: byparrMaxTimeoutMs + 30000,
        },
      );
      data = response.data;
    } catch (error) {
      const detail = axios.isAxiosError(error)
        ? (error.response?.data as ByparrResponse)?.message || error.message
        : String(error);
      throw new BadGatewayException(
        `Byparr request to ${byparrUrl} for ${url} failed: ${detail}`,
      );
    }

    if (data?.status && data.status !== 'ok') {
      throw new BadGatewayException(
        `Byparr could not load ${url}: ${data.message || data.status}`,
      );
    }

    const html = data?.solution?.response;
    const upstreamStatus = data?.solution?.status;
    if (upstreamStatus && upstreamStatus >= 400) {
      throw new BadGatewayException(
        `${url} returned HTTP ${upstreamStatus} through Byparr`,
      );
    }
    if (!html) {
      throw new BadGatewayException(`Byparr returned no HTML for ${url}`);
    }
    return html;
  }
}
