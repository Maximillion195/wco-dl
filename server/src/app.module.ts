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
    ScheduledTaskService,
  ],
})
export class AppModule {}
