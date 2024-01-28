#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
__author__ = "iEpic"
__email__ = "epicunknown@gmail.com"
"""

import os
import json


class Settings:

    def __init__(self):
        self.loaded_settings = {}
        # Does settings.json file exist?
        if os.path.exists('/config/settings.json'):
            # Load up the settings
            with open('/config/settings.json') as file:
                self.loaded_settings = json.load(file)
                print('Settings Loaded.')
        else:
            # Create the 'config' directory if it doesn't exist
            os.makedirs('config', exist_ok=True)

            # Default settings
            default_settings = {
                'includeShowDesc': True,
                'saveFormat': '{show}-S{season}E{episode}-{desc}',
                'episodePadding': 2,
                'seasonPadding': 2,
                'defaultOutputLocation': False,
                'saveDownloadLocation': True,
                'useKnownDownloadLocation': True,
                'checkIfFileIsAlreadyDownloaded': True,
                'downloadsDatabaseLocation': f"config{os.path.sep}database.p",
                'allowToResumeDownloads': True,
                'checkForUpdates': True,
            }

            self.loaded_settings.update(default_settings)

            # Write settings to 'config/settings.json'
            with open('config/settings.json', 'w') as file:
                json.dump(self.loaded_settings, file, indent=4, sort_keys=True)

            print('Settings have been created!')

    def get_setting(self, setting_name):
        if setting_name in self.loaded_settings:
            return self.loaded_settings[setting_name]
