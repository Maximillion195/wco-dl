import { Body, Controller, Get, Post } from '@nestjs/common';
import { AppService } from './app.service';
import { CreateShow } from './show.dto';
const { spawn } = require('child_process');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const isProd = process.env.NODE_ENV === 'production';
const outputBase = isProd ? "/data/torrents/completed" : "./output";

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get("get-website")
  getWebsite() {
    return "https://www.wcostream.tv/"
  }

  @Get("get-all-dubbed-anime-names")
  async getAllDubbedAnimes() {
    const requestData = {
      cmd: 'request.get',
      url: 'https://www.wcostream.tv/dubbed-anime-list/',
      maxTimeout: 60000
    };

    const response = await axios.post('http://192.168.1.48:8191/v1', requestData, {
      headers: {
        'Content-Type': 'application/json'
      }
    })
    
      const $ = cheerio.load(response.data.solution.response);

      // Array to store inner HTML of hrefs starting with "/anime"
      const animePaths = [];

      // Select href attributes starting with "/anime" and get inner HTML
    $('a[href^="/anime"]').each((index, element) => {
        const name = $(element).html();  
        const path = $(element).attr('href').replace('/anime', '').replace('/', ''); // Remove "/anime"
        animePaths.push({
          name,
          path,
          });
        });

    return animePaths
  }
    
  @Post("download-anime")
  getShow(@Body() body: CreateShow) {
    const pythonScript = path.resolve(__dirname, '../../__main__.py');

    const inputUrl = `-i https://www.wcostream.tv/anime/${body.name}`;
    const seasonOption = body.season ? `-se ${body.season}` : '';
    const episodeOption = body.episode ? `-epr ${body.episode}` : '';
    const qualityOption = '-hd';
    const threadsAmount = '-t 1';
    const outputOption = `-o "${outputBase}/${body.name}/"`;

    const pythonCommand = `python ${pythonScript} ${inputUrl} ${seasonOption} ${episodeOption} ${qualityOption} ${outputOption} ${threadsAmount}`;

    console.log(pythonCommand)
    
    // Use spawn for real-time output
    const child = spawn(pythonCommand, { shell: true, encoding: 'utf-8' });

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
      console.log(`${data}`);
      // Reset the timeout on receiving data
      clearTimeout(timeoutId);
      timeoutId = setTimeout(handleTimeout, timeout);
    });

    // Listen for the exit event
    child.on('exit', (code) => {
      clearTimeout(timeoutId); // Clear the timeout if the process exits before the timeout
      if (isProd) {
        triggerSonarImport();
      }
    });

    // return this.appService.getHello();
  }
}

function triggerSonarImport() {
  const apiUrl = 'http://192.168.1.48:8989/api/v3/command';

  fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': "70f3774d71c647dba9dee2ece98157a1"
    },
    body: JSON.stringify({
      name: 'DownloadedEpisodesScan',
      path: `${outputBase}/`
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