import { Injectable } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import * as path from 'path';
const { spawn } = require('child_process');
const { exec } = require('child_process');

const isProd = process.env.NODE_ENV === 'production';
const outputBase = isProd ? '/data/torrents/completed' : './output';

@Injectable()
export class AppService {
  async getAllDubbedAnimes() {
    const requestData = {
      cmd: 'request.get',
      url: 'https://www.wcostream.tv/dubbed-anime-list/',
      maxTimeout: 60000,
    };

    const response = await axios.post(
      'http://192.168.1.48:8191/v1',
      requestData,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    const $ = cheerio.load(response.data.solution.response);

    // Array to store inner HTML of hrefs starting with "/anime"
    const animePaths = [];

    // Select href attributes starting with "/anime" and get inner HTML
    $('a[href^="/anime"]').each((index, element) => {
      const name = $(element).html();
      const path = $(element)
        .attr('href')
        .replace('/anime', '')
        .replace('/', ''); // Remove "/anime"
      animePaths.push({
        name,
        path,
      });
    });

    return animePaths;
  }

  extractTitle(url) {
    const parts = url.split('-episode-');
    return parts[0];
  }

  async getSingleEpisode(name: string) {
    const pythonScript = path.resolve(__dirname, '../../__main__.py');

    const animeTitle = this.extractTitle(name);

    const inputUrl = `-i https://www.wcostream.tv/${name}`;
    const threadsAmount = '-t 2';
    const outputFolder = `${outputBase}/${animeTitle}/`;
    const outputOption = `-o "${outputFolder}"`;

    const pythonCommand = `python ${pythonScript} ${inputUrl} ${outputOption} ${threadsAmount}`;

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
        const folderPath = outputFolder;
        const uid = process.env.PUID;
        const gid = process.env.PGID;

        await new Promise((resolve) => {
          addFilePermissions(folderPath, '775', uid, gid, resolve);
        });

        await triggerSonarImport(folderPath);
      }
    });
  }
}

async function addFilePermissions(
  folderPath,
  permissions = '755',
  uid,
  gid,
  resolve,
) {
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
      'X-Api-Key': '70f3774d71c647dba9dee2ece98157a1',
    },
    body: JSON.stringify({
      name: 'DownloadedEpisodesScan',
      path: folderPath,
    }),
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      return response.json();
    })
    .then((data) => {
      console.log('Manual import initiated successfully: ', data.status);
    })
    .catch((error) => {
      console.error('Error initiating manual import:', error.message);
    });
}