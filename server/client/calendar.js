// Dub calendar (12 Nov 2026): English dub episodes on the way, day by day. Server: GET /dub-calendar.
// Listed dates are AnimeSchedule.net's; rows marked "estimate" are projected one a week by the server.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let data = { rows: [] }, scope = 'mine', dates = 'all';

  function status(msg, err) { const s = $('status'); s.hidden = !msg; s.textContent = msg || ''; s.classList.toggle('err', !!err); }
  function seg(id, options, current) {
    $(id).innerHTML = options.map(([v, label, n]) => `<button type="button" data-v="${v}" aria-pressed="${v === current}">${esc(label)} <span class="count">${n}</span></button>`).join('');
  }
  const UK = {};   // the browser's own time zone
  const dayKey = (d) => new Date(d).toLocaleDateString('en-CA', UK);
  const dayName = (d) => new Date(d).toLocaleDateString('en-GB', { ...UK, weekday: 'long', day: 'numeric', month: 'long' });
  const clock = (d) => new Date(d).toLocaleTimeString('en-GB', { ...UK, hour: '2-digit', minute: '2-digit' });
  const short = (d) => new Date(d).toLocaleDateString('en-GB', { ...UK, day: 'numeric', month: 'short' });

  function render() {
    const mine = data.rows.filter((r) => r.seriesId);
    const inScope = scope === 'mine' ? mine : data.rows;
    seg('scope', [['mine', 'In your library', mine.length], ['all', 'Everything airing', data.rows.length]], scope);
    seg('dates', [['all', 'All dates', inScope.length], ['listed', 'Listed only', inScope.filter((r) => !r.estimate).length]], dates);
    const f = $('filter').value.trim().toLowerCase();
    const list = inScope.filter((r) => (dates === 'all' || !r.estimate) && (!f || (r.seriesTitle || '').toLowerCase().includes(f) || r.title.toLowerCase().includes(f)));
    const shows = new Set(mine.map((r) => r.seriesId)).size;
    $('tally').innerHTML = `<span><b>${shows}</b> of your shows with a dub on the way</span><span><b>${mine.filter((r) => !r.estimate).length}</b> listed episodes</span><span><b>${mine.filter((r) => r.estimate).length}</b> estimated</span>`;
    $('fetched').textContent = data.fetchedAt ? `, fetched ${short(data.fetchedAt)} at ${clock(data.fetchedAt)}` : '';
    if (!list.length) {
      $('rows').innerHTML = `<p class="empty">${scope === 'mine' && data.rows.length ? 'None of the dubs airing in the next weeks match a series in Sonarr. "Everything airing" shows them all.' : 'Nothing here matches.'}</p>`;
      return;
    }
    const days = [...new Set(list.map((r) => dayKey(r.date)))];
    $('rows').innerHTML = days.map((k) => {
      const g = list.filter((r) => dayKey(r.date) === k);
      return `<h2 class="group">${esc(dayName(g[0].date))}<span class="hint">${g.length} episode${g.length === 1 ? '' : 's'}</span></h2><ul class="cal">${g.map(row).join('')}</ul>`;
    }).join('');
  }

  function row(r) {
    const tags = [
      r.estimate && '<span class="tag est" title="Our estimate: one episode a week after the last one AnimeSchedule lists">estimate</span>',
      (r.delayedUntil || r.delayedText) && `<span class="tag" title="${esc(r.delayedText || '')}">delayed${r.delayedUntil ? ' until ' + esc(short(r.delayedUntil)) : ''}</span>`,
      r.match === 'loose' && '<span class="tag" title="Matched by name with its season marker dropped: check it is this show">check match</span>',
    ].filter(Boolean).join('');
    const sub = r.seriesId ? (r.seriesTitle !== r.title ? esc(r.title) : '') : `Not in Sonarr${r.onWco ? ' · on wcostream' : ''}`;
    const map = (q) => `<a class="linkbtn" href="/map.html?url=${encodeURIComponent(q)}">Open map</a>`;
    let act;
    if (!r.seriesId) act = `<button class="btn" data-add type="button">Add to Sonarr</button>`;
    else if (r.slug) act = (r.follow ? '' : '<button class="btn" data-follow type="button">Follow</button>') + map(r.slug);
    else if (r.wcoState === 'exact') act = `<button class="btn" data-follow type="button">Follow</button>`;
    else if (r.wcoState === 'maybe') act = `<a class="linkbtn" href="/library.html">Pick on Library gaps</a>`;
    else act = `<a class="linkbtn" href="/map.html?url=${encodeURIComponent(r.seriesTitle || r.title)}">Find on wcostream</a>`;
    const has = r.wcoLatest ? `<span class="wco" title="The latest episode wcostream lists for this show">wcostream: up to ${esc(r.wcoLatest)}</span>` : '';
    return `<li class="${r.estimate ? 'est' : ''}" data-route="${esc(r.route)}"><time datetime="${esc(r.date)}">${r.estimate ? '' : clock(r.date)}</time>` +
      `<div class="name"><b title="${esc(r.seriesTitle || r.title)}">${esc(r.seriesTitle || r.title)}</b>${sub ? `<span>${sub}</span>` : ''}</div>` +
      `<div class="ep">Episode ${r.episode}${r.total ? ` of ${r.total}` : ''}${tags}${has}</div><div class="acts">${act}</div></li>`;
  }

  let tt;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 4200); }
  async function post(url, body) {
    const r = await window.wcoBusy(url, fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.message ? [].concat(d.message).join('; ') : `The server answered ${r.status}`);
    return d;
  }
  $('rows').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-follow], button[data-add]');
    const li = b?.closest('li[data-route]'); if (!li) return;
    const r = data.rows.find((x) => x.route === li.dataset.route); if (!r) return;
    b.disabled = true;
    try {
      if (b.hasAttribute('data-add')) {
        const d = await post('/sonarr/add', { name: r.title });
        if (d.added || d.already) {
          toast(d.already ? `${r.title} is already in Sonarr: reload to see it` : `Added ${r.title} to Sonarr. Sonarr is not told to search: follow it to have wco-dl fill it`);
          if (d.added) setTimeout(() => load(true), 1500);
        } else {
          toast(`Sonarr found ${(d.choices || []).length} possible matches for "${r.title}": add it from the Episode map search, where you can choose`);
        }
      } else {
        const c = r.slug ? { slug: r.slug, language: r.language || 'dub' } : (r.candidates || [])[0];
        if (!c) throw new Error('No wcostream show to follow');
        const d = await post('/links', { items: [{ slug: c.slug, seriesId: r.seriesId, follow: true, language: c.language }] });
        if (d.skipped && d.skipped.length) throw new Error(d.skipped[0].why);
        for (const x of data.rows) if (x.seriesId === r.seriesId) { x.follow = true; x.slug = c.slug; x.language = c.language; }
        toast(`Following ${r.seriesTitle || r.title}: the overnight run fills it`);
        render();
      }
    } catch (e) { toast(`Not done: ${e.message}`); } finally { b.disabled = false; }
  });

  async function load(refresh) {
    try {
      const url = '/dub-calendar' + (refresh ? '?refresh=1' : '');
      const r = await window.wcoBusy(url, fetch(url));
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message ? [].concat(d.message).join('; ') : `The server answered ${r.status}`);
      if (d.needsToken) {
        status('No AnimeSchedule token yet. Make an application at animeschedule.net (account settings, API tab) and paste its token in Settings, the cog at the top right.');
        return;
      }
      data = d;
      $('cal').hidden = false;
      status((d.errors || []).length ? `Some weeks could not be read, so dates may be missing or a day old: ${d.errors.join('; ')}.` : '', true);
      render();
    } catch (e) { status(`The calendar could not be read: ${e.message}`, true); }
  }

  for (const [id, set] of [['scope', (v) => { scope = v; }], ['dates', (v) => { dates = v; }]]) {
    $(id).addEventListener('click', (ev) => { const b = ev.target.closest('button[data-v]'); if (b) { set(b.dataset.v); render(); } });
  }
  $('filter').addEventListener('input', render);
  $('refresh').addEventListener('click', () => load(true));
  $('theme').onclick = () => { const r = document.documentElement; const dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; r.dataset.theme = dark ? 'light' : 'dark'; };
  (async () => {   // the header counts, as on the other screens
    try {
      const runs = await (await fetch('/fill/jobs')).json();
      const n = runs.reduce((a, j) => a + j.episodes.filter((e) => ['queued', 'downloading', 'importing'].includes(e.state)).length, 0);
      $('queuecount').textContent = n ? String(n) : '';
      const attn = await (await fetch('/attention')).json();
      $('attncount').textContent = attn.length ? String(attn.length) : '';
    } catch { /* counts are optional */ }
  })();
  load(false);
})();
