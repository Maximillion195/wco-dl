import { Body, Controller, Get, Post } from '@nestjs/common';
import { AppService } from './app.service';
import { CreateShow } from './show.dto';
const { spawn } = require('child_process');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

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

      // Find all 'a' tags within the 'top-ranking-table' class
      // const aTags = $('.ddmcc');

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
    console.log(`Downloading: ${body.name}`)

    // Replace 'your_python_script.py' with the actual name of your Python script
    const pythonScript = path.resolve(__dirname, '../../__main__.py');
    console.log(__dirname)

    const inputUrl = `-i https://www.wcostream.tv/anime/${body.name}`;
    const seasonOption = body.season ? `-se ${body.season}` : '';
    const episodeOption = body.episode ? `-epr ${body.episode}` : '';
    const qualityOption = '-hd';
    const threadsAmount = '-t 4';
    const outputOption = `-o "/data/torrents/completed/${body.name}/"`;

    const pythonCommand = `python ${pythonScript} ${inputUrl} ${seasonOption} ${episodeOption} ${qualityOption} ${outputOption} ${threadsAmount}`;

    // Use spawn for real-time output
    const child = spawn(pythonCommand, { shell: true });

    // Capture and log the stdout
    child.stdout.on('data', (data) => {  
      const apiUrl = 'http://192.168.1.48:8989/api/manualimport';

      fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': "70f3774d71c647dba9dee2ece98157a1"
        },
      })
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
          }
          return response.json();
        })
        .then(data => {
          console.log('Manual import initiated successfully:', data);
        })
        .catch(error => {
          console.error('Error initiating manual import:', error.message);
        });

      console.log(`Output: ${data}`);
    });

    // Listen for the exit event
    child.on('exit', (code) => {
      console.log(`Python script exited with code ${code}`);
    });

    // return this.appService.getHello();
  }
}
