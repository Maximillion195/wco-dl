import { parseContentList } from './content-list';

const listPage = (links: string) => `
  <html><body>
    <a href="/anime/outside-the-list">Not part of the list</a>
    <div id="ddmcc_container">
      <a href="#content">JUMP TO</a>
      <a href="/movie-list#A">A</a>
      <a name="A" class="harfler"><p class="sep">A</p></a>
      <a href="//demand.pubadx.one/click?i=abc">Ad</a>
      ${links}
    </div>
  </body></html>`;

describe('parseContentList', () => {
  it('parses show links and strips the query string', () => {
    const items = parseContentList(
      listPage(`
        <a href="/anime/zombie-land-saga-revenge?season=all&amp;lang=dub">Zombie Land Saga Revenge</a>
        <a href="/anime/tom-and-jerry" title="Tom &amp; Jerry">Tom &amp; Jerry</a>
      `),
    );

    expect(items).toEqual([
      {
        name: 'Zombie Land Saga Revenge',
        path: 'zombie-land-saga-revenge',
        kind: 'series',
      },
      { name: 'Tom & Jerry', path: 'tom-and-jerry', kind: 'series' },
    ]);
  });

  it('parses movie and OVA links as single episodes', () => {
    const items = parseContentList(
      listPage(`
        <a href="/akira-english-dubbed" title="Akira">Akira</a>
        <a href="/some-show-ova-episode-2-english-subbed">Some Show OVA Episode 2</a>
      `),
    );

    expect(items).toEqual([
      { name: 'Akira', path: 'akira-english-dubbed', kind: 'episode' },
      {
        name: 'Some Show OVA Episode 2',
        path: 'some-show-ova-episode-2-english-subbed',
        kind: 'episode',
      },
    ]);
  });

  it('ignores navigation, anchors, ads, links outside the list and duplicates', () => {
    const items = parseContentList(
      listPage(`
        <a href="/anime/naruto?season=all&amp;lang=sub">Naruto</a>
        <a href="/anime/naruto?season=all&amp;lang=dub">Naruto</a>
        <a href="/anime/naruto/extra">Deeper path</a>
      `),
    );

    expect(items.map((item) => item.path)).toEqual(['naruto']);
  });

  it('returns an empty list when the list container is missing', () => {
    expect(parseContentList('<a href="/anime/foo">Foo</a>')).toEqual([]);
  });
});
