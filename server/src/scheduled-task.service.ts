import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AppService } from './app.service';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Logger } from '@nestjs/common';

@Injectable()
export class ScheduledTaskService implements OnApplicationBootstrap {
	constructor(private readonly appService: AppService , @Inject(CACHE_MANAGER) private cacheManager: Cache) { }
	private readonly logger = new Logger(ScheduledTaskService.name);

	onApplicationBootstrap() {
		// Code to be executed on application startup
		this.getAllDubbedAnimes();
	}

	@Cron('0 1 * * *') // Run every day at 1 AM
	async getAllDubbedAnimes() {
		this.logger.log('Getting all dubbed animes list');
		const animePaths = await this.appService.getAllDubbedAnimes()

		// Store data in cache for future requests
		await this.cacheManager.set('allDubbedAnimes', animePaths, 172800 * 1000); // Cache for 2 days
	}
}