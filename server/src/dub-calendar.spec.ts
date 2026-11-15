import { isoWeek, looseKey, matchSeries, parseTimetable, project } from './dub-calendar.util';

const raw = [
  { title: 'Sousou no Frieren', english: "Frieren: Beyond Journey's End", romaji: 'Sousou no Frieren', route: 'sousou-no-frieren',
    episodeDate: '2026-11-14T20:30:00Z', episodeNumber: 7, episodes: 10, airType: 'dub', delayedUntil: '0001-01-01T00:00:00Z' },
  { title: 'Re:ZERO -Starting Life in Another World- Season 3', route: 're-zero-3', episodeDate: '2026-11-15T19:00:00Z', episodeNumber: 3, episodes: 0, airType: 'dub' },
  { title: 'Delayed Show', route: 'delayed', episodeDate: '2026-11-16T19:00:00Z', episodeNumber: 2, episodes: 12, airType: 'dub', delayedUntil: '2026-12-01T00:00:00Z' },
  { title: 'A sub entry', route: 'sub', episodeDate: '2026-11-16T19:00:00Z', episodeNumber: 2, episodes: 12, airType: 'sub' },
  { title: 'No date', route: 'nodate', episodeDate: '0001-01-01T00:00:00Z', episodeNumber: 2, airType: 'dub' },
];

describe('dub calendar', () => {
  it('numbers weeks the ISO way', () => {
    expect(isoWeek(new Date('2026-11-12T00:00:00Z'))).toEqual({ year: 2026, week: 46 });
    expect(isoWeek(new Date('2027-01-01T00:00:00Z'))).toEqual({ year: 2026, week: 53 });
    expect(isoWeek(new Date('2024-12-30T00:00:00Z'))).toEqual({ year: 2025, week: 1 });
  });

  it('keeps dub entries with a real date and treats year 1 as no date', () => {
    const e = parseTimetable(raw);
    expect(e.map((x) => x.route)).toEqual(['sousou-no-frieren', 're-zero-3', 'delayed']);
    expect(e[0].delayedUntil).toBeUndefined();
    expect(e[0].names).toEqual(['Sousou no Frieren', "Frieren: Beyond Journey's End"]);
    expect(parseTimetable({ message: 'Unauthorized' })).toEqual([]);
  });

  it('ignores a delay that ended before the episode airs', () => {
    const [e] = parseTimetable([{ ...raw[0], delayedUntil: '2026-10-01T00:00:00Z', delayedText: 'Delayed' }]);
    expect(e.delayedUntil).toBeUndefined();
    expect(e.delayedText).toBeUndefined();
  });

  it('drops the season marker for a loose match', () => {
    expect(looseKey('Re:ZERO -Starting Life in Another World- Season 3')).toBe(looseKey('Re:ZERO -Starting Life in Another World-'));
    expect(looseKey('Bleach 2nd Season')).toBe('bleach');
    expect(looseKey('Spy x Family Part 2')).toBe('spyxfamily');
  });

  it('matches by any name, marks a season-stripped match loose, and refuses a name two series share', () => {
    const series = [
      { id: 1, title: "Frieren: Beyond Journey's End" },
      { id: 2, title: 'Re:ZERO -Starting Life in Another World-' },
      { id: 3, title: 'Delayed Show (2019)' }, { id: 4, title: 'Delayed Show (2026)' },
    ];
    const m = matchSeries(parseTimetable(raw), series);
    expect(m.get('sousou-no-frieren')).toEqual({ id: 1, title: "Frieren: Beyond Journey's End", match: 'exact' });
    expect(m.get('re-zero-3')?.match).toBe('loose');
    expect(m.has('delayed')).toBe(false);
  });

  it('uses a Sonarr alternate title', () => {
    const m = matchSeries(parseTimetable([raw[0]]), [{ id: 9, title: 'Frieren', alternateTitles: [{ title: 'Sousou no Frieren' }] }]);
    expect(m.get('sousou-no-frieren')?.id).toBe(9);
  });

  it('estimates one episode a week to the end of the season, and none for an unknown length or a delay', () => {
    const rows = project(parseTimetable(raw), new Date('2026-11-12T00:00:00Z'));
    const frieren = rows.filter((r) => r.route === 'sousou-no-frieren');
    expect(frieren.map((r) => [r.episode, r.estimate, r.date.slice(0, 10)])).toEqual([
      [7, false, '2026-11-14'], [8, true, '2026-11-21'], [9, true, '2026-11-28'], [10, true, '2026-12-05']]);
    expect(rows.filter((r) => r.route === 're-zero-3')).toHaveLength(1);
    expect(rows.filter((r) => r.route === 'delayed')).toHaveLength(1);
  });

  it('continues from the last listed episode when several weeks are listed', () => {
    const two = parseTimetable([raw[0], { ...raw[0], episodeNumber: 8, episodeDate: '2026-11-21T20:30:00Z' }, raw[0]]);
    const rows = project(two, new Date('2026-11-12T00:00:00Z'));
    expect(rows.map((r) => [r.episode, r.estimate])).toEqual([[7, false], [8, false], [9, true], [10, true]]);
  });
});
