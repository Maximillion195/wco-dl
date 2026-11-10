# Wco-DL [![GitHub release](https://img.shields.io/github/release/Maximillion195/wco-dl.svg?style=flat-square)](https://github.com/Maximillion195/wco-dl/releases/latest) | [![Github All Releases](https://img.shields.io/github/downloads/Maximillion195/wco-dl/total.svg?style=flat-square)](https://github.com/Maximillion195/wco-dl/releases)

wco-dl is a Command-line program and web application to download cartoons/anime/movies from WCOStream.com.

> Downloading and distributing this content may be illegal. This script was written for education purposes purely and you are responsible for its use.

> Support these cartoon/anime streaming websites by buying a premium account and registering!

## Quick Start with Docker

The easiest way to run WCO-DL is with Docker Compose:

```bash
# Copy environment file
cp .env.example .env

# Edit .env with your settings (OUTPUT_DIR at minimum)
nano .env

# Start the services
docker-compose up -d

# Access the web interface at http://localhost:3000
```

See [DOCKER.md](DOCKER.md) for detailed setup instructions.

## Features

- **Web Interface**: Browse and download anime/cartoons with a modern web UI
- **Command Line**: Download specific episodes or entire series via CLI
- **Multiple Quality Options**: Supports 480p, 720p, and 1080p downloads
- **Resume Downloads**: Automatically resumes interrupted downloads
- **Parallel Downloads**: Download multiple episodes simultaneously
- **Sonarr Integration**: Automatically import downloaded content to your media library
- **Content Types**: Download dubbed anime, subbed anime, cartoons, movies, and OVAs
- **Batch Downloads**: Select several shows in the web UI and download them together
- **Webhook Notifications**: Get a POST request when a download finishes

## What's New

- **Quality Selection**: Choose 480p, 720p, or 1080p from the web UI or with the `quality` API parameter (default `720`). `480` downloads the SD stream; `720` and `1080` both request the best HD stream WCO offers for that episode.
- **Batch Downloads**: The web UI lets you select multiple shows and download them together. The API equivalent is `POST /download-batch` (up to 50 names per request). Every name is validated before any download starts, so one typo won't leave half a batch running.
- **Webhook Notifications**: Register webhook URLs that receive a POST when a download finishes, whether it completed, failed, or timed out. Webhooks can be managed through the API or preset with the `WEBHOOK_URLS` environment variable (comma-separated). Up to 20 can be registered.
- **Enhanced Download Queue**: The web UI queue shows a status icon per download (running, completed, failed, timed out), progress details, and the error message when something goes wrong.
- **Subbed Anime Support**: Downloads started from the Subbed tab now fetch the subbed episodes. The API takes a `language` parameter (`sub` or `dub`).
- **Bug Fixes**:
  - The Python downloader now exits with code `1` when a download fails (invalid link, no episodes found, or an episode that couldn't be downloaded), so the server and scripts can detect failures.
  - Titles that start with a digit, such as `1-happy-family-usa`, are now recognised.

## Web API

The Node.js server (port 3000 by default) exposes these endpoints. Download requests return `202 Accepted` immediately with a job object; poll `GET /downloads/:id` to follow it.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/download-anime` | Download a whole show |
| `POST` | `/download-batch` | Download several shows at once |
| `POST` | `/download-single-episode` | Download one episode |
| `GET` | `/downloads` | List download jobs |
| `GET` | `/downloads/:id` | Get one download job |
| `GET` | `/webhooks` | List registered webhooks |
| `POST` | `/webhooks` | Register a webhook |
| `DELETE` | `/webhooks/:url` | Remove a webhook |

The `/download-anime` and `/download-batch` requests accept these optional parameters:

| Parameter | Values | Default |
| --- | --- | --- |
| `season` | Season number, e.g. `"2"` | All seasons |
| `episode` | Episode range, e.g. `"1-10"` | All episodes |
| `newest` | `true` / `false` | `false` |
| `quality` | `"480"`, `"720"`, `"1080"` | `"720"` |
| `language` | `"sub"`, `"dub"` | The show's default |

**Download a show in 1080p:**

```bash
curl -X POST http://localhost:3000/download-anime \
  -H 'Content-Type: application/json' \
  -d '{"name": "cool-show-name-here", "season": "2", "episode": "1-10", "quality": "1080"}'
```

**Download the subbed version of a show:**

```bash
curl -X POST http://localhost:3000/download-anime \
  -H 'Content-Type: application/json' \
  -d '{"name": "cool-show-name-here", "language": "sub", "quality": "720"}'
```

**Batch download several shows** (the other parameters apply to every show):

```bash
curl -X POST http://localhost:3000/download-batch \
  -H 'Content-Type: application/json' \
  -d '{"names": ["1-happy-family-usa", "cool-show-name-here"], "quality": "480", "newest": true}'
```

This returns an array of job objects, one per show.

**Download a single episode:**

```bash
curl -X POST http://localhost:3000/download-single-episode \
  -H 'Content-Type: application/json' \
  -d '{"name": "cool-show-name-here-episode-2-english-dubbed"}'
```

**Register a webhook** (must be an `http` or `https` URL; returns `201` with the full list, or `409` if the URL is already registered):

```bash
curl -X POST http://localhost:3000/webhooks \
  -H 'Content-Type: application/json' \
  -d '{"url": "http://example.com/hook"}'
```

**List webhooks:**

```bash
curl http://localhost:3000/webhooks
```

**Remove a webhook.** The URL must be percent-encoded so it fits in one path segment (`encodeURIComponent` in JavaScript). Returns `204` on success or `404` if it wasn't registered:

```bash
curl -X DELETE http://localhost:3000/webhooks/http%3A%2F%2Fexample.com%2Fhook
```

When a download finishes, each webhook receives a JSON POST like this (`status` is `completed`, `failed`, or `timed_out`; `error` is only set when it didn't complete):

```json
{
  "id": "3f1c2a9e-...",
  "name": "cool-show-name-here",
  "status": "failed",
  "url": "https://www.wcostream.tv/anime/cool-show-name-here",
  "outputFolder": "/downloads/cool-show-name-here/",
  "error": "Process exited with code 1"
}
```

Webhook calls time out after 10 seconds, and a failing webhook is logged without affecting the download.

## Architecture

WCO-DL consists of:
- **Python Backend**: Core scraping and downloading logic
- **Node.js API Server**: Web API and orchestration layer
- **Byparr**: Cloudflare bypass service for accessing protected pages
- **Web UI**: Browse and download from your browser

Please go check out the wiki as it is indepth on what this script does.

## Table of Contents

* [To-Do](#to-do)
* [What's New](#whats-new)
* [Web API](#web-api)
* [Dependencies Installation](#dependencies-installation)
* [Installation](#installation)
* [Python Support](#python-support)
* [Windows Binary](#windows-binary)
* [List of Arguments](#list-of-arguments)
* [Usage](#usage)
    * [Windows](#windows)
    * [Linux/Debian](#linuxdebian)
    * [Example Commands](#example-commands)
    * [Example URLs](#example-urls)
* [Features](#features)
* [Opening An Issue/Requesting A Site](#opening-an-issuerequesting-a-site)
    * [Reporting Issues](#reporting-issues)
    * [Suggesting A Feature](#suggesting-a-feature)

## Dependencies Installation
This script can run on multiple Operating Systems. But, the script depends on some external binaries or libs.

**`These dependencies are required on ALL the operating systems, ALL!.`**

1.) Make sure you have Python installed and is present in your system's path.

2.) Browse to the directory of this script and open command prompt/shell in that directory and run this command :

```
python3 -m pip install -r requirements.txt
```

3.) (Optional) If Cloudflare blocks requests, wco-dl retries them through a [Byparr](https://github.com/ThePhaseless/Byparr) instance. Point it at yours with the `BYPARR_URL` environment variable (default `http://localhost:8191`).

## Installation
After installing and setting up all the dependencies in your Operating System, you're good to go and use this script.
The instructions for all the OS would remain same. Download this reposititory and put it somewhere in your system.

**Windows users**, it's better to not place it places where it requires administrator privileges. Good example of places to avoid would be `C:\Windows` etc.. This goes for both, the Python script and the windows binary file (.exe).

**Linux/Debian** users make sure that this script is executable.Just run this command, if you run into problem(s) :

`chmod +x __main__.py`

and then, execute with this :

`./__main__.py`

## Python Support
- [ ] Python 2.7 or earlier (Will not support)
- [x] Python 3.5 or newer

## Windows Binary
It is recommended that windows users use this binary to save both, your head and time from installing all the dependencies. 

Go download this binary and start using the script right off the bat:
* `Binary (x64)` : [Click Here](https://github.com/EpicUnknown/wco-dl/releases/latest)


## List of Arguments
Currently, the script supports these arguments :
```
-h, --help                             Prints the basic help menu of the script and exits.
-i,--input                             Defines the input link to the show. [REQUIRED]
--version                              Prints the VERSION and exits.
-q,--quality                           Video quality: 480, 720 or 1080 (Default = 480). 480 picks the SD source; 720 and 1080 both pick the best HD source the episode offers (1080 when available, otherwise 720).
--lang,--language                      Audio language for shows that offer both: dub or sub (Default = dub). Only applies to show URLs, not single episodes.
-hd,--highdef                          [Legacy] Same as -q 720. Use -q/--quality instead.
--quiet                                Does not show download progress. (This used to be -q, which is now --quality.)
-v,--verbose                           Starts Verbose Logging for detailed information.
-o,--ouput                             Specifies download location
-se,--season                           Selects the season to download of a show (Default = All)
-epr,--episoderange                    Selects the range of episodes to download (Default = All) [ Ex : --range 1-10 (This will download first 10 episodes of ALL Seasons!)]
-x,--exclude                           Specifies what shows not to download [Ex: -x ova,special will make it so no ova or special episodes are downloaded]
-n,--newest                            Downloads the newest episode of the show given.
-sh, --show_downloaded_animes          Show all downloaded shows and episodes.
-us, --update_shows                    Update all shows in your database that have new episodes.
-b, --batch                            Batch download, download multiple anime [Ex : -b ./shows.txt (a text file with one show per line, either a show name such as naruto or a full wcostream URL)].
-t, --threads                          This will create multiple threads, in other words download multiple episodes at ones [Ex : -t 4 (Number of threads to create).
```

### Examples
```
# Download in 1080p
./wco-dl -i https://www.wcostream.tv/anime/naruto -q 1080

# Download subbed anime
./wco-dl -i https://www.wcostream.tv/anime/bleach --lang sub

# Batch download with names
echo -e "naruto\nbleach\none-piece" > shows.txt
./wco-dl -b shows.txt --lang dub -q 720
```

### Batch file format
One show per line. Each line is either a show name (the slug from the show's URL, e.g. `naruto` for `https://www.wcostream.tv/anime/naruto`) or a full show URL. Blank lines and lines starting with `#` are skipped. `-q`, `--lang`, `-se`, `-epr`, `-x`, `-o` and `-t` apply to every show in the file.
```
naruto
bleach
https://www.wcostream.tv/anime/one-piece
```

## Usage
With this script, you have to pass arguments in order to be able to download anything. Passing arguments in a script is pretty easy. Since the script is pretty basic, it doesn't have too many arguments. Go check the [`ARGUMENTS SECTION`](https://github.com/EpicUnknown/wco-dl#list-of-arguments) to know more about which arguments the script offers.

Default Download Location will be the directory in which you run this script. Inside of an Output folder will be each of the show names you have downloaded.

Follow the instructions according to your OS :

### Windows
After you've saved this script in a directory/folder, you need to open `command prompt` and browse to that directory and then execute the script. Let's do it step by step :
* Open the folder where you've downloaded the files of this repository.
* Hold down the **`SHIFT`** key and while holding down the SHIFT key, **`RIGHT CLICK`** and select `Open Command Prompt Here` from the options that show up. <sup>*PowerShell users see below*</sup>
* Now, in the command prompt, type this :

*If you're using the windows binary :*

`wco-dl.exe -i "<URL TO THE SHOW>"`

*If you're using the Python Script :*

`__main__.py -i "<URL TO THE SHOW>"`


### Linux/Debian
After you've saved this script in a directory/folder, you need to open `command prompt` and browse to that directory and then execute the script. Let's do it step by step :
* Open a terminal, `Ctrl + Alt + T` is the shortcut to do so (if you didn't know).
* Now, change the current working directory of the terminal to the one where you've downloaded this repository.
* Now, in the Terminal, type this :

`__main__.py -i "<URL TO THE SHOW>"`

### Example Commands
`__main__.py -i "<Whole Show URL>" -x special,ova -se 2 -epr 1-10` - Download Episodes 1-10 in Season 2 minus specials and ovas

`__main__.py -i "<Single Episode URL>" -o "/home/username/shows/showname` - Download to a specific path!

`__main__.py -i "<Whole Show URL>" -epr 1-10` - Download Episodes 1-10 in ALL seasons

`__main__.py -i "<Whole Show URL>" -se 2` - Download entire of Season 2

`__main__.py -i "<Whole Show URL>" -se 2 -epr 5` - Download Episode 5 of Season 2

`__main__.py -i "<Whole Show URL>" -epr L5` - Get the newest five episodes of the series

### Example URLs
* WCOStream :
    * Single Episode : (https://www.wcostream.com/cool-show-name-here-episode-17-english-subbed)
    * Whole Show : (https://www.wcostream.com/anime/cool-show-name-here-english-subbed)

## Features
This is a very basic and small script, so at the moment it only have a few features.
* Downloads a Single episode
* Downloads and puts them all in a directory named "Output".
* Downloads all the episodes for a show available on WCO Stream.

## Opening An Issue/Requesting A Site
If your're planning to open an issue for the script or ask for a new feature or anything that requires opening an Issue, then please do keep these things in mind.

### Reporting Issues
PLEASE RUN THIS SCRIPT IN A COMMAND LINE (as mentioned in the Usage section) AND DON'T SAY THAT `THE SCRIPT CLOSED TOO QUICK, I COULDN'T SEE`. If something doesn't work like it's supposed to, run the command with the `--verbose` argument. It'll create a `Error Log.txt` file in the same directory. Upload the content of that file on Github Gists/Pastebin etc. and share that link.

If you're here to report an issue, please follow the basic syntax to post a request :

**Subject** : Error That You Get.

**Command Line Arguments You Gave** : The whole command that you gave to execute/run this script.

**Verbose Log Link** : Link to the Gist/Pastebin that holds the content of Error Log.txt.

**Long Explanation** : Describe in details what you saw, what should've happened and what actually happened.

This should be enough, but it'll be great if you can add more
 
### Suggesting A Feature
If you're here to make suggestions, please follow the basic syntax to post a request :

**Subject** : Something that briefly tells us about the feature.

**Long Explanation** : Describe in details what you want and how you want.

This should be enough, but it'll be great if you can add more
