import { audioStatus, CatalogueItem, catalogueKey, indexCatalogue, matchCatalogue, parseShowLink, searchCatalogue } from './fill.util';

const catalogue: CatalogueItem[] = [
  { name: 'Noragami English Dubbed', path: 'noragami', list: 'dubbed' },
  { name: 'Noragami', path: 'noragami-subbed', list: 'subbed' },
  { name: 'Rugrats', path: 'rugrats', list: 'cartoon' },
  { name: 'Rugrats (2021)', path: 'rugrats-2021', list: 'cartoon' },
  { name: 'Tokyo Ghoul:re', path: 'tokyo-ghoulre', list: 'subbed' },
  { name: 'Gravity Falls Shorts', path: 'gravity-falls-shorts', list: 'cartoon' },
  { name: 'Ranma ½ (2024)', path: 'ranma-%C2%BD-2024', list: 'dubbed' },
];
const index = indexCatalogue(catalogue);
const series = (title: string, extra = {}) => ({ id: 1, title, ...extra });

describe('library gaps: matching Sonarr series to the wcostream catalogue', () => {
  it('drops the audio words from a catalogue name', () => {
    expect(catalogueKey('Noragami English Dubbed')).toBe('noragami');
  });

  it('finds the one show of the same name and prefers the dub over the subbed entry', () => {
    expect(matchCatalogue(series('Noragami'), index)).toEqual({ kind: 'exact', candidates: [{ slug: 'noragami', name: 'Noragami English Dubbed', language: 'dub' }] });
  });

  it('asks for a pick when two shows share the name once years are dropped', () => {
    const m = matchCatalogue(series('Rugrats (1990)'), index);
    expect(m.kind).toBe('maybe');
    expect(m.candidates.map((c) => c.slug)).toEqual(['rugrats', 'rugrats-2021']);
  });

  it('offers a subbed entry, marked sub, only when nothing dubbed matches', () => {
    expect(matchCatalogue(series('Tokyo Ghoul:re'), index).candidates).toEqual([{ slug: 'tokyo-ghoulre', name: 'Tokyo Ghoul:re', language: 'sub' }]);
  });

  it('offers near names as a pick and uses alternate titles', () => {
    expect(matchCatalogue(series('Gravity Falls'), index).kind).toBe('maybe');
    expect(matchCatalogue(series('Stray God', { alternateTitles: [{ title: 'Noragami' }] }), index).kind).toBe('exact');
  });

  it('says none for a show that is not there, and accepts a percent-encoded address', () => {
    expect(matchCatalogue(series('Prehistoric Planet'), index)).toEqual({ kind: 'none', candidates: [] });
    expect(matchCatalogue(series('Ranma ½ (2024)'), index).candidates[0].slug).toBe('ranma-%c2%bd-2024');
    expect(parseShowLink('https://www.wcostream.tv/anime/ranma-%C2%BD-2024/?season=all&lang=dub')).toEqual({ slug: 'ranma-%c2%bd-2024', language: 'dub' });
    expect(() => parseShowLink('ranma-%zz')).toThrow();
  });

  it('reads an unlabelled file as unknown, never as Japanese', () => {
    expect(audioStatus('jpn/eng')).toBe('dub');
    expect(audioStatus('English')).toBe('dub');
    expect(audioStatus('jpn')).toBe('undub');
    expect(audioStatus('deu/jpn')).toBe('undub');
    expect(audioStatus('und')).toBe('unknown');
    expect(audioStatus('und/und')).toBe('unknown');
    expect(audioStatus('')).toBe('unknown');
  });

  it('searches by words, dubbed and cartoon entries first', () => {
    expect(searchCatalogue(catalogue, 'rugrats').map((c) => c.slug)).toEqual(['rugrats', 'rugrats-2021']);
    expect(searchCatalogue(catalogue, 'nora').map((c) => c.slug)).toEqual(['noragami', 'noragami-subbed']);
    expect(searchCatalogue(catalogue, 'x')).toEqual([]);
  });
});
