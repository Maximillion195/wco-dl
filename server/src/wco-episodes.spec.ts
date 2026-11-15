import { alike, buildListing, fileIsEpisode, fileTitle, isListed, latestText, linkTitle, numberingFit, parseEpisodeLinks, realTitle, resolveSources } from './wco-episodes.util';

const page = (items: string) => `<html><body><div>${items}</div></body></html>`;
const a = (cls: string, href: string, lang?: string) => `<a class="${cls}" href="${href}"${lang ? ` data-lang="${lang}"` : ''}>x</a>`;
const U = 'https://www.wcostream.tv/anime/some-show';

describe('what wcostream lists', () => {
  it('reads links by the downloader\'s classes, once each, resolved against the page', () => {
    const html = page(a('sidebar-episode-item', '/some-show-episode-2-two') + a('sidebar-episode-item', '/some-show-episode-1-one') + a('sidebar-episode-item', '/some-show-episode-1-one') + a('other', '/nope'));
    expect(parseEpisodeLinks(html, U)).toEqual(['https://www.wcostream.tv/some-show-episode-2-two', 'https://www.wcostream.tv/some-show-episode-1-one']);
    expect(parseEpisodeLinks(page(a('dark-episode-item', '/x-episode-1-y')), U)).toHaveLength(1);
    expect(parseEpisodeLinks(page('<p>nothing</p>'), U)).toEqual([]);
  });

  it('keeps the requested language when a page lists both', () => {
    const html = page(a('sonra', '/s-episode-1-dubbed', 'dub') + a('sonra', '/s-episode-1-subbed', 'sub') + a('sonra', '/s-episode-2-dubbed', 'dub'));
    expect(parseEpisodeLinks(html, U, 'dub')).toHaveLength(2);
    expect(parseEpisodeLinks(html, U, 'sub')).toHaveLength(1);
  });

  it('numbers seasons the way the downloader does: no "season" in the link means season 1', () => {
    const l = buildListing([
      'https://www.wcostream.tv/show-episode-1-a', 'https://www.wcostream.tv/show-episode-2-b',
      'https://www.wcostream.tv/show-season-2-episode-1-c', 'https://www.wcostream.tv/show-season-2-episode-3-d']);
    expect(isListed(l, { s: 1, e: 2 }, false)).toBe(true);
    expect(isListed(l, { s: 1, e: 3 }, false)).toBe(false);
    expect(isListed(l, { s: 2, e: 3 }, false)).toBe(true);
    expect(isListed(l, { s: 2, e: 2 }, false)).toBe(false);
    expect(isListed(l, { s: 3, e: 1 }, false)).toBe(false);
    expect(l.latest).toEqual({ s: 2, e: 3 });
    expect(latestText(l)).toBe('2x03');
  });

  it('looks absolute shows up by their overall number', () => {
    const l = buildListing(['https://www.wcostream.tv/anime-episode-1-a', 'https://www.wcostream.tv/anime-episode-24-b']);
    expect(isListed(l, { s: 2, e: 1, abs: 24 }, true)).toBe(true);
    expect(isListed(l, { s: 2, e: 2, abs: 25 }, true)).toBe(false);
    expect(isListed(l, { s: 2, e: 2 }, true)).toBe(false);
    expect(latestText(l)).toBe('episode 24');
  });

  it('reads the title out of a link and ignores placeholder titles', () => {
    expect(linkTitle('https://www.wcostream.tv/catdog-episode-23-siege-on-fort-catdog')).toBe('siegeonfortcatdog');
    expect(linkTitle('https://www.wcostream.tv/show-season-2-episode-3-the-big-one-english-dubbed')).toBe('thebigone');
    expect(linkTitle('https://www.wcostream.tv/naruto-episode-5-english-dubbed')).toBe('');
    expect(linkTitle('https://www.wcostream.tv/black-butler-episode-3-english-dubbed-2')).toBe('');
    expect(realTitle('Episode 5')).toBe('');
    expect(realTitle('TBA')).toBe('');
    expect(realTitle('Siege on Fort CatDog!')).toBe('siegeonfortcatdog');
  });

  const W = 'https://www.wcostream.tv/';
  it('finds a two-segment link by its titles and never trusts the number on such a show', () => {
    // The site: episode 1 = segments A+B, episode 2 = segments C+D. Sonarr numbers the four segments 1 to 4.
    const l = buildListing([W + 'paw-episode-1-pups-make-a-splash-pups-fall-festival', W + 'paw-episode-2-pups-save-the-sea-turtles-pup-and-the-very-big-baby']);
    const eps = ['Pups Make a Splash', 'Pups Fall Festival', 'Pups Save the Sea Turtles', 'Pup and the Very Big Baby', 'Pups and the Kitty-tastrophe']
      .map((t, i) => ({ id: 10 + i, s: 1, e: i + 1, t }));
    const src = resolveSources(l, eps, false);
    expect(src.get(10)).toEqual({ kind: 'title', url: W + 'paw-episode-1-pups-make-a-splash-pups-fall-festival', ids: [10, 11], partial: undefined });
    expect(src.get(11)).toMatchObject({ kind: 'title', ids: [10, 11] });   // 1x02 is in the site's episode 1, not its episode 2
    expect(src.get(12)).toMatchObject({ kind: 'title', ids: [12, 13] });
    expect(src.get(14)).toEqual({ kind: 'none', why: 'unlisted' });
  });

  it('refuses a number whose link is a different episode, and allows one whose title agrees or cannot be compared', () => {
    const l = buildListing([W + 'show-episode-1-something-else-entirely', W + 'show-episode-2-the-seccond-one', W + 'show-episode-3-english-dubbed']);
    const eps = [{ id: 1, s: 1, e: 1, t: 'The First One' }, { id: 2, s: 1, e: 2, t: 'The Second One' }, { id: 3, s: 1, e: 3, t: 'The Third One' }, { id: 4, s: 1, e: 4, t: 'TBA' }];
    const src = resolveSources(l, eps, false);
    expect(src.get(1)).toEqual({ kind: 'none', why: 'different', got: 'somethingelseentirely' });
    expect(src.get(2)).toMatchObject({ kind: 'title', ids: [2] });          // a typo on the site is still the episode
    expect(src.get(3)).toEqual({ kind: 'number' });                         // the link has no title: nothing to compare
    expect(src.get(4)).toEqual({ kind: 'none', why: 'unlisted' });
  });

  it('anime with no titles in its links stays on numbers, by season or straight through', () => {
    const l = buildListing([1, 2, 3].map((n) => W + `anime-episode-${n}-english-dubbed`));
    const eps = [{ id: 1, s: 1, e: 1, abs: 1, t: 'A' }, { id: 2, s: 1, e: 2, abs: 2, t: 'B' }, { id: 3, s: 2, e: 1, abs: 3, t: 'C' }];
    expect(resolveSources(l, eps, false).get(3)).toEqual({ kind: 'none', why: 'unlisted' });
    expect(resolveSources(l, eps, true).get(3)).toEqual({ kind: 'number' });
    const fit = numberingFit(l, eps, new Set([2, 3]), false);
    expect(fit).toMatchObject({ work: 2, season: 1, absolute: 2, byTitle: 0, unlisted: 1, different: 0, flat: true, wco: '3 episodes, numbered 1 to 3' });
  });

  it('a link that names the episode plus something Sonarr calls differently still holds the episode', () => {
    const l = buildListing([W + 'show-episode-7-the-long-goodbye-bonus-short']);
    const src = resolveSources(l, [{ id: 1, s: 1, e: 3, t: 'The Long Goodbye' }], false);
    expect(src.get(1)).toMatchObject({ kind: 'title', ids: [1], partial: true });
  });

  it('a title that reads two ways is not used', () => {
    const l = buildListing([W + 'show-episode-1-pilot']);
    const eps = [{ id: 1, s: 1, e: 1, t: 'Pilot' }, { id: 2, s: 2, e: 1, t: 'Pilot' }];
    expect(resolveSources(l, eps, false).get(1)).toEqual({ kind: 'number' });   // falls back to the number, where the titles agree
    expect(resolveSources(l, eps, false).get(2)).toEqual({ kind: 'none', why: 'unlisted' });
  });

  it('reads the title in a downloaded file name and compares it with the episode', () => {
    expect(fileTitle('Molly Of Denali-S01E02-Cabbagezilla Name Game.mp4')).toBe('cabbagezillanamegame');
    expect(fileTitle('Show-S01E05-English Dubbed.mp4')).toBe('');
    expect(fileIsEpisode('Molly Of Denali-S01E02-Cabbagezilla Name Game.mp4', 'Have Canoe, Will Paddle')).toBe(false);
    expect(fileIsEpisode('Teen Titans Go-S02E03-Pirates.mp4', 'Pirates')).toBe(true);
    expect(fileIsEpisode('Anime-S01E05-English Dubbed.mp4', 'Anything')).toBe(true);
    expect(alike('thesecondone', 'theseccondone')).toBeGreaterThan(0.9);
  });

  it('a title two links share is not used', () => {
    const l = buildListing(['https://www.wcostream.tv/s-episode-1-pilot', 'https://www.wcostream.tv/s-season-2-episode-1-pilot']);
    expect(l.byTitle.has('pilot')).toBe(false);
  });

  it('an empty page lists nothing', () => {
    const l = buildListing([]);
    expect(l.count).toBe(0);
    expect(isListed(l, { s: 1, e: 1 }, false)).toBe(false);
    expect(latestText(l)).toBe('');
  });
});
