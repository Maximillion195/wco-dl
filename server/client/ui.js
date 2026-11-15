// Shared by the episode map and the library screen (12 Nov 2026): the accent picker, a remembered light or dark
// choice, and the thin loading bar shown while the server is asking Sonarr or wcostream for something.
(() => {
  const root = document.documentElement;
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } } };

  // ---------- Accent: six measured colours; each is at least 4.5:1 as text on every surface, light and dark ----------
  const ACCENTS = [['indigo', 'Indigo'], ['blue', 'Blue'], ['teal', 'Teal'], ['green', 'Green'], ['rose', 'Rose'], ['violet', 'Violet'], ['graphite', 'Graphite']];
  const theme = document.getElementById('theme');
  if (theme) {
    const wrap = document.createElement('div'); wrap.className = 'looks';
    wrap.innerHTML = `<button class="btn btn-quiet" id="accentbtn" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="accents" aria-label="Accent colour"><span class="swatch"></span></button>
      <div class="accents" id="accents" role="radiogroup" aria-label="Accent colour" hidden>${ACCENTS.map(([v, label]) =>
        `<button type="button" role="radio" data-accent="${v}" aria-label="${label}" title="${label}"><span class="swatch"></span></button>`).join('')}</div>`;
    theme.before(wrap);
    const btn = wrap.querySelector('#accentbtn'), menu = wrap.querySelector('#accents');
    const mark = () => menu.querySelectorAll('[data-accent]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.accent === (root.dataset.accent || 'indigo'))));
    const open = (on) => { menu.hidden = !on; btn.setAttribute('aria-expanded', String(on)); if (on) { mark(); (menu.querySelector('[aria-checked=true]') || menu.firstElementChild).focus(); } };
    btn.onclick = () => open(menu.hidden);
    menu.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-accent]'); if (!b) return;
      root.dataset.accent = b.dataset.accent; store.set('wco-accent', b.dataset.accent); mark();
    });
    menu.addEventListener('keydown', (ev) => {
      const all = [...menu.querySelectorAll('[data-accent]')], i = all.indexOf(document.activeElement);
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') { ev.preventDefault(); all[(i + 1) % all.length].focus(); }
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') { ev.preventDefault(); all[(i - 1 + all.length) % all.length].focus(); }
      if (ev.key === 'Escape') { ev.stopPropagation(); open(false); btn.focus(); }
    });
    document.addEventListener('pointerdown', (ev) => { if (!menu.hidden && !wrap.contains(ev.target)) open(false); });
    // The page's own handler flips light and dark; remember what it chose.
    theme.addEventListener('click', () => setTimeout(() => store.set('wco-theme', root.dataset.theme || ''), 0));
  }

  // ---------- Settings (12 Nov 2026): the cog beside the light and dark button ----------
  const hh = (h) => String(h).padStart(2, '0') + ':00';
  let settings = { nightFrom: 1, nightTo: 7, nightBudget: 120, quality: '1080' };
  window.wcoNight = () => `${hh(settings.nightFrom)} and ${hh(settings.nightTo)}`;
  function showSettings() {
    document.querySelectorAll('[data-night]').forEach((e) => { e.textContent = window.wcoNight(); });
    document.querySelectorAll('[data-budget]').forEach((e) => { e.textContent = settings.nightBudget; });
    const q = document.getElementById('q');           // the map's quality choice starts at the default
    if (q && !q.dataset.touched) q.value = settings.quality;
  }
  document.getElementById('q')?.addEventListener('change', (ev) => { ev.target.dataset.touched = '1'; });
  const loaded = fetch('/settings').then((r) => (r.ok ? r.json() : settings)).then((s) => { settings = { ...settings, ...s }; showSettings(); }).catch(() => undefined);
  if (theme) {
    const cog = document.createElement('button');
    cog.className = 'btn btn-quiet'; cog.id = 'settingsbtn'; cog.type = 'button'; cog.setAttribute('aria-label', 'Settings'); cog.title = 'Settings';
    cog.innerHTML = '<svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>';
    theme.after(cog);
    const hours = [...Array(24).keys()].map((h) => `<option value="${h}">${hh(h)}</option>`).join('');
    const dlg = document.createElement('dialog');
    dlg.className = 'settings'; dlg.setAttribute('aria-labelledby', 'settingstitle');
    dlg.innerHTML = `<form method="dialog" id="settingsform">
      <h2 id="settingstitle">Settings</h2>
      <fieldset><legend>Overnight runs</legend>
        <div class="srow"><label for="s-from">Start</label><select id="s-from">${hours}</select><label for="s-to">Stop starting new episodes at</label><select id="s-to">${hours}</select></div>
        <div class="srow"><label for="s-budget">Episodes a night, at most</label><input id="s-budget" type="number" min="1" max="1000" step="1" inputmode="numeric"></div>
        <p class="hint">The night's plan is made five minutes after the start. Runs you start by hand ignore the window.</p>
      </fieldset>
      <fieldset><legend>Downloads</legend>
        <div class="srow"><label for="s-quality">Quality</label><select id="s-quality"><option value="1080">HD / FHD (best available)</option><option value="480">SD (480p)</option></select></div>
        <p class="hint">Used by overnight runs and offered first on the map. A refused HD file is tried once more in SD either way.</p>
      </fieldset>
      <p class="serr" id="s-err" role="alert" hidden></p>
      <div class="sacts"><button class="btn" type="button" id="s-cancel">Cancel</button><button class="btn btn-primary" type="submit" id="s-save">Save</button></div>
    </form>`;
    document.body.append(dlg);
    const f = (id) => dlg.querySelector('#' + id);
    cog.onclick = async () => {
      await loaded;
      f('s-from').value = settings.nightFrom; f('s-to').value = settings.nightTo; f('s-budget').value = settings.nightBudget; f('s-quality').value = settings.quality;
      f('s-err').hidden = true;
      dlg.showModal();
    };
    f('s-cancel').onclick = () => dlg.close();
    dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close(); });   // a press on the backdrop
    f('settingsform').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = (m) => { f('s-err').textContent = m; f('s-err').hidden = false; };
      if (f('s-from').value === f('s-to').value) return err('Start and stop are the same hour: the window would be empty.');
      const n = Number(f('s-budget').value);
      if (!Number.isInteger(n) || n < 1 || n > 1000) return err('Episodes a night must be a whole number from 1 to 1000.');
      f('s-save').disabled = true;
      try {
        const body = { nightFrom: Number(f('s-from').value), nightTo: Number(f('s-to').value), nightBudget: n, quality: f('s-quality').value };
        const r = await fetch('/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return err(d.message ? [].concat(d.message).join('; ') : `The server answered ${r.status}`);
        settings = { ...settings, ...d }; showSettings(); dlg.close();
      } catch (e) { err(`Not saved: ${e.message}`); } finally { f('s-save').disabled = false; }
    });
  }

  // ---------- Loading bar: appears after a short wait, so quick answers do not flash it ----------
  const bar = document.createElement('div'); bar.className = 'busy'; bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', 'Loading'); bar.hidden = true;
  bar.innerHTML = '<i></i>';
  document.body.prepend(bar);
  let pending = 0, timer = null;
  const QUIET = /^\/(fill\/jobs$|fill\/state|attention|followed$)/;   // the background polls stay silent
  window.wcoBusy = (url, promise) => {
    if (QUIET.test(url.split('?')[0])) return promise;
    pending++;
    if (!timer) timer = setTimeout(() => { if (pending) bar.hidden = false; }, 180);
    const done = () => { if (--pending <= 0) { pending = 0; clearTimeout(timer); timer = null; bar.hidden = true; } };
    promise.then(done, done);
    return promise;
  };
})();
