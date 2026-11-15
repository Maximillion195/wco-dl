// Episode map (11 Nov 2026): look a show up from its wco link, tick episodes, fill them, watch the squares.
// Server: GET /show, GET /series-search, POST /fill, GET /fill/jobs, POST /fill/jobs/:id/cancel|retry, GET /followed, POST /follow.
// Critique fixes (same day): swaps are named and confirmed, phones can scroll, roving tab stops per season,
// screen-reader state on every square, errors stay on screen, Sub mode never offers dub swaps, quiet seasons fold.
(() => {
  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, '0');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (s) => (s ? new Date(s + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'not set');
  const audioName = (a) => (!a ? 'unknown' : a.split('/').map((x) => ({ eng: 'English', jpn: 'Japanese' }[x] || x)).join(' and '));
  const lang = () => $('lang').querySelector('[aria-pressed=true]').dataset.v;
  // In Sub mode a Japanese-audio file is what you want, so only missing episodes need work.
  const actionable = (e) => !e.nowco && (e.st === 'missing' || (e.st === 'undub' && lang() === 'dub'));
  // A file whose audio is not labelled may already be English: it is never part of "select all" or a season click,
  // and the overnight run leaves it alone, but it can be picked by hand to replace it with the dub.
  const isSwap = (e) => e.st === 'undub' || e.st === 'unknown';
  const pickable = (e) => actionable(e) || (e.st === 'unknown' && lang() === 'dub');
  const FILL_LABEL = { queued: 'queue', importing: 'import', done: 'done', premium: 'Sonarr', kept: 'check', failed: 'fail', cancelled: '' };
  const ACTIVE = ['queued', 'downloading', 'importing'];
  const STATE_WORDS = { dub: 'in library, English audio', undub: 'in library, another language only', unknown: 'in library, audio not labelled', missing: 'missing', future: 'not aired yet' };

  let show = null, eps = [], fills = new Map(), confirmSwap = false;
  const sel = new Set(), open = new Set();
  let anchor = null, drag = null, lastPointer = 'mouse';

  async function api(method, url, body) {
    const r = await window.wcoBusy(url, fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }));
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.message ? [].concat(data.message).join('; ') : `The server answered ${r.status}`);
    return data;
  }
  function status(msg, err) { const s = $('status'); s.hidden = !msg; s.textContent = msg || ''; s.classList.toggle('err', !!err); }
  let tt;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 3200); }

  // ---------- Look-up and show picking ----------
  function currentLink() {
    const raw = $('url').value.trim();
    try { const u = new URL(raw); u.searchParams.set('lang', lang()); return u.toString(); } catch { return raw; }
  }
  async function lookup(extra = '') {
    const link = $('url').value.trim();
    if (!link) return;
    $('empty').hidden = true; $('found').hidden = true;
    status('Looking it up in Sonarr…');
    try { show = await api('GET', `/show?url=${encodeURIComponent(link)}${extra}`); }
    catch (e) { status(`Could not look that up: ${e.message}`, true); return; }
    status('');
    history.replaceState(null, '', '?url=' + encodeURIComponent(link));
    if (show.series) remember(show.slug, show.series.title);
    $('sclear').hidden = false; $('skey').hidden = true;
    $('map').classList.add('fresh'); setTimeout(() => $('map').classList.remove('fresh'), 900);
    if (show.language) setSeg('lang', show.language);
    if (!show.series) {
      showPicker(show.candidates, show.candidates.length
        ? `More than one show in Sonarr could be "${show.slug}". Pick the right one; it is remembered for this link.`
        : `"${show.slug}" is not in Sonarr yet. Add the show in Sonarr first (http://${location.hostname}:8989/add/new), then look it up again, or search below if Sonarr has it under another name.`);
      return;
    }
    $('picker').hidden = true;
    setSeg('numbering', String(!!show.absolute));
    setFollow(!!show.follow);
    renderShow();
    await poll();
  }
  function showPicker(cands, hint) {
    $('show').hidden = true; $('empty').hidden = true; $('picker').hidden = false;
    $('pickhint').textContent = hint;
    renderPicks(cands || []);
    $('search').value = ''; $('search').focus();
  }
  function renderPicks(list) {
    $('picks').innerHTML = list.length ? list.map((s) => `<li><button type="button" data-id="${s.id}">${esc(s.title)} <span>${esc(s.year)} · ${esc(s.path)}</span></button></li>`).join('')
      : '<li class="hint">Nothing in Sonarr matches. Search by another name.</li>';
  }
  $('picks').addEventListener('click', (ev) => { const b = ev.target.closest('button[data-id]'); if (b) lookup('&seriesId=' + b.dataset.id); });
  $('search').addEventListener('keydown', (ev) => { if (ev.key === 'ArrowDown') { ev.preventDefault(); $('picks').querySelector('button')?.focus(); } });
  $('picks').addEventListener('keydown', (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    const all = [...$('picks').querySelectorAll('button')], i = all.indexOf(b);
    if (ev.key === 'ArrowDown') { ev.preventDefault(); all[i + 1]?.focus(); }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); (all[i - 1] || $('search')).focus(); }
  });
  let st;
  $('search').addEventListener('input', () => { clearTimeout(st); st = setTimeout(async () => renderPicks(await api('GET', '/series-search?q=' + encodeURIComponent($('search').value)).catch(() => [])), 250); });
  $('change').onclick = () => showPicker(show?.candidates, 'Pick the series these episodes belong to. It is remembered for this link.');
  $('lookup').addEventListener('submit', (ev) => { ev.preventDefault(); closeSuggest(); isLink($('url').value) ? lookup() : nameSearch(); });

  // ---------- Search box: suggestions as you type, recent shows, keyboard control ----------
  // Your own shows answer at once from the followed list; wcostream's catalogue follows a moment later.
  // Arrows move, Enter opens, Esc closes; "/" or Ctrl+K focuses the box from anywhere; a pasted link opens straight away.
  const sug = { items: [], active: -1, seq: 0, timer: null, loading: false };
  const isLink = (v) => /^https?:\/\//i.test(v.trim());
  function recents() { try { return JSON.parse(localStorage.getItem('wco-recent') || '[]'); } catch { return []; } }
  function remember(slug, title) {
    try { localStorage.setItem('wco-recent', JSON.stringify([{ slug, title }, ...recents().filter((r) => r.slug !== slug)].slice(0, 6))); } catch { /* private window: no recents */ }
  }
  function closeSuggest() {
    $('suggest').hidden = true; $('url').setAttribute('aria-expanded', 'false'); $('url').removeAttribute('aria-activedescendant'); sug.active = -1;
  }
  function drawSuggest(q) {
    const groups = [['recent', 'Recent'], ['mine', 'Your shows'], ['wco', 'On wcostream']];
    let n = -1;
    const html = groups.map(([g, label]) => {
      const list = sug.items.filter((x) => x.group === g);
      return list.length ? `<div class="sgroup" role="presentation">${label}</div>` + list.map((x) => {
        n++;
        return `<div class="sopt" role="option" id="sopt${n}" data-n="${n}" aria-selected="${n === sug.active}"><span class="sname">${esc(x.title)}</span><span class="smeta">${esc(x.meta)}</span></div>`;
      }).join('') : '';
    }).join('') + (sug.loading ? '<div class="snote">Searching wcostream…</div>' : !sug.items.length && q ? '<div class="snote">Nothing by that name. Press Enter to search again, or try fewer words.</div>' : '');
    $('suggest').innerHTML = html;
    const open = !!html;
    $('suggest').hidden = !open; $('url').setAttribute('aria-expanded', String(open));
    if (sug.active >= 0) $('url').setAttribute('aria-activedescendant', 'sopt' + sug.active); else $('url').removeAttribute('aria-activedescendant');
  }
  function suggest() {
    const q = $('url').value.trim();
    $('sclear').hidden = !q; $('skey').hidden = !!q;
    clearTimeout(sug.timer); const my = ++sug.seq; sug.active = -1;
    if (isLink(q)) { closeSuggest(); return; }
    if (!q) {
      sug.loading = false;
      sug.items = recents().map((r) => ({ group: 'recent', slug: r.slug, title: r.title, meta: 'opened lately', has: true }));
      drawSuggest(''); return;
    }
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const starts = (t) => words.every((w) => t.toLowerCase().split(/[^a-z0-9]+/).some((p) => p.startsWith(w)));
    const mine = followed.filter((x) => words.every((w) => (x.title || x.slug).toLowerCase().includes(w)))
      .sort((a, b) => Number(starts(b.title || b.slug)) - Number(starts(a.title || a.slug))).slice(0, 5)
      .map((x) => ({ group: 'mine', slug: x.slug, title: x.title || x.slug, has: true,
        meta: ['following', x.missing > 0 && x.missing + ' missing', x.undub > 0 && x.undub + ' to dub'].filter(Boolean).join(' · ') }));
    sug.items = mine; sug.loading = q.length >= 2; drawSuggest(q);
    if (q.length < 2) return;
    sug.timer = setTimeout(async () => {
      const found = await api('GET', '/library/search?q=' + encodeURIComponent(q)).catch(() => []);
      if (my !== sug.seq) return;                       // the box has moved on
      const have = new Set(mine.map((x) => x.slug));
      sug.items = [...mine, ...found.filter((c) => !have.has(c.slug)).sort((a, b) => Number(starts(b.name)) - Number(starts(a.name))).slice(0, 8).map((c) => ({ group: 'wco', slug: c.slug, title: c.name, lang: c.language, has: !!c.series,
        meta: [c.language === 'sub' ? 'sub only' : 'dub', c.series ? (c.follow ? 'following' : 'in Sonarr') : 'not in Sonarr yet'].join(' · ') }))];
      sug.loading = false; drawSuggest(q);
    }, 220);
  }
  function choose(x) {
    closeSuggest();
    if (!x.has) { $('url').value = x.title; nameSearch(); return; }   // not in Sonarr: the results panel has "Add to Sonarr"
    if (x.lang) setSeg('lang', x.lang);
    $('url').value = x.slug; $('sclear').hidden = false; $('skey').hidden = true; lookup();
  }
  $('url').addEventListener('input', suggest);
  $('url').addEventListener('focus', suggest);
  $('url').addEventListener('blur', () => setTimeout(closeSuggest, 120));
  $('url').addEventListener('paste', () => setTimeout(() => { if (isLink($('url').value)) { closeSuggest(); lookup(); } }, 0));
  $('url').addEventListener('keydown', (ev) => {
    const open = !$('suggest').hidden, n = sug.items.length;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      if (!open) { suggest(); return; }
      if (!n) return;
      ev.preventDefault();
      sug.active = ev.key === 'ArrowDown' ? (sug.active + 1) % n : (sug.active - 1 + n) % n;
      drawSuggest($('url').value.trim());
      $('sopt' + sug.active)?.scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'Enter' && open && sug.active >= 0) {
      ev.preventDefault(); choose(sug.items[sug.active]);
    } else if (ev.key === 'Escape' && open) {
      ev.preventDefault(); ev.stopPropagation(); closeSuggest();
    }
  });
  $('suggest').addEventListener('mousedown', (ev) => ev.preventDefault());   // keep the focus in the box
  $('suggest').addEventListener('click', (ev) => { const o = ev.target.closest('.sopt'); if (o) choose(sug.items[+o.dataset.n]); });
  $('suggest').addEventListener('pointermove', (ev) => {
    const o = ev.target.closest('.sopt'); if (!o || +o.dataset.n === sug.active) return;
    sug.active = +o.dataset.n;
    $('suggest').querySelectorAll('.sopt').forEach((x) => x.setAttribute('aria-selected', String(+x.dataset.n === sug.active)));
  });
  $('sclear').onclick = () => { $('url').value = ''; $('url').focus(); suggest(); };
  document.addEventListener('keydown', (ev) => {
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
    if ((ev.key === '/' && !typing) || (ev.key.toLowerCase() === 'k' && (ev.ctrlKey || ev.metaKey))) { ev.preventDefault(); $('url').focus(); $('url').select(); }
  });

  // ---------- Motion: small, quick, and off when the system asks for less ----------
  // A panel that appears rises a few pixels; a progress bar slides from where it was instead of jumping.
  function reveal(el) { el.hidden = false; el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); }
  const lastWidth = new Map();
  function smooth(box, key) {
    const bar = box.querySelector('.prog i'); if (!bar) { lastWidth.delete(key); return; }
    const to = bar.style.width, from = lastWidth.get(key);
    if (from && from !== to) { bar.style.width = from; void bar.offsetWidth; bar.style.width = to; }
    lastWidth.set(key, to);
  }
  addEventListener('scroll', () => document.documentElement.classList.toggle('scrolled', scrollY > 8), { passive: true });

  // ---------- Search wcostream by name: shows you do not have yet are found here ----------
  const sonarrAdd = (name) => `http://${location.hostname}:8989/add/new?term=${encodeURIComponent(name)}`;
  async function nameSearch() {
    const q = $('url').value.trim(); if (!q) return;
    status('Searching wcostream. The first search can take a minute.');
    let found;
    try { found = await api('GET', '/library/search?q=' + encodeURIComponent(q)); }
    catch (e) { status(`Could not search wcostream: ${e.message}`, true); return; }
    status('');
    $('show').hidden = true; $('picker').hidden = true; $('empty').hidden = true; reveal($('found'));
    $('run').hidden = true; show = null; sel.clear(); $('bar').classList.remove('on'); document.title = BASE_TITLE;
    history.replaceState(null, '', location.pathname);
    $('foundhead').textContent = `On wcostream: "${q}"`;
    $('foundhint').textContent = found.length ? 'Pick a show to see its episodes. One that is not in Sonarr has to be added there first, so its episodes have somewhere to go.'
      : 'Nothing on wcostream by that name (dubbed anime, cartoons and subbed anime were searched). Try fewer words.';
    $('foundlist').innerHTML = found.map((c) => `<li><button type="button" data-slug="${esc(c.slug)}" data-lang="${c.language}"${c.series ? '' : ' disabled'}>${esc(c.name)}
      <span>${c.language === 'sub' ? 'sub only' : 'dub'} · ${c.series ? `in Sonarr as ${esc(c.series.title)}${c.follow ? ' · following' : ''}` : 'not in Sonarr yet'}</span></button>` +
      (c.series ? '' : `<button class="btn" type="button" data-add="${esc(c.name)}" data-slug="${esc(c.slug)}" data-lang="${c.language}">Add to Sonarr</button>
        <a class="linkbtn" href="${sonarrAdd(c.name.replace(/\b(English )?(Dubbed|Subbed)\b/gi, '').trim())}" target="_blank" rel="noopener">or add it by hand</a>
        <button class="linkbtn" type="button" data-slug="${esc(c.slug)}" data-lang="${c.language}">I have added it</button><span class="choices"></span>`) + '</li>').join('');
    if (found.some((c) => !c.series)) {
      const d = await api('GET', '/sonarr/defaults').catch(() => null);
      if (d) $('foundhint').textContent += ` "Add to Sonarr" puts a new show in ${d.rootFolderPath} with the quality profile "${d.qualityProfile}", the settings of the last animated show you added (${d.copiedFrom}).`;
    }
  }
  // One press: Sonarr looks the name up and adds the one show of that name; several of the same name come back to pick from.
  async function addToSonarr(b, tvdbId) {
    const li = b.closest('li'), add = li.querySelector('[data-add]'), box = li.querySelector('.choices');
    add.disabled = true;
    try {
      const r = await api('POST', '/sonarr/add', { name: add.dataset.add, slug: add.dataset.slug, tvdbId });
      if (r.added || r.already) {
        toast(r.added ? `Added to Sonarr: ${r.series.title} at ${r.series.path}` : `${r.series.title} is already in Sonarr`);
        $('found').hidden = true; setSeg('lang', add.dataset.lang); $('url').value = add.dataset.slug;
        await lookup('&seriesId=' + r.series.id); return;
      }
      box.innerHTML = r.choices.length ? '<span class="hint">Which one?</span>' + r.choices.map((c) =>
        `<button class="btn" type="button" data-tvdb="${c.tvdbId}"${c.inSonarr ? ' disabled' : ''}>${esc(c.title)} (${c.year || 'year unknown'})${c.network ? ' · ' + esc(c.network) : ''}${c.inSonarr ? ' · in Sonarr' : ''}</button>`).join('')
        : '<span class="hint">Sonarr found no show by that name. Add it by hand under the name Sonarr knows.</span>';
    } catch (e) { status(`Could not add it to Sonarr: ${e.message}`, true); }
    add.disabled = false;
  }
  $('foundlist').addEventListener('click', (ev) => {
    const add = ev.target.closest('[data-add]'); if (add) { addToSonarr(add); return; }
    const tv = ev.target.closest('[data-tvdb]'); if (tv) { if (!tv.disabled) addToSonarr(tv, +tv.dataset.tvdb); return; }
    const b = ev.target.closest('[data-slug]'); if (!b || b.disabled) return;
    $('found').hidden = true;
    setSeg('lang', b.dataset.lang); $('url').value = b.dataset.slug; lookup();
  });

  function setSeg(id, v) { $(id).querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v))); }
  $('lang').addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    setSeg('lang', b.dataset.v); $('url').value = currentLink();
    if (show?.series) renderShow(true);
  });
  $('numbering').addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b || !show) return;
    if (sel.size && !confirm('Changing the numbering clears your selection. Continue?')) return;
    lookup('&seriesId=' + show.series.id + '&absolute=' + b.dataset.v);
  });

  // Episodes wcostream does not list for this show (the server reads its show page; the first time can take a while).
  // They are dotted, left out of "select all" and not queued overnight: a download of them fails.
  let wcoFor = '', wcoGone = new Set(), wcoTogether = {};
  async function wcoNote(id) {
    const key = `${id}|${show.slug}|${lang()}|${show.absolute}`;
    if (wcoFor === key) return;
    wcoFor = key; wcoGone = new Set(); wcoTogether = {}; $('wconote').hidden = true;
    try {
      const d = await (await fetch(`/show/wco?url=${encodeURIComponent(show.slug)}&seriesId=${id}&lang=${lang()}&absolute=${!!show.absolute}`)).json();
      if (wcoFor !== key || !d.checked) return;
      wcoGone = new Set(d.unlisted); wcoTogether = d.together || {};
      eps.forEach((e) => { e.nowco = wcoGone.has(e.id); if (e.el) e.el.classList.toggle('nowco', e.nowco); });
      const n = d.unlisted.length, version = lang() === 'dub' ? 'English dub' : 'subbed';
      const parts = [];
      if (n) {
        const diff = d.different || 0, gone = n - diff;
        parts.push(`${n} episode${n === 1 ? '' : 's'} that need${n === 1 ? 's' : ''} work cannot be had from wcostream as ${version}: ` +
          [gone && `${gone} not listed${d.latest ? ` (it lists up to ${d.latest})` : ''}`, diff && `${diff} where its episode of that number is a different episode`].filter(Boolean).join(', ') +
          '. Dotted below, left out of "select all" and the overnight run.');
      }
      if (d.byTitle) parts.push(`${d.byTitle} ${d.byTitle === 1 ? 'is' : 'are'} found by title, because the site numbers this show differently from Sonarr.`);
      // The other way of numbering would supply more: offer the switch. Straight through is only offered when the
      // site has no season links, so a number can only mean one episode.
      const f = d.fit || {}, mine = show.absolute ? f.absolute : f.season, other = show.absolute ? f.season : f.absolute;
      const offer = other > mine + 2 && (show.absolute || f.flat);
      $('wconote').innerHTML = parts.map(esc).join(' ') + (offer ? ` Numbered ${show.absolute ? 'by season' : 'straight through'}, wcostream would supply ${other} of the ${f.work} episodes that need work, not ${mine}. <button class="linkbtn" id="numswitch" type="button">Switch numbering</button>` : '');
      $('wconote').hidden = !parts.length && !offer;
      $('numswitch')?.addEventListener('click', () => $('numbering').querySelector(`[data-v="${!show.absolute}"]`).click());
      render();
    } catch { /* the check is optional */ }
  }

  // The next English dub episodes of this show, from the dub calendar (AnimeSchedule.net). Asked once per show.
  let dubFor;
  async function dubNote(id) {
    if (dubFor === id) return;
    dubFor = id; $('dubnote').hidden = true;
    try {
      const rows = await (await fetch('/dub-calendar/series/' + id)).json();
      if (dubFor !== id || !Array.isArray(rows) || !rows.length) return;
      const day = (d) => new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
      $('dubnote').innerHTML = 'English dub: ' + rows.map((r) => `episode ${r.episode} ${r.estimate ? 'about ' : ''}${day(r.date)}`).join(', ') +
        (rows[0].match === 'loose' ? ' (matched by name without its season: check it is this show)' : '') +
        '. <a href="/calendar.html">Dub calendar</a>';
      $('dubnote').hidden = false;
    } catch { /* the note is optional */ }
  }

  // ---------- Map ----------
  function renderShow(keepSelection) {
    $('empty').hidden = true; if ($('show').hidden) reveal($('show'));
    $('title').textContent = show.series.title;
    $('path').textContent = show.series.path;
    const split = show.split || [];
    $('split').hidden = !split.length;
    $('split').textContent = split.length ? `This show also has a folder Sonarr does not track: ${split.join(', ')}. If episodes look missing here, they may be in there: merge the folders before downloading them again.` : '';
    dubNote(show.series.id);
    wcoNote(show.series.id);
    eps = show.episodes.map((e, i) => ({ ...e, i, nowco: wcoGone.has(e.id) }));
    if (!keepSelection) sel.clear();
    const count = (s) => eps.filter((e) => e.st === s).length;
    $('tally').innerHTML = `<span><b>${count('dub')}</b> in English</span><span><b>${count('undub')}</b> not in English</span>${count('unknown') ? `<span><b>${count('unknown')}</b> audio not labelled</span>` : ''}<span><b>${count('missing')}</b> missing</span>` +
      (count('future') ? `<span><b>${count('future')}</b> not aired</span>` : '');
    const map = $('map'); map.innerHTML = '';
    if (!eps.length) { map.innerHTML = '<p class="empty">Sonarr has no episodes for this show yet.</p>'; render(); return; }
    for (const s of [...new Set(eps.map((e) => e.s))]) {
      const list = eps.filter((e) => e.s === s), work = list.filter(actionable);
      const row = document.createElement('div'); row.className = 'season';
      const lab = document.createElement('button'); lab.className = 'slabel'; lab.type = 'button'; lab.dataset.s = s;
      lab.innerHTML = `<b>Season ${s}</b><span></span>`;
      lab.onclick = () => {
        const w = eps.filter((e) => e.s === s && actionable(e) && selectable(e));
        if (!w.length) { toggleFold(s); return; }
        const all = w.every((e) => sel.has(e.i)); w.forEach((e) => (all ? sel.delete(e.i) : sel.add(e.i))); render();
      };
      const cells = document.createElement('div'); cells.className = 'cells'; cells.dataset.s = s;
      cells.setAttribute('role', 'group'); cells.setAttribute('aria-label', 'Season ' + s);
      // A season that needs nothing folds to one line, so long shows stay readable.
      const folded = !work.length && !open.has(s);
      if (folded) {
        cells.classList.add('folded');
        cells.innerHTML = `<span class="fold">${list.length} episodes, ${list.every((e) => e.st === 'dub') ? 'all in English' : 'nothing to do'}</span><button type="button" class="btn btn-quiet fold-btn">Show squares</button>`;
        cells.querySelector('.fold-btn').onclick = () => toggleFold(s);
      } else {
        list.forEach((e, k) => {
          const c = document.createElement('button'); c.type = 'button'; c.dataset.i = e.i; c.tabIndex = k === 0 ? 0 : -1; c.style.setProperty('--i', Math.min(k, 40));
          c.setAttribute('role', 'checkbox');
          e.el = c; cells.appendChild(c);
        });
      }
      row.append(lab, cells); map.appendChild(row);
    }
    render();
  }
  function toggleFold(s) { open.has(s) ? open.delete(s) : open.add(s); renderShow(true); }

  const selectable = (e) => pickable(e) && !(fills.get(e.id) && ACTIVE.includes(fills.get(e.id).state));
  function cellLook(e) {
    if (!e.el) return;
    const f = fills.get(e.id), live = f && f.state !== 'cancelled';
    const was = e.fs; e.fs = live ? f.state : '';
    e.el.className = 'cell ' + e.st + (e.nowco ? ' nowco' : '') + (live ? ' f-' + f.state : '') + (e.fs === 'done' && was && was !== 'done' ? ' pop' : '');
    const au = live ? (f.state === 'downloading' ? `${f.progress ?? 0}%` : FILL_LABEL[f.state]) : e.st === 'dub' ? 'EN' : e.st === 'undub' ? 'JP' : e.st === 'unknown' ? '?' : '';
    e.el.innerHTML = `<span class="n">${show.absolute && e.abs ? e.abs : e.e}</span>${au ? `<span class="au">${au}</span>` : ''}`;
    e.el.style.setProperty('--p', (live && f.state === 'downloading' ? f.progress ?? 0 : live && f.state === 'importing' ? 100 : 0) + '%');
    selectable(e) ? e.el.removeAttribute('aria-disabled') : e.el.setAttribute('aria-disabled', 'true');
    e.el.setAttribute('aria-checked', sel.has(e.i) ? 'true' : 'false');
    const runWords = live ? `, this run: ${f.state === 'downloading' ? `downloading ${f.progress ?? 0}%` : f.message || f.state}` : '';
    e.el.setAttribute('aria-label', `${e.s}x${pad(e.e)} ${e.t}, ${STATE_WORDS[e.st]}${runWords}`);
  }

  function render() {
    for (const e of eps) { if (!selectable(e)) sel.delete(e.i); cellLook(e); }
    const p = picked(), sw = p.filter(isSwap).length, mi = p.filter((e) => e.st === 'missing').length;
    $('bar').classList.toggle('on', p.length > 0);
    $('sum').innerHTML = `<b>${p.length} selected</b> <span>· ${[sw && sw + ' swap to dub', mi && mi + ' to download'].filter(Boolean).join(' · ')}</span>` +
      (sw ? `<span class="warn">Swapped files go to Sonarr's recycle bin, kept 7 days</span>` : '');
    confirmSwap = false;
    $('golabel').textContent = sw ? `Swap ${sw} to dub${mi ? ` · download ${mi}` : ''}` : `Download and import ${mi}`;
    $('go').classList.remove('confirm');
    document.querySelectorAll('.slabel').forEach((l) => {
      const s = +l.dataset.s, all = eps.filter((e) => e.s === s), work = all.filter(actionable), n = work.filter((e) => sel.has(e.i)).length;
      l.querySelector('span').textContent = !work.length ? (open.has(s) ? 'hide squares' : 'nothing to do') : n ? `${n} of ${work.length} selected` : `${work.length} need work`;
    });
  }
  const picked = () => [...sel].sort((a, b) => a - b).map((i) => eps[i]);
  function setRange(a, b, on) { const [x, y] = a < b ? [a, b] : [b, a]; for (let i = x; i <= y; i++) if (eps[i].el && selectable(eps[i])) on ? sel.add(i) : sel.delete(i); }
  function toggle(e, shift) {
    if (shift && anchor !== null) setRange(anchor, e.i, true);
    else { sel.has(e.i) ? sel.delete(e.i) : sel.add(e.i); anchor = e.i; }
    render();
  }

  // Pointer: drag-select with a mouse or pen; a finger taps to toggle and swipes to scroll.
  const map = $('map');
  map.addEventListener('pointerdown', (ev) => {
    lastPointer = ev.pointerType;
    const c = ev.target.closest('.cell'); if (!c || ev.pointerType === 'touch') return;
    const e = eps[+c.dataset.i]; if (!selectable(e)) return;
    ev.preventDefault(); c.focus({ preventScroll: true });
    if (ev.shiftKey && anchor !== null) { toggle(e, true); return; }
    drag = { on: !sel.has(e.i) }; drag.on ? sel.add(e.i) : sel.delete(e.i); anchor = e.i; render();
  });
  map.addEventListener('click', (ev) => {
    if (lastPointer !== 'touch') return;
    const c = ev.target.closest('.cell'); if (!c) return; const e = eps[+c.dataset.i];
    showTip(c); if (selectable(e)) toggle(e, false);
  });
  map.addEventListener('pointerover', (ev) => {
    const c = ev.target.closest('.cell'); if (!c || ev.pointerType === 'touch') return; showTip(c);
    if (drag && ev.buttons) { const e = eps[+c.dataset.i]; if (selectable(e)) { drag.on ? sel.add(e.i) : sel.delete(e.i); render(); } }
  });
  map.addEventListener('pointerout', (ev) => { if (!ev.relatedTarget?.closest?.('.cell')) hideTip(); });
  window.addEventListener('pointerup', () => (drag = null));

  // Keyboard: one tab stop per season; arrows follow the real grid; Home/End; Space or Enter toggles.
  map.addEventListener('keydown', (ev) => {
    const c = ev.target.closest('.cell'); if (!c) return;
    const grid = c.parentElement, cells = [...grid.querySelectorAll('.cell')], k = cells.indexOf(c);
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length || 1;
    const to = { ArrowRight: k + 1, ArrowLeft: k - 1, ArrowDown: k + cols, ArrowUp: k - cols, Home: 0, End: cells.length - 1 }[ev.key];
    if (to !== undefined) {
      ev.preventDefault(); const next = cells[Math.max(0, Math.min(cells.length - 1, to))];
      c.tabIndex = -1; next.tabIndex = 0; next.focus();
      const e = eps[+next.dataset.i]; if (ev.shiftKey && selectable(e)) { setRange(anchor ?? +c.dataset.i, e.i, true); render(); }
      return;
    }
    const e = eps[+c.dataset.i];
    if ((ev.key === ' ' || ev.key === 'Enter') && selectable(e)) { ev.preventDefault(); toggle(e, ev.shiftKey); }
  });
  map.addEventListener('focusin', (ev) => {
    const c = ev.target.closest('.cell'); if (!c) return;
    c.parentElement.querySelectorAll('.cell').forEach((x) => (x.tabIndex = x === c ? 0 : -1));
    showTip(c);
  });
  map.addEventListener('focusout', hideTip);

  const tip = $('tip');
  function showTip(c) {
    const e = eps[+c.dataset.i], f = fills.get(e.id);
    const run = f ? { queued: f.message || 'Waiting in this run', downloading: `Downloading, ${f.progress ?? 0}%`, importing: 'Importing into Sonarr', done: f.message || 'Done',
      premium: f.message, kept: f.message, failed: f.message, cancelled: 'Cancelled' }[f.state] : '';
    const act = f && (f.state === 'failed' || f.state === 'kept') ? "Open the queue for the downloader's own log" : run ? '' : e.st === 'unknown' ? (lang() === 'sub' ? '' : sel.has(e.i) ? 'Selected: your file will be replaced by the English dub'
      : 'The file does not say what language its audio is, so it may already be English. Click only if you know it is not')
      : e.st === 'undub' ? (lang() === 'sub' ? 'Sub mode: Japanese audio is what you asked for'
      : sel.has(e.i) ? 'Selected: your file will be replaced by the English dub' : 'Click to swap it for the English dub')
      : e.st === 'missing' ? (sel.has(e.i) ? 'Selected: will be downloaded' : 'Click to download it') : '';
    const mates = (wcoTogether[e.id] || []).filter((id) => id !== e.id).map((id) => eps.find((x) => x.id === id)).filter(Boolean).map((x) => `${x.s}x${pad(x.e)}`);
    const note = e.nowco && !run ? 'wcostream cannot supply this episode: it is not listed, or its episode of this number is a different one'
      : mates.length && actionable(e) ? `${act ? act + '. ' : ''}On wcostream this comes in one file with ${mates.join(' and ')}` : act;
    tip.innerHTML = `<div class="k">${e.s}x${pad(e.e)}${e.abs ? ` · #${e.abs}` : ''}</div><div class="t">${esc(e.t)}</div><dl>
      <dt>Aired</dt><dd>${fmtDate(e.a)}</dd><dt>Status</dt><dd>${STATE_WORDS[e.st].replace(/^./, (x) => x.toUpperCase())}</dd>
      ${e.f ? `<dt>Audio</dt><dd>${esc(audioName(e.au))}</dd><dt>Quality</dt><dd>${esc(e.q)}</dd><dt>File</dt><dd>${esc(e.f)}</dd>` : ''}
      ${run ? `<dt>This run</dt><dd>${esc(run)}</dd>` : ''}</dl>${note ? `<div class="act">${note}</div>` : ''}`;
    const r = c.getBoundingClientRect(), w = 300;
    const x = Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2));
    tip.classList.add('on'); const h = tip.offsetHeight; let y = r.top - h - 8; if (y < 12) y = r.bottom + 8;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  function hideTip() { tip.classList.remove('on'); }

  // ---------- Actions ----------
  function ranges(list) {
    const out = []; let start = null, prev = null;
    const push = () => start && out.push(start === prev ? `${start.s}x${start.e}` : `${start.s}x${start.e}-${prev.s}x${prev.e}`);
    for (const e of list) { if (prev && e.s === prev.s && e.e === prev.e + 1) { prev = e; continue; } push(); start = prev = e; }
    push(); return out.join(',');
  }
  $('go').onclick = async () => {
    const p = picked(); if (!p.length || !show) return;
    const sw = p.filter(isSwap).length;
    if (sw && !confirmSwap) {   // replacing files: one more deliberate click
      confirmSwap = true; $('go').classList.add('confirm');
      $('golabel').textContent = `Confirm: replace ${sw} file${sw > 1 ? 's' : ''} with the dub`;
      return;
    }
    $('go').disabled = true;
    try {
      const j = await api('POST', '/fill', { seriesId: show.series.id, slug: show.slug, language: lang(), quality: $('q').value, absolute: !!show.absolute, episodeIds: p.map((e) => e.id) });
      sel.clear(); status(''); toast(`${j.episodes.length} episode${j.episodes.length > 1 ? 's' : ''} queued`); await poll();
    } catch (e) { status(`Could not start the run: ${e.message}`, true); render(); }
    $('go').disabled = false;
  };
  $('all').onclick = () => { const work = eps.filter((e) => e.el && actionable(e) && selectable(e)); const all = work.every((e) => sel.has(e.i)); work.forEach((e) => (all ? sel.delete(e.i) : sel.add(e.i))); render(); };
  $('clear').onclick = () => { sel.clear(); render(); };
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !['INPUT', 'SELECT'].includes(document.activeElement?.tagName)) { sel.clear(); render(); } });

  // ---------- Runs: one poller feeds the squares, the run strip, the queue panel and the home screen ----------
  // A show can have several runs at once (a second batch started while the first still downloads), so the squares
  // and the strip read all of its live runs together; with none live they show the newest run that did anything.
  const STATE_TEXT = { queued: 'waiting', downloading: 'downloading', importing: 'importing', done: 'done', premium: 'premium, sent to Sonarr',
    kept: 'to check', failed: 'failed', cancelled: 'cancelled' };
  const BASE_TITLE = document.title;
  const isLive = (j) => j.episodes.some((e) => ACTIVE.includes(e.state));
  const isWorking = (e) => e.state === 'downloading' || e.state === 'importing';
  const when = (s) => new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const prog = (p, label) => `<div class="prog" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}"><i style="width:${p}%"></i></div>`;
  let allRuns = [], queueErr = '', pollT = null, pollSeq = 0;
  let qstate = { paused: false }, attention = [], attnAt = 0, attnAt0 = false;
  async function loadAttention(force) {
    if (!force && Date.now() - attnAt < 60000) return;   // it asks Sonarr, so not on every poll
    attnAt = Date.now();
    attention = await api('GET', '/attention').catch(() => attention);
    $('attncount').textContent = attention.length ? String(attention.length) : '';
    renderHome();
    if (location.hash === '#attention' && !attnAt0) { attnAt0 = true; $('attention').scrollIntoView({ block: 'start' }); }
  }

  function scope() {
    const mine = show?.series ? allRuns.filter((j) => j.seriesId === show.series.id) : [];
    const live = mine.filter(isLive);
    if (live.length) return live;
    const last = mine.find((j) => j.episodes.some((e) => e.state !== 'cancelled'));
    return last ? [last] : [];
  }
  const showActive = () => scope().some(isLive);

  async function poll() {
    const my = ++pollSeq; clearTimeout(pollT);
    const wasActive = showActive();
    try { [allRuns, qstate] = await Promise.all([api('GET', '/fill/jobs'), api('GET', '/fill/state')]); queueErr = ''; } catch (e) { queueErr = e.message; }
    if (my !== pollSeq) return;                       // a newer poll took over
    $('pausebtn').textContent = qstate.paused ? 'Resume' : 'Pause';
    $('pausebtn').setAttribute('aria-pressed', String(!!qstate.paused));
    loadAttention();
    applyRuns(); renderQueue(); renderHome();
    if (wasActive && !showActive() && !queueErr) {
      const f = [...fills.values()], n = (s) => f.filter((e) => e.state === s).length;
      toast(['Finished:', n('done') && `${n('done')} done`, n('premium') && `${n('premium')} sent to Sonarr`, n('kept') && `${n('kept')} to check`, n('failed') && `${n('failed')} failed`].filter(Boolean).join(' '));
      await lookup(); return;                         // fresh library state; lookup polls again
    }
    pollT = setTimeout(poll, showActive() ? 1500 : allRuns.some(isLive) ? 3000 : 15000);
  }

  function applyRuns() {
    const runs = scope();
    // Per episode: the run working on it wins, then the newest one that was not cancelled. Runs come newest first.
    fills = new Map();
    for (const j of runs) for (const e of j.episodes) {
      const had = fills.get(e.id);
      if (!had || (ACTIVE.includes(e.state) && !ACTIVE.includes(had.state)) || (had.state === 'cancelled' && e.state !== 'cancelled')) fills.set(e.id, e);
    }
    if (show?.series && !$('show').hidden) render();
    const f = [...fills.values()].filter((e) => e.state !== 'cancelled');
    if (!show?.series || !f.length) { $('run').hidden = true; document.title = show?.series ? `${show.series.title} · wco-dl` : BASE_TITLE; return; }
    const n = (s) => f.filter((e) => e.state === s).length;
    const active = f.some((e) => ACTIVE.includes(e.state)), cur = f.find(isWorking);
    const settled = f.length - n('queued') - n('downloading') - n('importing');
    const pct = Math.round(((settled + (cur ? (cur.state === 'importing' ? 1 : (cur.progress ?? 0) / 100) : 0)) / f.length) * 100);
    const busyUntil = f.filter((e) => e.state === 'queued' && e.notBefore && new Date(e.notBefore) > new Date()).map((e) => e.notBefore).sort()[0];
    const head = cur ? (cur.state === 'importing' ? 'Importing' : 'Downloading')
      : !active ? 'Last run'
      : runs.filter(isLive).every((j) => j.auto) ? 'Waiting for tonight'
      : busyUntil && n('queued') === f.filter((e) => e.state === 'queued' && e.notBefore).length ? 'Waiting on wcostream' : 'Waiting its turn';
    const detail = cur ? `<span class="code">${cur.s}x${pad(cur.e)}</span> ${esc(cur.title)}${cur.state === 'downloading' ? ` · ${cur.progress ?? 0}%` : ''}`
      : !active ? when(runs[0].createdAt)
      : head === 'Waiting for tonight' ? 'overnight runs go between ' + window.wcoNight()
      : head === 'Waiting on wcostream' ? `its servers were busy; next try at ${new Date(busyUntil).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
      : 'another show is downloading first';
    const bits = [`${settled} of ${f.length} finished`, n('queued') && `${n('queued')} waiting`, n('premium') && `${n('premium')} sent to Sonarr`,
      n('kept') && `${n('kept')} to check`, n('failed') && `${n('failed')} failed`].filter(Boolean).join(' · ');
    const retryable = !active && (n('kept') || n('failed'));
    $('run').hidden = false;
    $('run').classList.toggle('bad', !!(n('kept') || n('failed')));
    $('run').innerHTML = `<div class="runrow"><b>${head}</b><span class="what">${detail}</span><span class="grow"></span><span class="meta">${bits}</span>` +
      `<button class="linkbtn" id="runqueue" type="button">Details and logs</button>` +
      (active ? '<button class="btn" id="cancel" type="button">Cancel</button>' : '') +
      (retryable ? '<button class="btn" id="retry" type="button">Retry failed (resumes partial downloads)</button>' : '') + '</div>' +
      (active ? prog(pct, `This show's queue, ${pct}% finished`) : '');
    smooth($('run'), 'run');
    $('cancel')?.addEventListener('click', () => runAction('cancel', runs.filter(isLive)));
    $('retry')?.addEventListener('click', () => runAction('retry', runs));
    $('runqueue')?.addEventListener('click', () => openQueue(true));
    document.title = (cur ? `${cur.state === 'importing' ? 'Importing' : (cur.progress ?? 0) + '%'} ${cur.s}x${pad(cur.e)} · ` : active ? `${n('queued')} waiting · ` : '') + `${show.series.title} · wco-dl`;
  }
  async function runAction(kind, runs) {
    try { for (const j of runs) await api('POST', `/fill/jobs/${j.id}/${kind}`, {}); }
    catch (e) { status(`Could not ${kind} the run: ${e.message}`, true); }
    poll();
  }

  // What the downloader is doing right now, in one line: used at the top of the queue and on the home screen.
  function nowLine(extra = '') {
    const flat = allRuns.flatMap((j) => j.episodes.map((e) => ({ e, j })));
    const cur = flat.find((x) => isWorking(x.e)), waiting = flat.filter((x) => x.e.state === 'queued');
    if (!cur && !waiting.length) return '';
    const shows = new Set(waiting.map((x) => x.j.seriesId)).size;
    const wait = waiting.length ? `${waiting.length} waiting${shows > 1 ? ` across ${shows} shows` : ''}` : 'nothing waiting';
    if (qstate.paused && !cur) return `<div class="runrow"><b>Paused</b><span class="what">${wait}; nothing starts until you press Resume in the queue</span><span class="grow"></span>${extra}</div>`;
    if (cur) {
      const p = cur.e.state === 'importing' ? 100 : cur.e.progress ?? 0;
      return `<div class="runrow"><b>${cur.e.state === 'importing' ? 'Importing' : 'Downloading'}</b><span class="what">${esc(cur.j.title)} <span class="code">${cur.e.s}x${pad(cur.e.e)}</span> ${esc(cur.e.title)}</span>` +
        `<span class="grow"></span><span class="meta">${cur.e.state === 'importing' ? '' : p + '% · '}${wait}${qstate.paused ? ' · paused after this one' : ''}</span>${extra}</div>${prog(p, 'Current episode')}`;
    }
    const night = waiting.every((x) => x.j.auto);
    return `<div class="runrow"><b>${night ? 'Waiting for tonight' : 'Starting'}</b><span class="what">${wait}${night ? '; overnight runs go between ' + window.wcoNight() : ''}</span><span class="grow"></span>${extra}</div>`;
  }

  // ---------- Queue panel: what is running, what waits (in the order it will run), then finished runs ----------
  const qopen = new Set(); let lastQ = null;
  function renderQueue() {
    const active = allRuns.reduce((a, j) => a + j.episodes.filter((e) => ACTIVE.includes(e.state)).length, 0);
    $('queuecount').textContent = active ? String(active) : '';
    if ($('queue').hidden) return;
    const now = nowLine();
    $('queuenow').hidden = !now; if ($('queuenow').dataset.h !== now) { $('queuenow').dataset.h = now; $('queuenow').innerHTML = now; smooth($('queuenow'), 'queue'); }
    const open = new Set([...document.querySelectorAll('.qeps pre')].map((p) => p.dataset.key));
    // The server works through runs oldest first, so waiting runs are listed in that order; finished ones newest first.
    const rank = (j) => (j.episodes.some(isWorking) ? 0 : isLive(j) ? 1 : 2);
    const runs = allRuns.map((j, i) => ({ j, i, r: rank(j) })).sort((a, b) => a.r - b.r || (a.r === 1 ? b.i - a.i : a.i - b.i)).slice(0, 20).map((x) => x.j);
    const html = queueErr && !allRuns.length ? `<p class="status err">Could not read the queue: ${esc(queueErr)}</p>` : runs.length ? runs.map((j) => {
      const n = (st) => j.episodes.filter((e) => e.state === st).length;
      const live = isLive(j), all = qopen.has(j.id);
      const bits = Object.keys(STATE_TEXT).filter((st) => n(st)).map((st) => `${n(st)} ${STATE_TEXT[st]}`).join(' · ');
      const rows = j.episodes.filter((e) => e.state !== 'cancelled' && (all || e.state !== 'done'));
      const hidden = j.episodes.filter((e) => e.state !== 'cancelled').length - rows.length;
      return `<article class="qrun" data-id="${j.id}"><header><b>${esc(j.title)}</b>${j.auto ? '<span class="tag">overnight</span>' : ''}
        <span class="meta">${when(j.createdAt)} · ${j.language || 'default'} · ${bits}</span>
        <span class="grow"></span>${live && !j.episodes.some(isWorking) ? `<button class="btn" data-act="next" type="button" title="${j.auto ? 'Start this overnight run now, ahead of everything waiting' : 'Move this run to the head of the queue'}">${j.auto ? 'Run now' : 'Run next'}</button>` : ''}
        ${live ? `<button class="btn" data-act="cancel" type="button">Cancel</button>` : ''}
        ${!live && (n('failed') || n('kept') || n('cancelled')) ? `<button class="btn" data-act="retry" type="button">Retry (resumes partial downloads)</button>` : ''}
        <a class="linkbtn" href="/map.html?url=${encodeURIComponent(j.slug)}">Open map</a></header>
        <ul class="qeps">${rows.map((e) => {
          const key = j.id + ':' + e.id, bad = e.state === 'failed' || e.state === 'kept';
          const st = e.state === 'downloading' ? `${e.progress ?? 0}%` : STATE_TEXT[e.state];
          return `<li><span class="code">${e.s}x${pad(e.e)}</span><span>${esc(e.title)}${e.mode === 'swap' ? ' <span class="tag">swap</span>' : ''}
            ${e.message ? `<span class="msg">${esc(e.message)}</span>` : ''}</span>
            <span class="st ${bad ? 'bad' : e.state === 'done' ? 'ok' : ACTIVE.includes(e.state) ? 'live' : ''}">${esc(st)}
            ${bad || e.state === 'premium' ? ` · <button class="linkbtn" data-log="${key}" type="button">Log</button>` : ''}</span>
            ${open.has(key) ? `<pre data-key="${key}">Loading…</pre>` : ''}</li>`;
        }).join('')}${hidden || qopen.has(j.id) ? `<li class="hint"><span></span><span><button class="linkbtn" data-toggle="${j.id}" type="button">${hidden ? `Show the ${hidden} done` : 'Hide the ones done'}</button></span><span></span></li>` : ''}
        ${n('cancelled') ? `<li class="hint"><span></span><span>${n('cancelled')} cancelled${j.episodes.some((e) => /earlier run/.test(e.message || '')) ? ' (already queued in an earlier run)' : ''}</span><span></span></li>` : ''}</ul></article>`;
    }).join('') : '<p class="hint">No runs yet. Pick episodes on a show\'s map and they appear here.</p>';
    if (html === lastQ) return;                        // unchanged: leave the list alone so focus and open logs stay put
    lastQ = html; $('queuelist').innerHTML = html;
    for (const k of open) loadLog(k);
  }
  async function loadLog(key) {
    const [jid, eid] = key.split(':');
    const li = $('queuelist').querySelector(`[data-log="${key}"]`)?.closest('li'); if (!li) return;
    let pre = li.querySelector('pre');
    if (!pre) { pre = document.createElement('pre'); pre.dataset.key = key; li.appendChild(pre); }
    try { const r = await fetch(`/fill/jobs/${jid}/log/${eid}`); pre.textContent = await r.text(); } catch (e) { pre.textContent = 'Could not read the log: ' + e.message; }
  }
  $('queuelist').addEventListener('click', async (ev) => {
    const log = ev.target.closest('[data-log]');
    if (log) { const li = log.closest('li'), pre = li.querySelector('pre'); if (pre) pre.remove(); else loadLog(log.dataset.log); return; }
    const tog = ev.target.closest('[data-toggle]');
    if (tog) { const id = tog.dataset.toggle; qopen.has(id) ? qopen.delete(id) : qopen.add(id); renderQueue(); return; }
    const act = ev.target.closest('[data-act]'); if (!act) return;
    const id = act.closest('.qrun').dataset.id;
    try { await api('POST', `/fill/jobs/${id}/${act.dataset.act}`, {}); }
    catch (e) { status(`Could not ${act.dataset.act} that run: ${e.message}`, true); }
    poll();
  });
  function openQueue(on) {
    if (on) reveal($('queue')); else $('queue').hidden = true;
    $('queuebtn').setAttribute('aria-expanded', String(on));
    if (on) { lastQ = null; renderQueue(); poll(); $('queue').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }
  $('queuebtn').onclick = () => openQueue($('queue').hidden);
  $('queueclose').onclick = () => { openQueue(false); $('queuebtn').focus(); };
  $('pausebtn').onclick = async () => {
    try { qstate = await api('POST', '/fill/pause', { paused: !qstate.paused }); toast(qstate.paused ? 'Paused: the episode in hand finishes, nothing new starts' : 'Resumed'); }
    catch (e) { status(`Could not ${qstate.paused ? 'resume' : 'pause'} the queue: ${e.message}`, true); }
    lastQ = null; poll();
  };

  // ---------- Follow, and the home screen that lists what is followed ----------
  function setFollow(on) {
    $('follow').setAttribute('aria-pressed', String(on));
    $('followlabel').textContent = on ? 'Following overnight' : 'Follow overnight';
  }
  $('follow').onclick = async () => {
    if (!show?.series) return;
    const on = $('follow').getAttribute('aria-pressed') !== 'true';
    try {
      await api('POST', '/follow', { slug: show.slug, seriesId: show.series.id, follow: on, language: lang(), absolute: !!show.absolute });
      setFollow(on); show.follow = on;
      toast(on ? `Following: gaps${lang() === 'dub' ? ' and dub swaps' : ''} fill between ${window.wcoNight()}` : 'No longer following');
      loadFollowed();
    } catch (e) { status(`Could not change following: ${e.message}`, true); }
  };
  let followed = [], lastHome = null;
  async function loadFollowed() { followed = await api('GET', '/followed').catch(() => followed); renderHome(); }
  function renderHome() {
    if ($('empty').hidden) return;
    const now = nowLine('<button class="linkbtn" id="nowqueue" type="button">Open the queue</button>');
    $('now').hidden = !now;
    if ($('now').dataset.h !== now) { $('now').dataset.h = now; $('now').innerHTML = now; smooth($('now'), 'home'); $('nowqueue')?.addEventListener('click', () => openQueue(true)); }
    const act = new Map();                             // seriesId -> what the queue is doing for that show
    for (const j of allRuns) for (const e of j.episodes) if (ACTIVE.includes(e.state)) {
      const a = act.get(j.seriesId) || { n: 0, cur: null }; a.n++; if (isWorking(e)) a.cur = e; act.set(j.seriesId, a);
    }
    renderAttention();
    const f = $('ffilter').value.trim().toLowerCase(), name = (x) => x.title || x.slug;
    const needs = (x) => x.missing > 0 || x.undub > 0;
    const counted = followed.map((x) => x.countedAt).filter(Boolean).sort()[0];
    $('fcounted').textContent = counted ? `counted ${when(counted)}` : 'not counted yet, so dub swaps are not shown';
    const incomplete = $('fkind').querySelector('[aria-pressed=true]').dataset.v === 'incomplete';
    $('fincomplete').textContent = String(followed.filter(needs).length);
    const list = followed.filter((x) => (!f || name(x).toLowerCase().includes(f)) && (!incomplete || needs(x))).sort((a, b) => name(a).localeCompare(name(b), 'en', { sensitivity: 'base' }));
    $('fhead').hidden = !followed.length; $('ffilter').hidden = followed.length <= 12;
    $('fcount').textContent = followed.length ? String(followed.length) : '';
    $('fnone').textContent = !followed.length ? 'Paste a show link above to see its episodes. Shows you follow are listed here.'
      : !list.length ? (f ? `No followed show matches "${$('ffilter').value.trim()}".` : 'Every followed show has all its aired episodes, in the audio you follow it in.') : '';
    $('fnone').hidden = !$('fnone').textContent;
    const html = list.map((x) => {
      const a = act.get(x.seriesId);
      return `<li><a href="/map.html?url=${encodeURIComponent(x.slug)}" title="${esc(name(x))}">${esc(name(x))}</a>${x.language === 'sub' ? '<span class="tag">sub</span>' : ''}` +
        (x.switchTo ? `<span class="tag" title="Numbered ${x.switchTo === 'absolute' ? 'straight through' : 'by season'}, wcostream would supply more of this show's missing episodes. Open the show to switch.">check numbering</span>` : '') +
        (x.unlisted > 0 ? `<span class="tag" title="Last night's plan found ${x.unlisted} episode${x.unlisted === 1 ? '' : 's'} that wcostream does not list, so they were not queued">${x.unlisted} not on wcostream</span>` : '') +
        ((x.split || []).length ? `<span class="tag" title="Also in a folder Sonarr does not track: ${esc(x.split.join(', '))}. Some of the missing episodes may be there.">split</span>` : '') +
        (needs(x) ? `<span class="gapmark">${[x.missing > 0 && x.missing + ' missing', x.undub > 0 && x.undub + ' to dub'].filter(Boolean).join(' · ')}</span>` : '') +
        (a ? `<span class="live">${a.cur ? (a.cur.state === 'downloading' ? (a.cur.progress ?? 0) + '%' : 'importing') : a.n + ' queued'}</span>` : '') + '</li>';
    }).join('');
    if (html !== lastHome) { lastHome = html; $('followedlist').innerHTML = html; }
  }
  // Needs you: one row per episode whose newest attempt did not end in the library.
  const ATTN = { failed: 'Failed', kept: 'Downloaded, not imported', premium: 'Premium-only: Sonarr is searching' };
  let lastAttn = null;
  function renderAttention() {
    $('attention').hidden = !attention.length;
    $('attnhead').textContent = attention.length ? String(attention.length) : '';
    const open = new Set([...document.querySelectorAll('#attnlist pre')].map((p) => p.dataset.key));
    const html = attention.map((a) => {
      const key = a.jobId + ':' + a.id;
      return `<li data-job="${a.jobId}" data-ep="${a.id}"><span class="code">${a.s}x${pad(a.e)}</span><span class="what"><b>${esc(a.show)}</b> ${esc(a.title)}${a.mode === 'swap' ? ' <span class="tag">swap</span>' : ''}
        <span class="msg">${esc(ATTN[a.state])}${a.message ? ': ' + esc(a.message) : ''} · ${when(a.at)}${a.auto ? ' · overnight' : ''}</span></span>
        <span class="acts">${a.state === 'premium' ? '' : '<button class="btn" data-a="retry" type="button">Retry</button>'}<button class="linkbtn" data-a="log" type="button">Log</button>
        <a class="linkbtn" href="/map.html?url=${encodeURIComponent(a.slug)}">Open map</a><button class="linkbtn" data-a="dismiss" type="button">Dismiss</button></span>
        ${open.has(key) ? `<pre data-key="${key}">Loading…</pre>` : ''}</li>`;
    }).join('');
    if (html === lastAttn) return;
    lastAttn = html; $('attnlist').innerHTML = html;
    for (const k of open) attnLog(k);
  }
  async function attnLog(key) {
    const [jid, eid] = key.split(':');
    const li = $('attnlist').querySelector(`li[data-job="${jid}"][data-ep="${eid}"]`); if (!li) return;
    let pre = li.querySelector('pre');
    if (!pre) { pre = document.createElement('pre'); pre.dataset.key = key; li.appendChild(pre); }
    try { const r = await fetch(`/fill/jobs/${jid}/log/${eid}`); pre.textContent = await r.text(); } catch (e) { pre.textContent = 'Could not read the log: ' + e.message; }
  }
  $('attnlist').addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-a]'); if (!b) return;
    const li = b.closest('li'), jid = li.dataset.job, eid = li.dataset.ep;
    if (b.dataset.a === 'log') { const pre = li.querySelector('pre'); if (pre) pre.remove(); else attnLog(jid + ':' + eid); return; }
    try {
      await api('POST', `/fill/jobs/${jid}/${b.dataset.a}/${eid}`, {});
      toast(b.dataset.a === 'retry' ? 'Queued again: it resumes a partial download' : 'Dismissed');
    } catch (e) { status(`Could not ${b.dataset.a} that episode: ${e.message}`, true); }
    await loadAttention(true); poll();
  });
  $('recount').onclick = async () => {
    $('recount').disabled = true; toast('Counting every followed show in Sonarr. This takes a minute.');
    try { const r = await api('POST', '/followed/recount', {}); toast(`Counted ${r.counted} shows`); await loadFollowed(); }
    catch (e) { status(`Could not recount: ${e.message}`, true); }
    $('recount').disabled = false;
  };
  $('ffilter').addEventListener('input', renderHome);
  $('fkind').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { setSeg('fkind', b.dataset.v); renderHome(); } });
  $('ffilter').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') $('followedlist').querySelector('a')?.click(); });

  // The how-to stays folded once read; the choice is remembered on this device.
  try { $('help').open = localStorage.getItem('wco-help') === 'open'; } catch { /* private window: stay folded */ }
  $('help').addEventListener('toggle', () => { try { localStorage.setItem('wco-help', $('help').open ? 'open' : 'closed'); } catch { /* not remembered */ } });

  $('theme').onclick = () => { const r = document.documentElement; const dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; r.dataset.theme = dark ? 'light' : 'dark'; };
  const q = new URLSearchParams(location.search).get('url');
  if (location.hash === '#queue') openQueue(true);
  loadFollowed();
  if (q) { $('url').value = q; lookup(); } else poll();
})();
