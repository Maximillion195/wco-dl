import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AppService } from './app.service';
import { CONTENT_TYPES } from './content-list';

@Injectable()
export class ScheduledTaskService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScheduledTaskService.name);

  constructor(private readonly appService: AppService) {}

  onApplicationBootstrap() {
    // Not awaited so the server starts listening while the lists load.
    void this.refreshContentLists();
  }

  @Cron('0 1 * * *') // Run every day at 1 AM
  async refreshContentLists() {
    // Sequential, so a single Byparr browser is not flooded with requests.
    for (const type of CONTENT_TYPES) {
      this.logger.log(`Refreshing ${type} list`);
      try {
        await this.appService.getContentList(type, true);
      } catch (error) {
        this.logger.error(`Refreshing ${type} list failed: ${error.message}`);
      }
    }
  }
}
