// Library gaps (11 Nov 2026): every animated Sonarr series with missing episodes, across all root folders, with its
// wco link or the wcostream shows of the same name. Server: GET /library/gaps, GET /library/search, POST /links.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KINDS = [['all', 'All'], ['following', 'Following'], ['linked', 'Linked, not followed'], ['ready', 'Ready to follow'], ['maybe', 'Needs a pick'], ['none', 'No match']];
  const kindOf = (r) => (r.state === 'exact' ? 'ready' : r.state);
  let rows = [], drive = 'all', kind = 'all';

  async function api(method, url, body) {
    const r = await window.wcoBusy(url, fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }));
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.message ? [].concat(data.message).join('; ') : `The server answered ${r.status}`);
    return data;
  }
  function status(msg, err) { const s = $('status'); s.hidden = !msg; s.textContent = msg || ''; s.classList.toggle('err', !!err); }
  let tt;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 3600); }

  function seg(id, options, current) {
    $(id).innerHTML = options.map(([v, label, n]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${v === current}">${esc(label)}${n !== undefined ? ` <span class="count">${n}</span>` : ''}</button>`).join('');
  }

  function render() {
    const inDrive = rows.filter((r) => drive === 'all' || r.root === drive);
    const drives = [...new Set(rows.map((r) => r.root))];
    seg('drive', [['all', 'All folders'], ...drives.map((d) => [d, d])], drive);
    seg('kind', KINDS.map(([v, label]) => [v, label, inDrive.filter((r) => v === 'all' || kindOf(r) === v).length]), kind);
    const f = $('filter').value.trim().toLowerCase();
    const list = inDrive.filter((r) => (kind === 'all' || kindOf(r) === kind) && (!f || r.title.toLowerCase().includes(f)));
    const sum = (a, k) => a.reduce((n, r) => n + r[k], 0);
    const n = (k) => rows.filter((r) => kindOf(r) === k);
    $('tally').innerHTML = `<span><b>${rows.length}</b> series with work</span><span><b>${sum(rows, 'gaps').toLocaleString('en-GB')}</b> episodes missing</span>` +
      `<span><b>${n('following').length}</b> following</span><span><b>${n('linked').length}</b> linked, not followed</span><span><b>${n('ready').length}</b> ready to follow</span><span><b>${n('maybe').length}</b> need a pick</span><span><b>${n('none').length}</b> no match</span>`;
    const ready = list.filter((r) => kindOf(r) === 'ready');
    $('followall').hidden = !ready.length;
    $('followall').textContent = `Follow the ${ready.length} ready to follow${list.length !== rows.length ? ' shown' : ''}`;
    $('rows').innerHTML = list.length ? [...new Set(list.map((r) => r.root))].map((root) => {
      const g = list.filter((r) => r.root === root);
      return `<h2 class="group"><code>${esc(root)}</code><span class="hint">${g.length} series · ${sum(g, 'gaps').toLocaleString('en-GB')} episodes missing</span></h2><ul class="lib">${g.map(row).join('')}</ul>`;
    }).join('') : '<p class="empty">Nothing here matches.</p>';
  }

  function row(r) {
    const map = (slug) => `<a class="linkbtn" href="/map.html?url=${encodeURIComponent(slug)}">Open map</a>`;
    const find = `<button class="linkbtn" data-find type="button">${r.state === 'none' ? 'Search wcostream' : 'Search for another'}</button>`;
    let match, acts;
    if (r.state === 'following') { match = `<span class="tag ok">Following</span><span>${esc(r.slug)} · ${r.language}</span>`; acts = map(r.slug); }
    else if (r.state === 'linked') { match = `<span>Linked: ${esc(r.slug)}</span>`; acts = `<button class="btn" data-follow type="button">Follow</button>${map(r.slug)}`; }
    else if (r.state === 'exact') {
      const c = r.candidates[0];
      match = `<span>${esc(c.name)}</span>${c.language === 'sub' ? '<span class="tag">sub only</span>' : ''}${find}`;
      acts = `<button class="btn" data-follow type="button">Follow</button>${map(c.slug)}`;
    } else if (r.state === 'maybe') {
      match = `<select aria-label="wcostream show for ${esc(r.title)}"><option value="">Pick the wcostream show</option>${r.candidates.map((c, i) =>
        `<option value="${i}">${esc(c.name)}${c.language === 'sub' ? ' (sub only)' : ''}</option>`).join('')}</select>${find}`;
      acts = `<button class="btn" data-follow type="button">Follow</button>`;
    } else { match = `<span>No wcostream show by this name</span>${find}`; acts = ''; }
    return `<li data-id="${r.id}"><div class="name"><b title="${esc(r.title)}">${esc(r.title)}${r.year ? ` (${r.year})` : ''}</b><span title="${esc(r.path)}">${esc(r.path)}</span></div>` +
      `<div class="gaps">${[r.gaps > 0 && r.gaps + ' missing', r.undub > 0 && r.undub + ' to dub'].filter(Boolean).join(' · ')} <span>of ${r.total}</span>` +
      `${(r.split || []).length ? ` <span class="tag" title="Also in a folder Sonarr does not track: ${esc(r.split.join(', '))}. Some of the missing episodes may be there.">split</span>` : ''}</div><div class="match">${match}</div><div class="acts">${acts}</div></li>`;
  }

  // The wco show a row would follow: its link, its one exact match, or the one picked in its list.
  function choice(r, li) {
    if (r.slug) return { slug: r.slug, language: r.language || 'dub' };
    if (r.state === 'exact') return r.candidates[0];
    const v = li?.querySelector('select')?.value;
    return v ? r.candidates[+v] : null;
  }
  async function follow(items) {
    const res = await api('POST', '/links', { items: items.map(({ r, c }) => ({ slug: c.slug, seriesId: r.id, follow: true, language: c.language })) });
    const bad = new Set(res.skipped.map((s) => s.slug));
    for (const { r, c } of items) if (!bad.has(c.slug)) { r.state = 'following'; r.slug = c.slug; r.language = c.language; }
    render();
    toast(`Following ${res.linked} show${res.linked === 1 ? '' : 's'}: the overnight run fills them${res.skipped.length ? `. ${res.skipped.length} skipped: ${res.skipped[0].why}` : ''}`);
  }

  $('rows').addEventListener('click', async (ev) => {
    const li = ev.target.closest('li[data-id]'); if (!li) return;
    const r = rows.find((x) => x.id === +li.dataset.id);
    if (ev.target.closest('[data-follow]')) {
      const c = choice(r, li);
      if (!c) { toast('Pick the wcostream show first'); li.querySelector('select')?.focus(); return; }
      try { await follow([{ r, c }]); } catch (e) { status(`Could not follow ${r.title}: ${e.message}`, true); }
      return;
    }
    if (ev.target.closest('[data-find]')) {
      const m = li.querySelector('.match');
      m.innerHTML = `<input type="search" placeholder="Search wcostream by name" aria-label="Search wcostream for ${esc(r.title)}" value="${esc(r.title.replace(/\s*\(.*?\)\s*/g, ' ').trim())}"><div class="found"></div>`;
      const input = m.querySelector('input'); input.focus(); input.select(); search(input, r);
      return;
    }
    const pick = ev.target.closest('[data-pick]');
    if (pick) {
      try { await follow([{ r, c: { slug: pick.dataset.pick, language: pick.dataset.lang } }]); } catch (e) { status(`Could not follow ${r.title}: ${e.message}`, true); }
    }
  });
  let st;
  $('rows').addEventListener('input', (ev) => {
    const input = ev.target.closest('.match input'); if (!input) return;
    const r = rows.find((x) => x.id === +input.closest('li').dataset.id);
    clearTimeout(st); st = setTimeout(() => search(input, r), 250);
  });
  async function search(input, r) {
    const box = input.parentElement.querySelector('.found');
    let found = [];
    try { found = await api('GET', '/library/search?q=' + encodeURIComponent(input.value)); } catch (e) { box.textContent = 'Could not search: ' + e.message; return; }
    box.innerHTML = found.length ? found.map((c) => `<button class="btn" data-pick="${esc(c.slug)}" data-lang="${c.language}" type="button" title="Follow ${esc(r.title)} as ${esc(c.name)}">${esc(c.name)}${c.language === 'sub' ? ' (sub only)' : ''}</button>`).join('')
      : '<span class="hint">Nothing on wcostream by that name.</span>';
  }

  $('followall').onclick = async () => {
    const f = $('filter').value.trim().toLowerCase();
    const items = rows.filter((r) => (drive === 'all' || r.root === drive) && kindOf(r) === 'ready' && (kind === 'all' || kind === 'ready') && (!f || r.title.toLowerCase().includes(f)))
      .map((r) => ({ r, c: choice(r) })).filter((x) => x.c);
    if (!items.length) return;
    $('followall').disabled = true;
    try { await follow(items); } catch (e) { status(`Could not follow them: ${e.message}`, true); }
    $('followall').disabled = false;
  };
  $('drive').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { drive = b.dataset.v; render(); } });
  $('kind').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { kind = b.dataset.v; render(); } });
  $('filter').addEventListener('input', render);
  $('theme').onclick = () => { const r = document.documentElement; const dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; r.dataset.theme = dark ? 'light' : 'dark'; };

  async function queueCount() {
    const runs = await api('GET', '/fill/jobs').catch(() => []);
    const n = runs.reduce((a, j) => a + j.episodes.filter((e) => ['queued', 'downloading', 'importing'].includes(e.state)).length, 0);
    $('queuecount').textContent = n ? String(n) : '';
    const attn = await api('GET', '/attention').catch(() => []);
    $('attncount').textContent = attn.length ? String(attn.length) : '';
  }
  (async () => {
    queueCount(); setInterval(queueCount, 60000);
    try {
      const data = await api('GET', '/library/gaps');
      rows = data.rows;
      status(data.catalogueErrors.length ? `Part of wcostream's catalogue could not be read, so some matches are missing (${data.catalogueErrors.join('; ')}). Reload to try again.` : '', data.catalogueErrors.length > 0);
      $('lib').hidden = false; render();
    } catch (e) { status(`Could not read the library: ${e.message}`, true); }
  })();
})();
