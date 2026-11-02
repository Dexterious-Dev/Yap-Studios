// Yap++ Studio site: shared helpers (GitHub API + the admin password lock). No third-party code anywhere on the site.
//
// How the admin lock works:
//   The admin panel acts through a GitHub fine-grained token that can only touch this one repo. That token is stored in
//   admin.json ENCRYPTED (AES-256-GCM, key from the password via PBKDF2-SHA256, 600,000 rounds). The password itself is
//   never stored or sent anywhere, so there is nothing to look up: the only way in is to know the password, and a wrong
//   one simply fails to decrypt. Passwords are generated with 116+ bits of randomness, so guessing is not possible.
(function (root) {
  'use strict';
  const OWNER = 'Dexterious-Dev', REPO = 'Yap-Studios';
  const API = 'https://api.github.com/repos/' + OWNER + '/' + REPO;
  const ITER = 600000;
  const cryptoObj = root.crypto && root.crypto.subtle ? root.crypto : require('crypto').webcrypto;
  const subtle = cryptoObj.subtle;
  const te = new TextEncoder(), td = new TextDecoder();

  function b64(bytes) {
    const a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = '';
    for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(s) { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }

  async function api(path, opts) {
    opts = opts || {};
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(/^https:/.test(path) ? path : API + path, {
      method: opts.method || 'GET', headers, cache: 'no-store',
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    if (r.status === 204) return null;
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      const e = new Error((data && data.message) || 'GitHub said ' + r.status);
      e.status = r.status;
      throw e;
    }
    return data;
  }

  // ---- versions -----------------------------------------------------------------------------------------------------
  function versionKey(tag) { return String(tag || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0); }
  function newestFirst(a, b) {
    const x = versionKey(a.tag_name), y = versionKey(b.tag_name);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0);
    return 0;
  }
  // what visitors see: published releases only (drafts never appear without a token)
  async function publicReleases() { return (await api('/releases?per_page=100')).filter((r) => !r.draft).sort(newestFirst); }
  async function allReleases(token) { return (await api('/releases?per_page=100', { token })).sort(newestFirst); }
  function setVisible(token, id, visible) { return api('/releases/' + id, { token, method: 'PATCH', body: { draft: !visible } }); }
  function editRelease(token, id, fields) { return api('/releases/' + id, { token, method: 'PATCH', body: fields }); }

  // ---- the password lock ----------------------------------------------------------------------------------------------
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';   // no look-alikes (0/O, 1/l/I)
  function makePassword() {
    const out = [];
    while (out.length < 20) {
      const buf = cryptoObj.getRandomValues(new Uint8Array(32));
      for (const v of buf) if (v < 228 && out.length < 20) out.push(ALPHABET[v % 57]);   // 228 = 4*57: no bias
    }
    return [0, 5, 10, 15].map((i) => out.slice(i, i + 5).join('')).join('-');
  }
  async function deriveKey(password, salt, iter) {
    const base = await subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function lockToken(token, password) {
    const salt = cryptoObj.getRandomValues(new Uint8Array(16)), iv = cryptoObj.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, ITER);
    const data = await subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify({ token, made: new Date().toISOString() })));
    return { v: 1, kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt), iv: b64(iv), data: b64(data) };
  }
  async function unlockToken(lock, password) {
    if (!lock || lock.v !== 1 || !(lock.iter >= 100000)) throw new Error('admin.json is not valid');
    const key = await deriveKey(password, unb64(lock.salt), lock.iter);
    let plain;
    try { plain = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(lock.iv) }, key, unb64(lock.data)); }
    catch (e) { const err = new Error('Wrong password'); err.wrong = true; throw err; }
    return JSON.parse(td.decode(plain)).token;
  }
  async function readLock() {
    try {
      const f = await api('/contents/admin.json');
      return JSON.parse(td.decode(unb64(f.content.replace(/\s/g, ''))));
    } catch (e) { if (e.status === 404) return null; throw e; }
  }
  async function writeLock(token, lock) {
    let sha;
    try { sha = (await api('/contents/admin.json', { token })).sha; } catch (e) { if (e.status !== 404) throw e; }
    return api('/contents/admin.json', { token, method: 'PUT', body: { message: 'Update admin lock', content: b64(te.encode(JSON.stringify(lock, null, 2) + '\n')), sha } });
  }

  // ---- uploading a version ---------------------------------------------------------------------------------------------
  // Browsers can't upload straight into a GitHub release, so the files go into a short-lived "incoming" branch in one
  // commit; the "Publish uploaded version" Action then moves them into the release and deletes the branch.
  const TAG_RE = /^v\d+(\.\d+){0,2}$/;
  function safeName(n) { return String(n).replace(/[^A-Za-z0-9._+ ()-]/g, '_').slice(0, 120); }
  async function uploadVersion(token, info, step) {
    step = step || function () {};
    if (!TAG_RE.test(info.tag)) throw new Error('Version must look like v6.1');
    if (!info.files.length) throw new Error('Pick at least one file');
    step('Reading the repo...');
    const main = await api('/git/ref/heads/main', { token });
    const base = await api('/git/commits/' + main.object.sha, { token });
    const meta = { tag: info.tag, title: info.title || 'Yap++ Studio ' + info.tag, notes: info.notes || '', show: !!info.show };
    const entries = [];
    const all = info.files.map((f) => ({ path: safeName(f.name), bytes: f.bytes })).concat([{ path: 'meta.json', bytes: te.encode(JSON.stringify(meta)) }]);
    for (let i = 0; i < all.length; i++) {
      step('Uploading ' + all[i].path + ' (' + (i + 1) + ' of ' + all.length + ')...');
      const blob = await api('/git/blobs', { token, method: 'POST', body: { content: b64(all[i].bytes), encoding: 'base64' } });
      entries.push({ path: 'incoming/' + info.tag + '/' + all[i].path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    step('Packing the upload...');
    const tree = await api('/git/trees', { token, method: 'POST', body: { base_tree: base.tree.sha, tree: entries } });
    const commit = await api('/git/commits', { token, method: 'POST', body: { message: 'Upload ' + info.tag, tree: tree.sha, parents: [main.object.sha] } });
    step('Handing it to GitHub...');
    try { await api('/git/refs/heads/incoming', { token, method: 'PATCH', body: { sha: commit.sha, force: true } }); }
    catch (e) {
      if (e.status !== 422 && e.status !== 404) throw e;
      await api('/git/refs', { token, method: 'POST', body: { ref: 'refs/heads/incoming', sha: commit.sha } });
    }
    return commit.sha;
  }

  const Core = { OWNER, REPO, api, publicReleases, allReleases, setVisible, editRelease, makePassword, lockToken, unlockToken, readLock, writeLock, uploadVersion, newestFirst, TAG_RE };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core; else root.YSCore = Core;
})(typeof window !== 'undefined' ? window : globalThis);
