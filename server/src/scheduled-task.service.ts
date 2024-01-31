import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from 'nest-schedule';
import { AppService } from './app.service';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Logger } from '@nestjs/common';

const appService = new AppService();

@Injectable()
export class ScheduledTaskService implements OnApplicationBootstrap {
	constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) { }
	private readonly logger = new Logger(ScheduledTaskService.name);

	onApplicationBootstrap() {
		// Code to be executed on application startup
		this.getAllDubbedAnimes();
	}

	@Cron('0 1 * * *') // Run every day at 1 AM
	async getAllDubbedAnimes() {
		this.logger.log('Running scheduled job, getting all dubbed animes list');
		const animePaths = await appService.getAllDubbedAnimes()

		// Store data in cache for future requests
		await this.cacheManager.set('allDubbedAnimes', animePaths, 172800 * 1000); // Cache for 2 days
	}
}