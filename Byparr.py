#!/usr/bin/env python
# -*- coding: utf-8 -*-

import logging
import os
import threading

import requests

log = logging.getLogger('wco-dl')

DEFAULT_BYPARR_URL = 'http://localhost:8191'


class ByparrError(Exception):
    pass


class Byparr(object):
    """Client for a Byparr (FlareSolverr-compatible) instance, configured via BYPARR_URL."""

    def __init__(self, base_url=None, max_timeout=120000):
        base_url = base_url or os.environ.get('BYPARR_URL') or DEFAULT_BYPARR_URL
        base_url = base_url.rstrip('/')
        if not base_url.endswith('/v1'):
            base_url += '/v1'
        self.endpoint = base_url
        self.max_timeout = max_timeout
        # Byparr drives a single browser; serialise requests coming from download threads.
        self._lock = threading.Lock()

    def get(self, url):
        """Fetch `url` through Byparr and return the `solution` dict (response, cookies, userAgent, status, url)."""
        payload = {'cmd': 'request.get', 'url': url, 'maxTimeout': self.max_timeout}
        log.debug('Byparr request: %s via %s', url, self.endpoint)
        with self._lock:
            try:
                response = requests.post(self.endpoint, json=payload, timeout=self.max_timeout / 1000 + 30)
            except requests.RequestException as e:
                raise ByparrError(f'Could not reach Byparr at {self.endpoint}: {e}') from e

        try:
            data = response.json()
        except ValueError:
            raise ByparrError(f'Byparr returned a non-JSON response (HTTP {response.status_code})')

        solution = data.get('solution') or {}
        if data.get('status') != 'ok' or 'response' not in solution:
            raise ByparrError(f"Byparr failed for {url}: {data.get('message') or data}")
        log.debug('Byparr solved %s (HTTP %s, %d bytes)', url, solution.get('status'), len(solution['response']))
        return solution

    @staticmethod
    def apply_to_session(solution, session):
        """Copy Byparr's cookies (e.g. cf_clearance) and user agent onto a requests session."""
        for cookie in solution.get('cookies') or []:
            if 'name' in cookie and 'value' in cookie:
                session.cookies.set(cookie['name'], cookie['value'],
                                    domain=cookie.get('domain', ''), path=cookie.get('path', '/'))
        if solution.get('userAgent'):
            # cf_clearance is bound to the user agent that solved the challenge.
            session.headers['User-Agent'] = solution['userAgent']
