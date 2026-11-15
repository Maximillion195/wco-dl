import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { CacheModule } from '@nestjs/cache-manager';
import { ScheduleModule } from '@nestjs/schedule';
import { ScheduledTaskService } from './scheduled-task.service';
import { DownloadService } from './download.service';
import { appConfigProvider } from './app-config.provider';
import { FillService } from './fill.service';
import { DubCalendarService } from './dub-calendar.service';
import { WcoEpisodesService } from './wco-episodes.service';

@Module({
  imports: [
    CacheModule.register(),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'client'),
    }),
    ScheduleModule.forRoot(),
  ],
  controllers: [AppController],
  providers: [
    appConfigProvider,
    AppService,
    DownloadService,
    FillService,
    DubCalendarService,
    WcoEpisodesService,
    ScheduledTaskService,
  ],
})
export class AppModule {}
