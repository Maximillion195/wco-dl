#!/usr/bin/env python
# -*- coding: utf-8 -*-

import argparse
import logging
import platform
import sys
import requests
from Lifter import *
from version import __version__
from Settings import Settings
from SaveDownloads import SaveDownloadToFile

SHOW_BASE_URL = 'https://www.wcostream.tv/anime/'


def batch_entry_to_url(entry):
    """Batch files may list show slugs (naruto) or full URLs."""
    entry = entry.strip()
    if not entry.lower().startswith('http'):
        return SHOW_BASE_URL + entry.strip('/')
    return entry.replace('https://wcostream.tv', 'https://www.wcostream.tv')


class Main:
    if __name__ == '__main__':
        # Run the settings script
        settings = Settings()
        database = SaveDownloadToFile(settings)
        
        if settings.get_setting('checkForUpdates'):
            r = requests.get('https://raw.githubusercontent.com/EpicUnknown/wco-dl/master/version.py').text.replace('_version__ = ', '').replace("'", '')
            if (__version__ != r):
                print('', end='\n\n')

        parser = argparse.ArgumentParser(description='wco-dl downloads shows from wcostream.tv')

        parser.add_argument('--version', action='store_true', help='Shows version and exits.')

        required_args = parser.add_argument_group('Required Arguments :')
        required_args.add_argument('-i', '--input', nargs=1, help='Inputs the URL to show.')
        parser.add_argument('-q', '--quality', choices=['480', '720', '1080'], default=None,
                            help='Video quality: 480, 720, or 1080. 480 picks the SD source; 720 and 1080 both '
                                 'pick the best HD source available (1080 when offered, otherwise 720).')
        parser.add_argument('-hd', '--highdef', action="store_true",
                            help='Legacy, same as -q 720. Use -q/--quality instead.')
        parser.add_argument('--lang', '--language', dest='language', choices=['dub', 'sub'], default=None,
                            help='Audio language for shows that offer both: dub or sub. Ignored for episode URLs.')
        parser.add_argument('-epr', '--episoderange', nargs=1, help='Specifies the range of episodes to download.',
                            default='All')
        parser.add_argument('-se', '--season', nargs=1, help='Specifies the season to download.',
                            default='All')
        parser.add_argument('-x', '--exclude', nargs=1, help='Specifies the episodes to not download (ie ova).',
                            default=None)
        parser.add_argument('-o', '--output', nargs=1, help='Specifies the directory of which to save the files.')
        parser.add_argument("-v", "--verbose", help="Prints important debugging messages on screen.",
                            action="store_true")
        parser.add_argument('-n', '--newest', help='Get the newest episode in the series.', action='store_true')
        parser.add_argument('-sh', '--show_downloaded_animes', help='This will show all downloaded shows and episodes', action='store_true')
        parser.add_argument('-us', '--update_shows', help='This will update all shows in your database that have new episodes.', action='store_true')
        parser.add_argument('-b', '--batch', nargs=1,
                            help='Batch download from a text file with one show per line, '
                                 'either a show name/slug (naruto) or a full URL.')
        parser.add_argument('-t', '--threads', help='This will create multiple threads, in other words download multiple episodes at ones.', nargs=1, default=None)
        parser.add_argument("--quiet", help="Will not show download progress",
                            action="store_true")
        logger = "False"
        quiet = 'False'
        
        args = parser.parse_args()

        if args.version:
            print("Current Version : {0}".format(__version__))
            sys.exit(0)

        if args.quiet:
            quiet = 'True'

        if args.verbose:
            logging.basicConfig(format='%(levelname)s: %(message)s', filename="Error Log.log", level=logging.DEBUG)
            logging.debug('You have successfully set the Debugging On.')
            logging.debug("Arguments Provided : {0}".format(args))
            logging.debug(
                "Operating System : {0} - {1} - {2}".format(platform.system(), platform.release(), platform.version()))
            logging.debug("Python Version : {0} ({1})".format(platform.python_version(), platform.architecture()[0]))
            logger = "True"

        if args.quality is None and args.highdef:
            args.quality = '720'
        # Lifter only tells SD ('480') from HD ('1080' = best HD source available).
        args.highdef = '480' if args.quality in (None, '480') else '1080'

        if type(args.episoderange) == list:
            if '-' in args.episoderange[0]:
                args.episoderange = args.episoderange[0].split('-')
            else:
                args.episoderange = args.episoderange[0]
        if type(args.season) == list:
            args.season = args.season[0]
        if type(args.output) == list:
            args.output = args.output[0]
        if type(args.exclude) == list:
            if ',' in args.exclude[0]:
                args.exclude = args.exclude[0].split(',')
            else:
                args.exclude = args.exclude[0]
        if type(args.threads) == list:
            args.threads = args.threads[0]

        if args.batch:
            failed_shows = 0
            with open(args.batch[0], 'r') as anime_list:
                entries = [line.strip() for line in anime_list]
            for entry in entries:
                if not entry or entry.startswith('#'):
                    continue
                url = batch_entry_to_url(entry)
                print(url)
                try:
                    Lifter(url=url, resolution=args.highdef, logger=logger, season=args.season,
                    ep_range=args.episoderange, exclude=args.exclude, output=args.output, newest=args.newest,
                    settings=settings, database=database, threads=args.threads, quiet=quiet, language=args.language)
                except SystemExit as e:
                    if e.code:
                        failed_shows += 1
            print('Done')
            sys.exit(1 if failed_shows else 0)

        if args.update_shows: 
            print("Updating all shows, this will take a while.")
            failed_shows = 0
            for x in database.return_show_url():
                try:
                    Lifter(url=x, resolution=args.highdef, logger=logger, season=args.season,
                    ep_range=args.episoderange, exclude=args.exclude, output=args.output, newest=args.newest,
                    settings=settings, database=database, update=True, quiet=quiet)
                except SystemExit as e:
                    if e.code:
                        failed_shows += 1
            print('Done')
            sys.exit(1 if failed_shows else 0)

        if args.show_downloaded_animes: 
            database.show_all_url()
            sys.exit(0)

        if args.input is None:
            parser.print_help()
            print("\nPlease enter the required argument -i/--input (or -b/--batch).")
            sys.exit(1)

        Lifter(url=args.input[0].replace('https://wcostream.tv', 'https://www.wcostream.tv'), resolution=args.highdef, logger=logger, season=args.season,
               ep_range=args.episoderange, exclude=args.exclude, output=args.output, newest=args.newest,
               settings=settings, database=database, threads=args.threads, quiet=quiet, language=args.language)
