// the admin panel. The unlocked GitHub key only ever lives in this tab's memory: it's gone when you lock, close or refresh.
(function () {
  'use strict';
  if (window.top !== window.self) { document.body.textContent = ''; return; }   // never work inside someone else's frame
  const C = window.YSCore;
  const $ = (id) => document.getElementById(id);
  let token = null, lock = null, fails = 0, idleTimer = 0, busy = false;
  const IDLE_MS = 30 * 60 * 1000;

  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    for (const k in attrs || {}) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach((c) => c && n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return n;
  }
  function msg(id, text, kind) { const m = $(id); m.textContent = text || ''; m.className = 'msg' + (kind ? ' ' + kind : ''); }
  function show(view) {
    ['gate', 'setup', 'dash'].forEach((v) => $(v).classList.toggle('hidden', v !== view));
    $('topActs').classList.toggle('hidden', view !== 'dash');
  }
  function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
  function copy(text, btn) {
    navigator.clipboard.writeText(text).then(() => { btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy'; }, 1500); }, () => {});
  }

  // ---- lock / unlock ---------------------------------------------------------------------------------------------------
  function lockNow(note) {
    token = null;
    clearTimeout(idleTimer);
    $('pw').value = '';
    $('vlist').textContent = '';
    $('pwPanel').classList.add('hidden');
    show('gate');
    msg('loginMsg', note || '', note ? 'warn' : '');
  }
  function poke() { if (!token) return; clearTimeout(idleTimer); idleTimer = setTimeout(() => lockNow('Locked after 30 minutes without activity.'), IDLE_MS); }
  ['pointerdown', 'keydown'].forEach((e) => document.addEventListener(e, poke, true));

  async function loadLock() {
    try {
      lock = await C.readLock();
      if (!lock) { $('gateNote').textContent = 'Admin isn’t set up yet.'; show('setup'); }
    } catch (e) { msg('loginMsg', 'Couldn’t reach GitHub: ' + e.message, 'err'); }
  }

  $('loginForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (busy) return;
    const pw = $('pw').value.trim();
    if (!pw) return;
    busy = true; $('loginBtn').disabled = true;
    msg('loginMsg', 'Checking...');
    try {
      if (!lock) await loadLock();
      if (!lock) throw new Error('Admin isn’t set up yet.');
      token = await C.unlockToken(lock, pw);
      fails = 0;
      $('pw').value = '';
      msg('loginMsg', '');
      show('dash');
      poke();
      refresh();
    } catch (e) {
      token = null;
      fails++;
      await wait(Math.min(8000, 400 * 2 ** fails));   // slows down guessing by hand
      msg('loginMsg', e.wrong ? 'Wrong password.' : e.message, 'err');
    } finally { busy = false; $('loginBtn').disabled = false; }
  });
  $('lockBtn').addEventListener('click', () => lockNow());

  // ---- setup (first time, or a new GitHub key) ---------------------------------------------------------------------------
  let pendingToken = null, pendingPw = null;
  $('toSetup').addEventListener('click', (e) => { e.preventDefault(); show('setup'); });
  $('toLogin').addEventListener('click', (e) => { e.preventDefault(); show('gate'); });
  $('setupForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const t = $('tok').value.trim();
    if (!t) return;
    $('setupBtn').disabled = true;
    msg('setupMsg', 'Checking the token...');
    try {
      // a token that can list draft releases has write access to this repo
      await C.allReleases(t);
      const repo = await C.api('', { token: t });
      if (repo.full_name !== C.OWNER + '/' + C.REPO) throw new Error('That token is for a different repo.');
      pendingToken = t;
      pendingPw = C.makePassword();
      $('tok').value = '';
      $('newPwText').textContent = pendingPw;
      $('newPw').classList.remove('hidden');
      $('setupForm').classList.add('hidden');
      msg('setupMsg', 'Token works.', 'ok');
    } catch (e) {
      msg('setupMsg', e.status === 401 ? 'GitHub didn’t accept that token.' : e.status === 403 || e.status === 404 ? 'That token can’t manage Yap-Studios. Check it has Contents: Read and write on that repo.' : e.message, 'err');
    } finally { $('setupBtn').disabled = false; }
  });
  $('copyPw').addEventListener('click', () => copy(pendingPw, $('copyPw')));
  $('savedPw').addEventListener('change', () => { $('finishSetup').disabled = !$('savedPw').checked; });
  $('finishSetup').addEventListener('click', async () => {
    $('finishSetup').disabled = true;
    msg('setupMsg', 'Locking...');
    try {
      lock = await C.lockToken(pendingToken, pendingPw);
      await C.writeLock(pendingToken, lock);
      token = pendingToken;
      pendingToken = pendingPw = null;
      $('newPwText').textContent = '';
      $('newPw').classList.add('hidden');
      $('setupForm').classList.remove('hidden');
      $('savedPw').checked = false;
      msg('setupMsg', '');
      show('dash');
      poke();
      refresh();
    } catch (e) { msg('setupMsg', 'Couldn’t save: ' + e.message, 'err'); $('finishSetup').disabled = false; }
  });

  // ---- change password ---------------------------------------------------------------------------------------------------
  let nextPw = null;
  $('pwBtn').addEventListener('click', () => {
    nextPw = C.makePassword();
    $('chPwText').textContent = nextPw;
    $('chSaved').checked = false; $('chSave').disabled = true;
    msg('chMsg', '');
    $('pwPanel').classList.remove('hidden');
    $('pwPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  $('chCopy').addEventListener('click', () => copy(nextPw, $('chCopy')));
  $('chSaved').addEventListener('change', () => { $('chSave').disabled = !$('chSaved').checked; });
  $('chCancel').addEventListener('click', () => { nextPw = null; $('chPwText').textContent = ''; $('pwPanel').classList.add('hidden'); });
  $('chSave').addEventListener('click', async () => {
    $('chSave').disabled = true;
    msg('chMsg', 'Saving...');
    try {
      lock = await C.lockToken(token, nextPw);
      await C.writeLock(token, lock);
      nextPw = null;
      $('chPwText').textContent = '';
      msg('chMsg', 'Saved. Use the new password from now on.', 'ok');
      setTimeout(() => $('pwPanel').classList.add('hidden'), 2500);
    } catch (e) { msg('chMsg', 'Couldn’t save: ' + e.message, 'err'); $('chSave').disabled = false; }
  });

  // ---- versions ------------------------------------------------------------------------------------------------------
  let releases = [];
  function kb(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

  async function refresh() {
    if (!token) return;
    try {
      releases = await C.allReleases(token);
      render();
      msg('listMsg', '');
    } catch (e) {
      if (e.status === 401) lockNow('Your GitHub key stopped working (it may have expired). Use "Set up admin" with a new one.');
      else msg('listMsg', 'Couldn’t load versions: ' + e.message, 'err');
    }
  }

  async function setOn(r, on) {
    await C.setVisible(token, r.id, on);
  }

  function render() {
    const box = $('vlist');
    box.textContent = '';
    if (!releases.length) { box.appendChild(el('div', { class: 'msg', text: 'No versions yet. Upload one on the right.' })); return; }
    const newestOn = releases.find((r) => !r.draft);
    releases.forEach((r) => {
      const on = !r.draft;
      const sw = el('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': 'Show ' + r.tag_name + ' on the site' });
      sw.addEventListener('click', async () => {
        sw.disabled = true;
        msg('listMsg', (on ? 'Hiding ' : 'Showing ') + r.tag_name + '...');
        try { await setOn(r, !on); await refresh(); msg('listMsg', r.tag_name + (on ? ' is hidden.' : ' is on the site.'), 'ok'); }
        catch (e) { msg('listMsg', e.message, 'err'); sw.disabled = false; }
      });
      const notesBox = el('div', { class: 'hidden' }, [
        el('textarea', { 'aria-label': 'Notes for ' + r.tag_name }),
        el('div', { class: 'row end' }, [
          el('button', { class: 'btn small', type: 'button', text: 'Cancel', onclick: () => notesBox.classList.add('hidden') }),
          el('button', { class: 'btn small primary', type: 'button', text: 'Save notes', onclick: async (e) => {
            e.target.disabled = true;
            try { await C.editRelease(token, r.id, { body: notesBox.querySelector('textarea').value }); await refresh(); msg('listMsg', 'Notes saved.', 'ok'); }
            catch (err) { msg('listMsg', err.message, 'err'); e.target.disabled = false; }
          } }),
        ]),
      ]);
      notesBox.querySelector('textarea').value = r.body || '';
      const files = r.assets.length
        ? r.assets.map((a) => a.name + ' (' + kb(a.size) + ', ' + a.download_count + ' download' + (a.download_count === 1 ? '' : 's') + ')').join('  ·  ')
        : 'No files yet';
      box.appendChild(el('div', { class: 'vrow' }, [
        el('div', {}, [
          el('h4', {}, [r.name || r.tag_name, el('span', { class: 'state ' + (on ? 'on' : 'off'), text: on ? 'On site' : 'Hidden' }),
            r === newestOn ? el('span', { class: 'pill', text: 'Latest' }) : null]),
          el('div', { class: 'muted', text: r.tag_name }),
        ]),
        sw,
        el('div', { class: 'files', text: files }),
        el('div', { class: 'acts' }, [
          el('button', { class: 'btn small', type: 'button', text: 'Show only this one', onclick: async (e) => {
            e.target.disabled = true;
            msg('listMsg', 'Showing only ' + r.tag_name + '...');
            try {
              for (const o of releases) if (o.draft !== (o.id !== r.id)) await C.setVisible(token, o.id, o.id === r.id);
              await refresh();
              msg('listMsg', 'Only ' + r.tag_name + ' is on the site now.', 'ok');
            } catch (err) { msg('listMsg', err.message, 'err'); e.target.disabled = false; }
          } }),
          el('button', { class: 'btn small', type: 'button', text: 'Edit notes', onclick: () => notesBox.classList.toggle('hidden') }),
          el('button', { class: 'btn small', type: 'button', text: 'Add / replace files', onclick: () => {
            $('upTag').value = r.tag_name; $('upTitle').value = r.name || ''; $('upNotes').value = r.body || ''; $('upShow').checked = on;
            $('upFiles').focus();
            $('upForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
          } }),
        ]),
        el('div', { class: 'files' }, [notesBox]),
      ]));
    });
  }

  // ---- upload ----------------------------------------------------------------------------------------------------------
  $('upTag').addEventListener('input', () => {
    const t = $('upTag').value.trim();
    if (/^\d/.test(t)) $('upTag').value = 'v' + t;
    $('upTitle').placeholder = 'Yap++ Studio ' + ($('upTag').value.trim() || 'v6.1');
  });
  $('upForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const tag = $('upTag').value.trim();
    const picked = Array.from($('upFiles').files);
    if (!C.TAG_RE.test(tag)) return msg('upMsg', 'Version must look like v6.1', 'err');
    if (!picked.length) return msg('upMsg', 'Pick at least one installer file.', 'err');
    const big = picked.find((f) => f.size > 50 * 1048576);
    if (big) return msg('upMsg', big.name + ' is over 50 MB.', 'err');
    $('upBtn').disabled = true;
    const started = Date.now();
    try {
      const files = [];
      for (const f of picked) files.push({ name: f.name, size: f.size, bytes: new Uint8Array(await f.arrayBuffer()) });
      await C.uploadVersion(token, { tag, title: $('upTitle').value.trim(), notes: $('upNotes').value, show: $('upShow').checked, files }, (s) => msg('upMsg', s));
      // wait for the Action to move the files into the release
      for (let i = 0; i < 60; i++) {
        msg('upMsg', 'GitHub is putting the files in place... (' + (i * 5) + 's)');
        await wait(5000);
        const list = await C.allReleases(token);
        const r = list.find((x) => x.tag_name === tag);
        const done = r && files.every((f) => r.assets.some((a) => a.size === f.size && Date.parse(a.updated_at) >= started - 120000));
        if (done) {
          releases = list; render();
          msg('upMsg', tag + ' uploaded' + ($('upShow').checked ? ' and on the site.' : '. It’s hidden until you switch it on.'), 'ok');
          $('upForm').reset();
          return;
        }
      }
      msg('upMsg', 'Still working on GitHub’s side. Refresh this list in a minute (check the repo’s Actions tab if it doesn’t show).', 'warn');
    } catch (e) {
      msg('upMsg', 'Upload failed: ' + e.message, 'err');
    } finally { $('upBtn').disabled = false; }
  });

  if (location.hash === '#setup') show('setup');
  loadLock();
})();
