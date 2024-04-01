import { Body, Controller, Get, Post, UseInterceptors, Inject, NotFoundException } from '@nestjs/common';
import { AppService } from './app.service';
import { CreateShow, ProcessShow, SingleEpisodeReq } from './dto/all.dto';
const { spawn } = require('child_process');
const path = require('path');
import { Cache } from 'cache-manager';
import { CACHE_MANAGER, CacheInterceptor } from '@nestjs/cache-manager';

const { exec } = require('child_process');

const isProd = process.env.NODE_ENV === 'production';
const outputBase = isProd ? '/data/torrents/completed' : './output';

@Controller()
@UseInterceptors(CacheInterceptor)
export class AppController {
  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly appService: AppService,
  ) {}

  @Get('get-website')
  getWebsite() {
    return 'https://www.wcostream.tv/';
  }

  @Get('get-all-dubbed-anime-names')
  @UseInterceptors(CacheInterceptor) // Apply CacheInterceptor
  async getAllDubbedAnimes() {
    // Check if data is already in cache
    const cachedData = await this.cacheManager.get('allDubbedAnimes');

    if (cachedData) {
      return cachedData;
    }

    const animePaths = await this.appService.getAllDubbedAnimes();

    // Store data in cache for future requests
    await this.cacheManager.set('allDubbedAnimes', animePaths, 172800 * 1000); // Cache for 2 days

    return animePaths;
  }

  @Post('download-anime')
  async getShow(@Body() body: CreateShow) {
    if (!body.name) {
      throw new NotFoundException('Missing parameter: name');
    }

    const pythonScript = path.resolve(__dirname, '../../__main__.py');

    const inputUrl = `-i https://www.wcostream.tv/anime/${body.name}`;
    const seasonOption = body.season ? `-se ${body.season}` : '';
    const episodeOption = body.episode ? `-epr ${body.episode}` : '';
    const qualityOption = '-hd';
    const newestOption = body.newest ? `-n` : '';
    const threadsAmount = '-t 2';
    const outputOption = `-o "${outputBase}/${body.name}/"`;

    const pythonCommand = `python ${pythonScript} ${inputUrl} ${seasonOption} ${episodeOption} ${qualityOption} ${newestOption} ${outputOption} ${threadsAmount}`;

    console.log(pythonCommand);

    // Use spawn for real-time output
    const child = spawn(pythonCommand, {
      shell: true,
      stdio: ['inherit', 'pipe', 'inherit'],
    });

    // Set a timeout (5 minutes = 300,000 milliseconds)
    const timeout = 150000;
    let timeoutId;

    const handleTimeout = () => {
      console.log('Python command execution timed out. Killing the process.');
      child.kill();
    };

    timeoutId = setTimeout(handleTimeout, timeout);

    // Capture and log the stdout
    child.stdout.on('data', (data) => {
      process.stdout.write(data.toString()); // Write data to the console without adding a newline
      // Reset the timeout on receiving data
      clearTimeout(timeoutId);
      timeoutId = setTimeout(handleTimeout, timeout);
    });

    // Listen for the exit event
    child.on('exit', async (code) => {
      console.log('Python script finished');
      clearTimeout(timeoutId); // Clear the timeout if the process exits before the timeout
      if (isProd) {
        const folderPath = `${outputBase}/${body.name}/`;
        const uid = process.env.PUID;
        const gid = process.env.PGID;

        await new Promise((resolve) => {
          addFilePermissions(folderPath, '775', uid, gid, resolve);
        });

        await triggerSonarImport(folderPath);
      }
    });

    // return this.appService.getHello();
  }

  @Post('download-single-episode')
  async getSingleEpisode(@Body() body: SingleEpisodeReq) {
    // that-time-i-got-reincarnated-as-a-slime-episode-2-english-dubbed
    if (!body.name) {
      throw new NotFoundException('Missing parameter: name');
    }

    const baseURL = 'https://www.wcostream.tv/';

    const episodeName = body.name.replace(baseURL, '');

    await this.appService.getSingleEpisode(episodeName);
  }

  @Post('process-anime')
  async processShow(@Body() body: ProcessShow) {
    if (isProd) {
      const folderPath = `${outputBase}/${body.name}/`;
      const uid = process.env.PUID;
      const gid = process.env.PGID;

      await new Promise((resolve) => {
        addFilePermissions(folderPath, '775', uid, gid, resolve);
      });

      await triggerSonarImport(folderPath);
    }
  }
}

async function addFilePermissions(folderPath, permissions = '755', uid, gid, resolve) {
  // Arguments for the shell script
  const directoryPath = folderPath;
  const filePermissions = permissions;
  const user = uid;
  const group = gid;

  const bashScript = path.resolve(__dirname, 'change-permissions.sh');

  // Command to execute the shell script
  const command = `bash ${bashScript} ${directoryPath} ${filePermissions} ${user} ${group}`;

  // Execute the command
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error: ${error.message}`);
      return;
    }

    if (stderr) {
      console.error(`stderr: ${stderr}`);
      return;
    }

    console.log(`stdout: ${stdout}`);
    resolve(); // Resolve the Promise when the command completes
  });
}

async function triggerSonarImport(folderPath) {
  const apiUrl = 'http://192.168.1.48:8989/api/v3/command';

  fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': "70f3774d71c647dba9dee2ece98157a1"
    },
    body: JSON.stringify({
      name: 'DownloadedEpisodesScan',
      path: folderPath,
    })
  })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      console.log('Manual import initiated successfully: ', data.status);
    })
    .catch(error => {
      console.error('Error initiating manual import:', error.message);
    });
}