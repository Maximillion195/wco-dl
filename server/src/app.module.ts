import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { CacheModule } from '@nestjs/cache-manager';
import { ScheduleModule } from 'nest-schedule';
import { ScheduledTaskService } from './scheduled-task.service';

@Module({
  imports: [
    CacheModule.register(),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'client'),
    }),
    ScheduleModule.register(),
  ],
  controllers: [AppController],
  providers: [AppService, ScheduledTaskService],
})
export class AppModule { }

