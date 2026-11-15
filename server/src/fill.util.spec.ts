import {
  dubVerdict,
  fileEpisode,
  fileMatches,
  matchSeries,
  normaliseTitle,
  parsePremium,
  parseProgress,
  parseShowLink,
} from './fill.util';

describe('parseShowLink', () => {
  it('reads slug and language from a show link', () => {
    expect(parseShowLink('https://www.wcostream.tv/anime/re-zero-starting-life-in-another-world/?season=all&lang=dub')).toEqual({
      slug: 're-zero-starting-life-in-another-world',
      language: 'dub',
    });
  });
  it('takes a bare slug', () => {
    expect(parseShowLink('one-piece')).toEqual({ slug: 'one-piece' });
  });
  it('rejects other sites and junk', () => {
    expect(() => parseShowLink('https://example.com/anime/x')).toThrow();
    expect(() => parseShowLink('')).toThrow();
    expect(() => parseShowLink('https://www.wcostream.tv/')).toThrow();
  });
});

describe('matchSeries', () => {
  const series = [
    { id: 575, title: 'Re: ZERO, Starting Life in Another World', year: 2016, titleSlug: 're-zero-starting-life-in-another-world' },
    { id: 4039, title: 'One Piece', year: 1999, titleSlug: 'one-piece' },
    { id: 9, title: 'ONE PIECE (2023)', year: 2023, titleSlug: 'one-piece-2023' },
    { id: 7, title: 'Mystery Diners', year: 2013 },
  ];
  it('finds exact title matches, year ignored', () => {
    expect(matchSeries('re-zero-starting-life-in-another-world', series).map((s) => s.id)).toEqual([575]);
    expect(matchSeries('mystery-diners', series).map((s) => s.id)).toEqual([7]);
  });
  it('returns every candidate when two shows share a name', () => {
    expect(matchSeries('one-piece', series).map((s) => s.id).sort()).toEqual([4039, 9]);
  });
  it('normalises titles', () => {
    expect(normaliseTitle('Re: ZERO (2016)')).toBe('rezero');
  });
});

describe('downloader output', () => {
  it('reads the latest tqdm percentage', () => {
    expect(parseProgress('Downloading:   7%|#  \rDownloading:  43%|####   ')).toBe(43);
    expect(parseProgress('nothing here')).toBeUndefined();
  });
  it('finds premium-only links', () => {
    const out = '[wco-dl] - Skipping https://www.wcostream.tv/one-piece-episode-8-english-dubbed-2-2, it is only available to WCO Premium users.';
    expect(parsePremium(out)).toEqual(['https://www.wcostream.tv/one-piece-episode-8-english-dubbed-2-2']);
  });
});

describe('file names', () => {
  it('reads S/E, season-episode and bare episode names', () => {
    expect(fileEpisode('Re Zero Starting Life In Another World-S02E14-English Dubbed.mp4')).toEqual({ season: 2, episode: 14 });
    expect(fileEpisode('Show Season 3 Episode 7.mp4')).toEqual({ season: 3, episode: 7 });
    expect(fileEpisode('Episode 1145 English Dubbed (720p).mp4')).toEqual({ episode: 1145 });
  });
  it('never reads a part two as the whole episode', () => {
    expect(fileEpisode('Episode 1145.5 English Dubbed (720p).mp4')).toBeUndefined();
  });
  it('matches the episode asked for', () => {
    expect(fileMatches('X-S02E14-English Dubbed.mp4', { season: 2, episode: 14 }, false)).toBe(true);
    expect(fileMatches('X-S02E15-English Dubbed.mp4', { season: 2, episode: 14 }, false)).toBe(false);
    expect(fileMatches('X-S03E14.mp4', { season: 2, episode: 14 }, false)).toBe(false);
    expect(fileMatches('One Piece-S01E1104-English Dubbed.mp4', { season: 21, episode: 12, absolute: 1104 }, true)).toBe(true);
    expect(fileMatches('One Piece-S01E1104.mp4', { season: 21, episode: 12, absolute: 1105 }, true)).toBe(false);
  });
});

describe('dubVerdict', () => {
  it('accepts an English track and refuses a tagged Japanese-only file', () => {
    expect(dubVerdict(['jpn', 'eng'], 'x.mkv').ok).toBe(true);
    expect(dubVerdict(['jpn'], 'x English Dubbed.mp4').ok).toBe(false);
  });
  it('trusts the name only when the audio is untagged', () => {
    expect(dubVerdict(['und'], 'x English Dubbed.mp4').ok).toBe(true);
    expect(dubVerdict(['und'], 'x English Subbed.mp4').ok).toBe(false);
  });
});
