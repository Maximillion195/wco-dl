#!/usr/bin/env python
# -*- coding: utf-8 -*-

import os
import re
import sys
import time
import base64
import logging
import secrets
import threading
import requests
import urllib3
from urllib.parse import urljoin, urlsplit, urlunsplit, parse_qs, urlencode, quote
from bs4 import BeautifulSoup
from cloudscraper.exceptions import CloudflareException
from Byparr import Byparr, ByparrError
from Downloader import Downloader, create_session
from Process import ProcessParallel

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

log = logging.getLogger('wco-dl')

# Episode pages list a show's episodes in a sidebar (oldest first); show pages use
# dark-episode-item (newest first); 'sonra' is the pre-2025 layout.
EPISODE_LINK_CLASSES = ('sidebar-episode-item', 'dark-episode-item', 'sonra')
PREMIUM_MARKERS = ('this video is for the wco premium users only', 'this video is for premium users')
CLOUDFLARE_MARKERS = ('cf-chl', 'cf_chl', 'Just a moment...', 'challenge-platform/h/')
# The embed page shows a 10 second ad countdown before redirecting to the real player.
AD_GATE_WAIT = 11

# TODO: Make it track missed episodes and retry when done

class Lifter(object):

    def __init__(self, url, resolution, logger, season, ep_range, exclude, output, newest, settings, database, quiet,update=False, threads=None, language=None):
        if language:
            if '/anime/' in urlsplit(url).path:
                url = self.with_language(url, language)
            else:
                print('[wco-dl] - --lang only applies to show URLs, ignoring it for {0}'.format(url))

        # Define our variables
        self.url = url
        self.resolution = resolution
        self.logger = logger
        self.season = season
        self.ep_range = ep_range
        self.exclude = exclude
        self.newest = newest
        self.settings = settings
        self.database = database
        self.update = update
        self.threads = threads
        self.original_thread = self.threads
        self.quiet = quiet
        self.downloaded = 0
        self.download_errors = 0
        # Premium-only episodes can't be downloaded at all, so they aren't errors.
        self.skipped_premium = 0
        self._count_lock = threading.Lock()
        
        if output is None:
            self.output = ""
        else:
            if output == ".":
                self.output = os.getcwd()
            else:
                self.output = output

        self.session = create_session()
        self.byparr = Byparr()
        self.user_agent = self.session.headers['User-Agent']
        self.header = {
            'User-Agent': self.user_agent, 'Accept': '*/*', 'Referer': url, 'X-Requested-With': 'XMLHttpRequest'
        }
        parts = urlsplit(url)
        self.base_url = "{0}://{1}".format(parts.scheme, parts.netloc) if parts.netloc else "https://www.wcostream.tv"
        self.path = os.path.dirname(os.path.realpath(__file__))

        # Check if the URL is valid
        valid_link, extra = self.is_valid(self.url)

        if valid_link:
            # Check to see if we are downloading a single episode or multiple
            self.database.add_new_anime_to_database(self.url)
            if extra[0] == "anime/":
                # We are downloading multiple episodes
                print("Downloading show")
                self.download_show(url)
            else:
                # We are downloading a single episode
                print('Downloading single')
                self.download_single(url, extra)
            print('[wco-dl] - {0} episode(s) downloaded, {1} premium-only skipped.'.format(
                self.downloaded, self.skipped_premium))
            if self.download_errors > 0:
                print('[wco-dl] - {0} episode(s) failed to download.'.format(self.download_errors))
                sys.exit(1)
        else:
            # Not a valid wcostream link
            print(extra)
            sys.exit(1)

    def check_output(self, anime_name):
        output_directory = os.path.abspath("Output" + os.sep + str(anime_name) + os.sep)
        if self.output != "":
            output_directory = self.output.translate(str.maketrans({'\\': os.sep, '/': os.sep}))
        if not os.path.exists(self.output):
            if not os.path.exists("Output"):
                os.makedirs("Output")
            if not os.path.exists(output_directory):
                os.makedirs(output_directory)
        else:
            output_directory = self.output.translate(str.maketrans({'\\': os.sep, '/': os.sep}))
        return output_directory

    def request_c(self, url, extraHeaders=None):
        myheaders = {
            'Accept': 'text/html,application/xhtml+xml,application/xml,application/json;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'DNT': '1'
        }
        if extraHeaders:
            myheaders.update(extraHeaders)

        try:
            response = self.session.get(url, headers=myheaders, timeout=30)
        except CloudflareException as e:
            log.warning('cloudscraper could not solve the Cloudflare challenge for %s: %s', url, e)
            response = None

        if response is not None and not self._is_cloudflare_block(response):
            return response
        return self._request_via_byparr(url, myheaders, response)

    @staticmethod
    def _is_cloudflare_block(response):
        if response.status_code not in (403, 429, 503):
            return False
        if response.headers.get('cf-mitigated') == 'challenge':
            return True
        return any(marker in response.text for marker in CLOUDFLARE_MARKERS)

    def _request_via_byparr(self, url, headers, blocked_response):
        print('[wco-dl] - Cloudflare blocked {0}, retrying through Byparr at {1}'.format(url, self.byparr.endpoint))
        try:
            solution = self.byparr.get(url)
        except ByparrError as e:
            print('[wco-dl] - Byparr fallback failed: {0}'.format(e))
            if blocked_response is not None:
                return blocked_response
            raise

        # Reuse Byparr's clearance cookies so follow-up requests (which may need headers
        # Byparr can't send, e.g. Referer) go through the normal session.
        Byparr.apply_to_session(solution, self.session)
        try:
            retry = self.session.get(url, headers=headers, timeout=30)
            if not self._is_cloudflare_block(retry):
                return retry
        except (CloudflareException, requests.RequestException) as e:
            log.debug('Retry after Byparr cookie import failed for %s: %s', url, e)
        log.debug('Using the HTML rendered by Byparr for %s', url)
        return self._response_from_solution(url, solution)

    @staticmethod
    def _response_from_solution(url, solution):
        response = requests.models.Response()
        response.status_code = int(solution.get('status') or 200)
        # Byparr reports 200 for plain server error pages such as nginx's "403 Forbidden".
        error_title = re.search(r'<title>([45]\d\d) [^<]*</title>', solution['response'][:500])
        if error_title:
            response.status_code = int(error_title.group(1))
        response.url = solution.get('url') or url
        response.headers = requests.structures.CaseInsensitiveDict(solution.get('headers') or {})
        response.encoding = 'utf-8'
        response._content = solution['response'].encode('utf-8')
        return response

    def get_episode_page(self, url):
        page = self.request_c(url)
        if not page.ok:
            raise Exception('Episode page {0} returned HTTP {1}'.format(url, page.status_code))
        return BeautifulSoup(page.text, 'html.parser')

    def check_for_premium(self, url, soup=None):
        if soup is None:
            soup = self.get_episode_page(url)
        page_text = soup.get_text().lower()
        return any(marker in page_text for marker in PREMIUM_MARKERS)

    def find_download_link(self, url):
        return self.get_download_url(self.find_hidden_url(url), referer=url)

    def find_hidden_url(self, url, soup=None):
        if soup is None:
            soup = self.get_episode_page(url)

        iframe = (soup.find('iframe', id='frameNewcizgifilmuploads0')
                  or soup.find('iframe', id=re.compile(r'^frameNewcizgifilmuploads'))
                  or soup.find('iframe', attrs={'data-type': 'wco-embed'}))
        if iframe is None:
            iframe = self._find_legacy_iframe(soup)
        if iframe is None or not iframe.get('src'):
            raise Exception('No video player iframe found on {0} (episode may be premium-only or removed)'.format(url))
        return urljoin(url, iframe['src'])

    def _find_legacy_iframe(self, soup):
        meta = soup.find("meta", {"itemprop": "embedURL"})
        if meta is None or meta.previous_element is None:
            return None
        iframe_encoded = repr(meta.previous_element)
        tag_match = re.search("^<([a-zA-Z]*)", iframe_encoded)
        tag = tag_match.group(1) if tag_match else ''
        if tag == 'script':
            iframe_decoded = self._decode_iframe(iframe_encoded)
        elif tag == 'iframe':
            iframe_decoded = iframe_encoded
        else:
            return None
        return BeautifulSoup(iframe_decoded, 'html.parser').find('iframe')

    def resolve_episode(self, url):
        """Return (source_urls, backup_url, hidden_url) for an episode, or None if it is premium-only."""
        soup = self.get_episode_page(url)
        if self.check_for_premium(url, soup):
            print('[wco-dl] - Skipping {0}, it is only available to WCO Premium users.'.format(url))
            return None
        hidden_url = self.find_hidden_url(url, soup)
        source_urls, backup_url = self.get_download_url(hidden_url, referer=url)
        return source_urls, backup_url, hidden_url

    def select_download_url(self, source_urls):
        # source_urls is ordered from lowest to highest quality.
        if self.resolution == '480':
            return source_urls[0][1]
        return source_urls[-1][1]

    def download_episode(self, url):
        try:
            resolved = self.resolve_episode(url)
        except Exception as e:
            print('[wco-dl] - Could not find a video for {0}: {1}'.format(url, e))
            log.debug('Failed to resolve %s', url, exc_info=True)
            self._count('download_errors')
            return
        if resolved is None:
            self._count('skipped_premium')
            return
        source_urls, backup_url, hidden_url = resolved
        download_url = self.select_download_url(source_urls)
        show_info = self.info_extractor(url)
        output = self.check_output(show_info[0])

        # The getvid tokens only work with the User-Agent that fetched getvidlink.php (other UAs get a 404),
        # and a Byparr fallback may have replaced the session's User-Agent since __init__.
        user_agent = self.session.headers['User-Agent']
        download_header = {
            'User-Agent': user_agent,
            'Accept': 'video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5',
            'Accept-Language': 'en-US,en;q=0.5',
            'Referer': hidden_url,
            'Connection': 'keep-alive',
        }

        downloader = Downloader(logger=self.logger, download_url=download_url, backup_url=backup_url,
                                hidden_url=hidden_url, output=output, header=download_header, user_agent=user_agent,
                                show_info=show_info, settings=self.settings, quiet=self.quiet, session=self.session)
        self._count('download_errors' if downloader.failed else 'downloaded')

    def _count(self, counter):
        # Episodes are downloaded from several threads (-t).
        with self._count_lock:
            setattr(self, counter, getattr(self, counter) + 1)

    def _decode_iframe(self, encoded_iframe):
        array = encoded_iframe[encoded_iframe.find("[") + 1:encoded_iframe.find("]")].split(', ')
        magic_number = int(re.search(' - ([0-9]+)', encoded_iframe).group(1))
        iframe = ''
        for item in array:
            decoded = base64.b64decode(item).decode('utf8')
            numbers = re.sub('[^0-9]+', '', decoded)
            iframe += chr(int(numbers) - magic_number)
        return iframe

    def download_single(self, url, extra):
        self.download_episode(url)

    def test(self, i, ii):
        print(i, ii)

    def extract_episode_links(self, soup, page_url):
        """Return absolute episode URLs, newest first."""
        anchors = []
        css_class = None
        for css_class in EPISODE_LINK_CLASSES:
            anchors = [a for a in soup.find_all('a', class_=css_class) if a.get('href')]
            if anchors:
                break
        if not anchors:
            return []

        lang = self.language_filter(page_url, anchors)
        links = []
        for anchor in anchors:
            if lang and anchor.get('data-lang') and anchor['data-lang'] != lang:
                continue
            link = urljoin(page_url, anchor['href'])
            if link not in links:
                links.append(link)
        if css_class == 'sidebar-episode-item':
            links.reverse()
        log.debug('Found %d episode links via .%s (lang=%s)', len(links), css_class, lang)
        return links

    @staticmethod
    def with_language(url, language):
        parts = urlsplit(url)
        query = parse_qs(parts.query, keep_blank_values=True)
        query['lang'] = [language]
        return urlunsplit(parts._replace(query=urlencode(query, doseq=True)))

    @staticmethod
    def language_filter(page_url, anchors):
        """Pick which data-lang to keep when a show page lists both dubbed and subbed episodes."""
        langs = {a.get('data-lang') for a in anchors if a.get('data-lang')}
        if len(langs) < 2:
            return None
        parts = urlsplit(page_url)
        requested = parse_qs(parts.query).get('lang', [None])[0]
        if requested in langs:
            return requested
        if parts.path.rstrip('/').endswith('-english-subbed') and 'sub' in langs:
            return 'sub'
        if 'dub' in langs:
            print('[wco-dl] - This show has dubbed and subbed episodes, downloading dubbed. '
                  'Add ?lang=sub to the show URL to download subbed instead.')
            return 'dub'
        return None

    def download_show(self, url):
        page = self.request_c(url)
        soup = BeautifulSoup(page.content, 'html.parser')
        ep_range = self.ep_range
        links = self.extract_episode_links(soup, page.url or url)
        if not links:
            print('[wco-dl] - No episodes found on {0} (HTTP {1}).'.format(url, page.status_code))
            self._count('download_errors')
            return
    
        if self.exclude is not None:
            excluded = [i for e in self.exclude for i in links if re.search(e, i)]
            links = [item for item in links if item not in excluded]

        season = "season-" + self.season

        if self.update == True:
            links = links[0:1]

        # __main__ passes '-epr 2-5' as ['2', '5'] and '-epr 3' as '3'; normalise both to 'start-end'.
        if isinstance(ep_range, (list, tuple)):
            ep_range = '-'.join(ep_range)
        if ep_range not in ('All', 'l5', 'L5') and '-' not in ep_range:
            ep_range = '{0}-{0}'.format(ep_range)

        if ep_range == 'l5' or ep_range == 'L5':  # L5 (Last five)
            links = links[:5]
            ep_range = 'All'
            season = 'season-All'

        if self.newest:  # True or False
            links = links[0:1]
            ep_range = 'All'
            season = 'season-All'

        if season != "season-All" and ep_range != "All":
            start_ep, end_ep = map(int, ep_range.split('-'))
            episodes = ["episode-{0}".format(n) for n in range(start_ep, end_ep + 1)]
            if season == 'season-1':
                matching = [s for s in links if 'season' not in s or f"{season}-" in s]
            else:
                matching = [s for s in links if f"{season}-" in s]
            matching = [s for s in matching for i in episodes if i == self.episode_slug(s)]
        elif season != "season-All":
            if season == 'season-1':
                matching = [s for s in links if 'season' not in s or f"{season}-" in s]
            else:
                matching = [s for s in links if f"{season}-" in s]
        elif ep_range != 'All':
            start_ep, end_ep = map(int, ep_range.split('-'))
            episodes = ["episode-{0}".format(n) for n in range(start_ep, end_ep + 1)]
            matching = [s for s in links for i in episodes if re.search("{0}-".format(i), s)]
        else:
            matching = links

        if len(matching) < 1:
            matching.reverse()
        if (self.threads != None and self.threads != 0):
            if (len(matching) == 1):
                for item in matching:
                    self.download_episode(item)
            else:
                count = 0
                while (True):
                    processes_count = 0
                    processes = []
                    processes_url = []
                    processes_extra = []
                    
                    if (int(self.threads) > len(matching)):
                        print('To many threads, setting threads to deafult amount.')
                        self.threads = 3
                    
                    procs = ProcessParallel(print('Threads started', end='\n\n'))
                    for x in range(int(self.threads)):
                        try:
                            item = matching[count]
                            _, extra = self.is_valid(item)
                            processes.append(self.download_single)
                            processes_url.append(item)
                            processes_extra.append(extra)
                            count += 1
                        except Exception as e:
                            if self.logger == 'True':
                                print('Error: {0}'.format(e))
                            pass
                    for x in processes:
                        procs.append_process(x, url=processes_url[processes_count], extra=processes_extra[processes_count])
                        processes_count+=1

                    if ('' in processes_extra):
                        self.threads = None
                        self.download_show(url)
                        break
                        
                    procs.fork_processes()
                    procs.start_all()
                    procs.join_all()
                    processes_url.clear()
                    processes_extra.clear()
                    processes.clear()
                    self.threads = self.original_thread
                    if (count >= len(matching)):
                        break
        else:
            for item in matching:
                self.download_episode(item)
            if (self.original_thread != None and self.original_thread != 0): 
                self.threads = self.original_thread

    @staticmethod
    def episode_slug(url):
        match = re.search(r'episode-[0-9]+', url)
        return match.group(0) if match else None

    @staticmethod
    def info_extractor(url):
        url = re.sub(r'^https?://[^/]+/', '', url)
        try:
            if "season" in url:
                show_name, season, episode, desc = re.findall(r'([a-zA-Z0-9].*)\s(season\s\d+\s?)(episode\s\d+\s)?(.+)',
                                                              url.replace('-', ' '))[0]
            else:
                show_name, episode, desc = re.findall(r'([a-zA-Z0-9].*)\s(episode\s\d+\s?)(.+)', url.replace(
                    '-', ' '))[0]
                season = "season 1"
        except:
            show_name = url
            season = "Season 1"
            episode = "Episode 0"
            desc = ""
        return show_name.title().strip(), season.title().strip(), episode.title().strip(), desc.title().strip(), url

    @staticmethod
    def is_valid(url):
        website = re.findall('https://(www.)?wcostream.tv/(anime/)?([a-zA-Z0-9].+$)?', url)
        if website:
            if website[0][1] == "anime/":
                return True, (website[0][1], website[0][2])
            return True, website[0][2]
        return False, '[wco-dl] Not correct wcostream website.'

    def get_download_url(self, embed_url, referer=None):
        embed_origin = '{0.scheme}://{0.netloc}'.format(urlsplit(embed_url))

        # Fast path: the player's getvidlink.php request can be rebuilt from the iframe's
        # query string, which skips the ad gate and works when the player page says the servers are busy.
        derived_path = self._derive_getvidlink_path(embed_url)
        if derived_path:
            try:
                return self._fetch_getvidlink(embed_origin, derived_path, embed_url)
            except Exception as e:
                log.debug('Derived getvidlink request failed for %s: %s', embed_url, e)
                if self.logger == 'True':
                    print('[wco-dl] - Direct source lookup failed ({0}), loading the embed page instead.'.format(e))

        page = self.request_c(embed_url, extraHeaders={'Referer': referer or self.base_url + '/'})
        html = page.text
        if 'AdGate' in html or 'video-js-old.php' in html:
            html = self._pass_ad_gate(embed_url, embed_origin, html)

        # Find the stream URLs.
        source_match = re.search(r'getJSON\("(.*?)"', html, re.DOTALL)
        if source_match and ('getvid?evid' in html or 'getvidlink' in html):
            # Query-style stream getting.
            return self._fetch_getvidlink(embed_origin, source_match.group(1), embed_url)

        sources_match = re.search(r'sources:\s*?\[(.*?)\]', html, re.DOTALL)
        if sources_match is None:
            raise Exception('No video sources found in embed page {0} (HTTP {1})'.format(embed_url, page.status_code))
        # Alternative video player page, with plain stream links in the JWPlayer javascript.
        stream_pattern = re.compile(r'\{\s*?file:\s*?"(.*?)"(?:,\s*?label:\s*?"(.*?)")?')
        source_urls = [
            # Order the items as (LABEL (or empty string), URL).
            (sourceMatch.group(2), sourceMatch.group(1))
            for sourceMatch in stream_pattern.finditer(sources_match.group(1))
        ]
        if not source_urls:
            raise Exception('Could not parse the video sources in embed page {0}'.format(embed_url))
        # Use the backup link in the 'onError' handler of the 'jw' player.
        backup_match = stream_pattern.search(html[html.find('jw.onError'):])
        backup_url = backup_match.group(1) if backup_match else ''
        return source_urls, backup_url

    @staticmethod
    def _derive_getvidlink_path(embed_url):
        params = parse_qs(urlsplit(embed_url).query)
        file_path = params.get('file', [None])[0]
        embed = params.get('embed', [None])[0]
        if not file_path or not embed:
            return None
        query = {'v': '{0}/{1}'.format(embed, re.sub(r'\.flv$', '.mp4', file_path)), 'embed': embed}
        if params.get('fullhd'):
            query['fullhd'] = params['fullhd'][0]
        return '/inc/embed/getvidlink.php?' + urlencode(query, quote_via=quote, safe='/')

    def _fetch_getvidlink(self, embed_origin, path, embed_url):
        response = self.request_c(
            urljoin(embed_origin + '/', path),
            extraHeaders={'Accept': '*/*', 'Referer': embed_url, 'X-Requested-With': 'XMLHttpRequest'}
        )
        if not response.ok:
            raise Exception('Sources XMLHttpRequest request failed with HTTP {0}'.format(response.status_code))
        json_data = response.json()

        # The player refuses to play when the server host has no subdomain (e.g. "https://.wcostream.com"):
        # that means the file is missing or every server is at capacity.
        server = json_data.get('server', '')
        server_host = urlsplit(server).hostname or ''
        if not server_host or server_host.startswith('.') or server_host.count('.') < 2:
            raise Exception('No stream server available (got server={0!r})'.format(server))

        # Only three qualities are ever available: 480p ("SD"), 720p ("HD") and 1080p ("FHD").
        source_urls = []
        sd_token = json_data.get('enc', '')
        hd_token = json_data.get('hd', '')
        fhd_token = json_data.get('fhd', '')
        source_base_url = server + '/getvid?evid='
        if sd_token:
            source_urls.append(('480 (SD)', source_base_url + sd_token))  # Order the items as (LABEL, URL).
        if hd_token:
            source_urls.append(('720 (HD)', source_base_url + hd_token))
        if fhd_token:
            source_urls.append(('1080 (FHD)', source_base_url + fhd_token))
        if not source_urls:
            raise Exception('Sources response contained no stream tokens')
        # Use the same backup stream method as the source: cdn domain + SD stream.
        backup_url = json_data.get('cdn', '') + '/getvid?evid=' + (sd_token or hd_token or fhd_token)
        log.debug('Found %d sources via %s', len(source_urls), path)
        return source_urls, backup_url

    def _pass_ad_gate(self, embed_url, embed_origin, gate_html):
        """Replay what the embed page's pre-init.js and countdown do in a browser, then return the player HTML."""
        params = parse_qs(urlsplit(embed_url).query, keep_blank_values=True)
        base_match = re.search(r'var base\s*=\s*"(.*?)"', gate_html)
        player_base = base_match.group(1) if base_match else embed_origin + '/inc/embed/video-js-old.php'

        # The server only unlocks the player once the ad bait script has been loaded and the beacon says "clear".
        flag = '__abd_' + secrets.token_hex(4)
        self.request_c('{0}/assets/ads/advertisement.js?flag={1}&_={2}'.format(embed_origin, flag, int(time.time() * 1000)),
                       extraHeaders={'Accept': '*/*', 'Referer': embed_url})
        nonce = secrets.token_hex(16)
        self.session.post(embed_origin + '/ad-verify',
                          json={'nonce': nonce, 'status': 'clear', 'id': params.get('pid', [''])[0]},
                          headers={'Referer': embed_url, 'Origin': embed_origin}, timeout=30)

        print('[wco-dl] - Waiting {0}s for the embed ad gate...'.format(AD_GATE_WAIT))
        time.sleep(AD_GATE_WAIT)

        query = {key: values[0] for key, values in params.items()}
        query['n'] = nonce
        player = self.request_c('{0}?{1}'.format(player_base, urlencode(query)), extraHeaders={'Referer': embed_url})
        if not player.ok:
            title = BeautifulSoup(player.text, 'html.parser').get_text(' ', strip=True)[:150]
            raise Exception('Embed player returned HTTP {0}: {1}'.format(player.status_code, title))
        return player.text
