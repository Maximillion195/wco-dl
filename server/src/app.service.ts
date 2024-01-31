import { Injectable } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';

@Injectable()
export class AppService {
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
}
