// the public download page: lists every version that's switched on in the admin panel
(function () {
  'use strict';
  const C = window.YSCore;

  // tiny safe builder: never uses innerHTML with outside text
  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    for (const k in attrs || {}) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach((c) => c && n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return n;
  }
  // release notes: plain text with "- " bullets and **bold**
  function notes(text) {
    const box = el('div', { class: 'notes' });
    let list = null;
    String(text || '').split(/\r?\n/).forEach((line) => {
      const bullet = /^\s*[-*]\s+/.test(line);
      if (!line.trim()) { list = null; return; }
      const target = bullet ? (list || (list = box.appendChild(el('ul')))).appendChild(el('li')) : (list = null, box.appendChild(el('p')));
      line.replace(/^\s*[-*]\s+/, '').split(/(\*\*[^*]+\*\*)/).forEach((part) => {
        if (/^\*\*[^*]+\*\*$/.test(part)) target.appendChild(el('b', { text: part.slice(2, -2) }));
        else if (part) target.appendChild(document.createTextNode(part));
      });
    });
    return box;
  }
  function size(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function date(s) { return new Date(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
  function kind(name) { return /\.exe$/i.test(name) ? 'exe' : /\.zip$/i.test(name) ? 'zip' : 'file'; }
  function label(name) { return { exe: 'Download .exe', zip: 'Download .zip', file: name }[kind(name)]; }

  function card(r, latest) {
    const assets = r.assets.slice().sort((a, b) => (kind(a.name) === 'exe' ? -1 : 0) - (kind(b.name) === 'exe' ? -1 : 0));
    return el('article', { class: 'ver' + (latest ? ' latest' : '') }, [
      el('div', { class: 'ver-head' }, [
        el('div', {}, [
          el('h3', { text: r.name || r.tag_name }),
          el('div', { class: 'muted', text: r.tag_name + (r.published_at ? '  ·  ' + date(r.published_at) : '') }),
        ]),
        latest ? el('span', { class: 'pill', text: 'Latest' }) : null,
      ]),
      r.body ? notes(r.body) : null,
      el('div', { class: 'dl' }, assets.length ? assets.map((a, i) =>
        el('a', { class: 'btn' + (i === 0 ? ' primary' : ''), href: a.browser_download_url, rel: 'noopener' }, [
          label(a.name), el('small', { text: size(a.size) }),
        ])) : [el('span', { class: 'muted', text: 'Files coming soon.' })]),
    ]);
  }

  const box = document.getElementById('versions');
  C.publicReleases().then((list) => {
    box.textContent = '';
    if (!list.length) { box.appendChild(el('div', { class: 'empty', text: 'No versions are available right now. Check back soon.' })); return; }
    list.forEach((r, i) => box.appendChild(card(r, i === 0)));
  }).catch((e) => {
    box.textContent = '';
    box.appendChild(el('div', { class: 'empty', text: e.status === 403 ? 'Too many visits from your network right now. Try again in a few minutes.' : 'Couldn’t load the versions. Refresh to try again.' }));
  });
})();
