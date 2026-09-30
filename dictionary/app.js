/* Лексикон — English and English–Russian dictionary.
 * Data: Free Dictionary API (definitions, audio), Wiktionary (IPA UK/US, translations,
 * Russian → English), Datamuse (autocomplete, related words). */
'use strict';

/* ============ Helpers ============ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wordHref = (w) => '#/w/' + encodeURIComponent(w);
const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ');
const isCyr = (s) => /[Ѐ-ӿ]/.test(s);
const noStress = (s) => s.normalize('NFD').replace(/\u0301/g, '').normalize('NFC');
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const ICON = {
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
  speaker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5L12 19V5L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6.5"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
};

/* ============ Storage ============ */
const store = {
  get(key, def) { try { const v = localStorage.getItem('lex.' + key); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
  set(key, val) { try { localStorage.setItem('lex.' + key, JSON.stringify(val)); } catch (e) {} },
};
const favs = {
  all: () => store.get('favorites', []),
  has: (w) => favs.all().some((f) => f.word.toLowerCase() === w.toLowerCase()),
  toggle(item) {
    let list = favs.all();
    const on = !list.some((f) => f.word.toLowerCase() === item.word.toLowerCase());
    list = list.filter((f) => f.word.toLowerCase() !== item.word.toLowerCase());
    if (on) list.unshift({ ...item, t: Date.now() });
    store.set('favorites', list);
    return on;
  },
  remove(w) { store.set('favorites', favs.all().filter((f) => f.word.toLowerCase() !== w.toLowerCase())); },
  refresh(item) { store.set('favorites', favs.all().map((f) => (f.word.toLowerCase() === item.word.toLowerCase() ? { ...f, ...item } : f))); },
};
const history = {
  all: () => store.get('history', []),
  add(item) {
    const list = history.all().filter((h) => h.word.toLowerCase() !== item.word.toLowerCase());
    list.unshift({ ...item, t: Date.now() });
    store.set('history', list.slice(0, 300));
  },
  remove(w) { store.set('history', history.all().filter((h) => h.word.toLowerCase() !== w.toLowerCase())); },
  clear() { store.set('history', []); },
};

const SCOPES = [
  { id: 'all', label: 'Все словари' },
  { id: 'en', label: 'Толковый', tag: 'EN' },
  { id: 'ru', label: 'Англо-русский', tag: 'EN·RU' },
];
let scope = store.get('scope', 'all');
if (!SCOPES.some((s) => s.id === scope)) scope = 'all';

/* ============ Network ============ */
async function getJSON(url, { timeout = 12000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { clearTimeout(timer); }
}
const settle = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));

const api = {
  freeDict: (w) => getJSON('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(w.toLowerCase())),
  async wikitext(w) {
    for (const title of [...new Set([w, w.toLowerCase()])]) {
      const d = await getJSON('https://en.wiktionary.org/w/api.php?action=parse&format=json&formatversion=2&prop=wikitext&redirects=1&origin=*&page=' + encodeURIComponent(title));
      if (d && d.parse && d.parse.wikitext) return { title: d.parse.title, text: d.parse.wikitext };
    }
    return null;
  },
  async wikiDefs(w) {
    for (const title of [...new Set([w, w.toLowerCase()])]) {
      const d = await getJSON('https://en.wiktionary.org/api/rest_v1/page/definition/' + encodeURIComponent(title.replace(/ /g, '_')) + '?redirect=true');
      if (d) return d;
    }
    return null;
  },
  async suggest(q) {
    if (isCyr(q)) {
      const d = await getJSON('https://en.wiktionary.org/w/api.php?action=opensearch&format=json&limit=8&namespace=0&origin=*&search=' + encodeURIComponent(q), { timeout: 6000 });
      return d ? d[1] : [];
    }
    const d = await getJSON('https://api.datamuse.com/sug?max=8&s=' + encodeURIComponent(q), { timeout: 6000 });
    return (d || []).map((x) => x.word);
  },
  async related(w) {
    const d = await getJSON('https://api.datamuse.com/words?max=14&ml=' + encodeURIComponent(w), { timeout: 8000 });
    return (d || []).map((x) => x.word).filter((x) => x.toLowerCase() !== w.toLowerCase());
  },
  async spell(w) {
    const d = await getJSON('https://api.datamuse.com/words?max=8&sp=' + encodeURIComponent(w.replace(/[?*]/g, '')) + '&v=enwiki', { timeout: 6000 }).catch(() => null);
    const d2 = await getJSON('https://api.datamuse.com/sug?max=8&s=' + encodeURIComponent(w), { timeout: 6000 }).catch(() => null);
    const out = [...(d || []), ...(d2 || [])].map((x) => x.word).filter((x) => x.toLowerCase() !== w.toLowerCase());
    return [...new Set(out)].slice(0, 10);
  },
};

/* ============ Wikitext parsing ============ */
// Split template body by top-level "|", ignoring pipes inside [[...]] and {{...}}.
function splitParams(body) {
  const out = []; let depth = 0, cur = '';
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === '{{' || two === '[[') { depth++; cur += two; i++; continue; }
    if ((two === '}}' || two === ']]') && depth > 0) { depth--; cur += two; i++; continue; }
    if (body[i] === '|' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += body[i];
  }
  out.push(cur);
  const pos = [], named = {};
  out.forEach((p, i) => {
    const m = i > 0 && p.match(/^\s*([a-z0-9_-]+)\s*=([\s\S]*)$/i);
    if (m) named[m[1]] = m[2].trim(); else pos.push(p.trim());
  });
  return { name: (pos.shift() || '').trim(), pos, named };
}
// Iterate over top-level templates on a line: returns [{name,pos,named,start,end}]
function templates(line) {
  const res = []; let i = 0;
  while ((i = line.indexOf('{{', i)) !== -1) {
    let depth = 0, j = i;
    for (; j < line.length; j++) {
      if (line.startsWith('{{', j)) { depth++; j++; } else if (line.startsWith('}}', j)) { depth--; j++; if (depth === 0) break; }
    }
    if (depth !== 0) break;
    res.push({ ...splitParams(line.slice(i + 2, j - 1)), start: i, end: j + 1 });
    i = j + 1;
  }
  return res;
}
const stripLinks = (s) => String(s || '')
  .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
  .replace(/'''?/g, '')
  .replace(/<[^>]+>/g, '')
  .trim();

function langSection(text, lang) {
  const re = new RegExp('^==\\s*' + lang + '\\s*==\\s*$', 'm');
  const m = re.exec(text);
  if (!m) return '';
  const rest = text.slice(m.index + m[0].length);
  const next = /^==[^=].*==\s*$/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

const POS_NAMES = new Set(['Noun', 'Verb', 'Adjective', 'Adverb', 'Pronoun', 'Preposition', 'Conjunction', 'Interjection',
  'Determiner', 'Article', 'Numeral', 'Particle', 'Phrase', 'Prepositional phrase', 'Proper noun', 'Prefix', 'Suffix',
  'Idiom', 'Contraction', 'Proverb', 'Symbol', 'Letter', 'Abbreviation', 'Initialism', 'Acronym']);

function parseIPA(section) {
  const res = { uk: null, us: null, any: null };
  const regionOf = (s) => {
    if (/\b(UK|RP|Received Pronunciation|British|England|SSB)\b/i.test(s)) return 'uk';
    if (/\b(US|GA|GenAm|General American|American)\b/.test(s)) return 'us';
    return null;
  };
  for (const line of section.split('\n')) {
    if (!/\{\{IPA\|en\|/.test(line)) continue;
    const tps = templates(line);
    let accents = [];
    for (const t of tps) {
      if (t.name === 'a' || t.name === 'accent' || t.name === 'lb') accents.push(...t.pos);
      if (t.name === 'IPA' && t.pos[0] === 'en') {
        const ipa = t.pos.slice(1).find((p) => /^\//.test(p)) || t.pos.slice(1).find((p) => /^\[/.test(p));
        if (!ipa) continue;
        if (t.named.a) accents.push(...t.named.a.split(','));
        const regions = new Set(accents.map(regionOf).filter(Boolean));
        if (!regions.size && accents.length === 0) res.any = res.any || ipa;
        for (const r of regions) if (!res[r]) res[r] = ipa;
      }
    }
  }
  return res;
}

const GENDER_RU = { m: 'м.', f: 'ж.', n: 'ср.', p: 'мн.', impf: 'несов.', pf: 'сов.', 'm-p': 'м. мн.', 'f-p': 'ж. мн.', 'n-p': 'ср. мн.', 'm-an': 'м. одуш.', 'f-an': 'ж. одуш.' };
const T_NAMES = new Set(['t', 't+', 'tt', 'tt+', 't-check', 't+check', 't-simple']);
const QUAL_NAMES = new Set(['q', 'qual', 'qualifier', 'i', 'qf', 'gloss', 'gl', 'lb']);

function parseTranslationLine(line, lang) {
  const out = []; let qual = [];
  for (const t of templates(line)) {
    if (QUAL_NAMES.has(t.name)) { qual.push(...t.pos.filter((p) => p !== lang).map(stripLinks)); continue; }
    if (!T_NAMES.has(t.name) || t.pos[0] !== lang) continue;
    let term = stripLinks(t.named.alt || t.pos[1] || '');
    if (!term) continue;
    const genders = t.pos.slice(2).filter(Boolean).map((g) => GENDER_RU[g] || g);
    out.push({ term, genders, qual: qual.join(', ') });
    qual = [];
  }
  return out;
}

function parseTranslations(section) {
  const groups = []; let pos = null, inTrans = false, cur = null;
  for (const raw of section.split('\n')) {
    const line = raw.trim();
    const h = line.match(/^(={3,6})\s*([^=]+?)\s*\1$/);
    if (h) {
      const name = h[2].trim();
      if (POS_NAMES.has(name)) pos = name;
      inTrans = name === 'Translations';
      cur = null;
      continue;
    }
    if (!inTrans) continue;
    const tps = /^\{\{/.test(line) ? templates(line) : [];
    const head = tps[0];
    if (head && /^(trans-top|trans-top-also|checktrans-top|ttbc-top)$/.test(head.name)) {
      const gloss = head.named['1'] || head.pos.filter(Boolean).slice(-1)[0] || (head.name === 'checktrans-top' ? 'требует проверки' : '');
      cur = { pos, gloss: stripLinks(gloss), ru: [] };
      groups.push(cur);
      continue;
    }
    if (head && head.name === 'trans-see') {
      const target = head.pos[1] || head.pos[0];
      groups.push({ pos, gloss: stripLinks(head.pos[0]), see: stripLinks(target), ru: [] });
      cur = null;
      continue;
    }
    if (head && head.name === 'trans-bottom') { cur = null; continue; }
    if (!cur) continue;
    if (/^\*\s*Russian\s*:/.test(line)) cur.ru.push(...parseTranslationLine(line, 'ru'));
  }
  return groups;
}

/* ============ Sanitizing Wiktionary HTML ============ */
function cleanWikiHTML(html) {
  const doc = new DOMParser().parseFromString('<div>' + (html || '') + '</div>', 'text/html');
  const walk = (node) => {
    let s = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { s += esc(n.textContent); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (tag === 'style' || tag === 'script' || tag === 'sup' && n.classList.contains('reference')) continue;
      if (n.classList && (n.classList.contains('mw-ref') || n.classList.contains('reference'))) continue;
      const inner = walk(n);
      if (tag === 'a') {
        const href = n.getAttribute('href') || '';
        const m = href.match(/^\/wiki\/([^#?]+)/);
        const title = m ? decodeURIComponent(m[1]).replace(/_/g, ' ') : '';
        if (title && !title.includes(':')) s += '<a href="' + esc(wordHref(title)) + '">' + inner + '</a>';
        else s += inner;
      } else if (tag === 'b' || tag === 'strong') s += '<b>' + inner + '</b>';
      else if (tag === 'i' || tag === 'em') s += '<i>' + inner + '</i>';
      else if (tag === 'ul' || tag === 'ol' || tag === 'dl') s += '';
      else s += inner;
    }
    return s;
  };
  return walk(doc.body.firstChild).trim();
}

/* ============ Lookup (assemble one entry from all sources) ============ */
const cache = new Map();
function lookup(word) {
  const key = word.toLowerCase();
  if (!cache.has(key)) cache.set(key, lookupAny(word).catch((e) => { cache.delete(key); throw e; }));
  return cache.get(key);
}

// Offline data first; the online sources are only a fallback for words the local base does not have.
async function lookupAny(word) {
  const loc = await local.lookup(word).catch(() => null);
  if (loc && loc.found) return loc;
  if (loc && !navigator.onLine) return loc;
  try { return await doLookup(word); } catch (e) { if (loc) return loc; throw e; }
}

async function doLookup(word) {
  const foreign = isCyr(word);
  const [fd, wt, wd] = await Promise.all([
    settle(foreign ? Promise.resolve(null) : api.freeDict(word)),
    settle(foreign ? Promise.resolve(null) : api.wikitext(word)),
    settle(api.wikiDefs(word)),
  ]);
  if (!fd.ok && !wt.ok && !wd.ok) throw fd.e || wt.e || wd.e;

  const entry = { word, foreign, blocks: [], ipa: { uk: null, us: null, any: null }, audio: {}, trans: [], extra: [], rev: [], formNote: [], source: 'freedict' };

  // Definitions: Free Dictionary API
  if (fd.ok && Array.isArray(fd.v)) {
    const byPos = new Map();
    for (const e of fd.v) {
      entry.word = e.word || entry.word;
      if (e.phonetic && !entry.ipa.any) entry.ipa.any = e.phonetic;
      for (const p of e.phonetics || []) {
        if (p.audio) {
          const r = /-uk\.mp3/.test(p.audio) ? 'uk' : /-us\.mp3/.test(p.audio) ? 'us' : /-au\.mp3/.test(p.audio) ? 'au' : 'any';
          if (!entry.audio[r]) entry.audio[r] = p.audio;
          if (p.text && (r === 'uk' || r === 'us') && !entry.ipa[r + 'Fd']) entry.ipa[r + 'Fd'] = p.text;
        }
        if (p.text && !entry.ipa.any) entry.ipa.any = p.text;
      }
      for (const m of e.meanings || []) {
        const pos = m.partOfSpeech || '';
        if (!byPos.has(pos)) byPos.set(pos, { pos, defs: [], syn: [], ant: [] });
        const b = byPos.get(pos);
        for (const d of m.definitions || []) {
          b.defs.push({ def: esc(d.definition), ex: d.example ? [esc(d.example)] : [], syn: d.synonyms || [], ant: d.antonyms || [] });
        }
        b.syn.push(...(m.synonyms || []));
        b.ant.push(...(m.antonyms || []));
      }
    }
    for (const b of byPos.values()) { b.syn = [...new Set(b.syn)]; b.ant = [...new Set(b.ant)]; entry.blocks.push(b); }
  }

  // Wiktionary wikitext: UK/US IPA and translations
  if (wt.ok && wt.v) {
    const en = langSection(wt.v.text, 'English');
    if (en) {
      const ipa = parseIPA(en);
      entry.ipa.uk = ipa.uk; entry.ipa.us = ipa.us;
      if (!entry.ipa.any) entry.ipa.any = ipa.any;
      entry.trans = parseTranslations(en);
    }
    entry.wikiTitle = wt.v.title;
  }
  entry.ipa.uk = entry.ipa.uk || entry.ipa.ukFd || null;
  entry.ipa.us = entry.ipa.us || entry.ipa.usFd || null;

  // Wiktionary REST definitions: fallback for English, main source for Russian words
  if (wd.ok && wd.v) {
    const toBlocks = (arr) => (arr || []).map((p) => ({
      pos: (p.partOfSpeech || '').toLowerCase(),
      defs: (p.definitions || []).map((d) => ({
        def: cleanWikiHTML(d.definition),
        ex: (d.parsedExamples || []).map((x) => cleanWikiHTML(x.example)).concat(d.parsedExamples ? [] : (d.examples || []).map(cleanWikiHTML)).filter(Boolean).slice(0, 3),
        syn: [], ant: [],
      })).filter((d) => d.def),
      syn: [], ant: [],
    })).filter((b) => b.defs.length);
    if (foreign) {
      for (const l of ['ru', 'uk', 'be']) {
        if (wd.v[l]) { entry.rev = toBlocks(wd.v[l]); entry.revLang = l; entry.revLangName = wd.v[l][0]?.language; break; }
      }
    } else if (!entry.blocks.length && wd.v.en) {
      entry.blocks = toBlocks(wd.v.en);
      entry.source = 'wiktionary';
    }
  }

  entry.found = entry.blocks.length > 0 || entry.rev.length > 0 || entry.trans.some((g) => g.ru.length);
  return entry;
}

/* ============ Offline dictionary (data/ built by tools/build_dict.py) ============ */
const keyOf = (w) => String(w || '').toLowerCase().replace(/ё/g, 'е').normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC').trim();
// ASCII file name of a shard ("ко_" → "x43a-43e-5f"), mirrors file_name() in tools/build_dict.py.
const shardFile = (name) => (/^[a-z0-9_]+$/.test(name) ? name : 'x' + [...name].map((c) => c.codePointAt(0).toString(16)).join('-'));
const safePrefix = (k, n) => [...k.padEnd(n, '_').slice(0, n)].map((c) => (/[a-z0-9а-я]/.test(c) ? c : '_')).join('');
const TAG_RU = { m: 'м.', f: 'ж.', n: 'ср.', p: 'мн.', impf: 'несов.', pf: 'сов.', an: 'одуш.', colloq: 'разг.', formal: 'офиц.', informal: 'неформ.' };
const POS_EN = { adj: 'adjective', adv: 'adverb', pron: 'pronoun', prep: 'preposition', conj: 'conjunction', intj: 'interjection',
  det: 'determiner', num: 'number', abbrev: 'abbreviation', prep_phrase: 'prepositional phrase', affix: 'affix', infix: 'infix', circumfix: 'circumfix' };
const posName = (p) => POS_EN[p] || (p || '').replace(/_/g, ' ');
// Cache Storage only accepts http(s); the Windows app (app://) reads the base from disk anyway.
const canCache = 'caches' in window && /^https?:$/.test(location.protocol);
const AUDIO_BASE = 'https://upload.wikimedia.org/wikipedia/commons/';

const local = {
  meta: null,
  ready: null,
  shards: new Map(),
  lists: new Map(),
  cacheName: () => 'lex-data-' + local.meta.version,
  url: (path) => 'data/' + local.meta.version + '/' + path,

  init() {
    if (!local.ready) local.ready = (async () => {
      let meta = null;
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 5000);
        const res = await fetch('data/meta.json', { cache: 'no-cache', signal: ctl.signal });
        clearTimeout(t);
        if (res.ok) {
          meta = await res.clone().json();
          if (canCache) (await caches.open('lex-meta')).put('data/meta.json', res);
        }
      } catch (e) {}
      if (!meta && canCache) {
        const hit = await caches.open('lex-meta').then((c) => c.match('data/meta.json')).catch(() => null);
        if (hit) meta = await hit.json();
      }
      local.meta = meta;
      if (meta && canCache) {   // drop data of older builds
        caches.keys().then((ks) => ks.filter((k) => k.startsWith('lex-data-') && k !== local.cacheName()).forEach((k) => caches.delete(k)));
      }
      return !!meta;
    })();
    return local.ready;
  },

  async fetchText(path) {
    const url = local.url(path);
    let res = null, cache = null;
    if (canCache) { cache = await caches.open(local.cacheName()); res = await cache.match(url); }
    if (!res) {
      res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      if (cache) cache.put(url, res.clone()).catch(() => {});
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf[0] === 0x1f && buf[1] === 0x8b) {   // raw .gz (servers that already decoded it skip this)
      const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
      return await new Response(stream).text();
    }
    return new TextDecoder().decode(buf);
  },

  shardOf(lang, key) {
    const p2 = safePrefix(key, 2);
    return local.meta.langs[lang].split.includes(p2) ? safePrefix(key, 3) : p2;
  },

  async entries(lang, word) {
    const key = keyOf(word);
    if (!key) return [];
    const name = local.shardOf(lang, key);
    if (!(name in local.meta.langs[lang].shards)) return [];
    const id = lang + '/' + name;
    if (!local.shards.has(id)) {
      local.shards.set(id, local.fetchText(lang + '/' + shardFile(name) + '.json.gz').then(JSON.parse)
        .catch((e) => { local.shards.delete(id); throw e; }));
    }
    return (await local.shards.get(id))[key] || [];
  },

  list(lang, kind) {
    const id = lang + '-' + kind;
    if (!local.lists.has(id)) {
      local.lists.set(id, local.fetchText(id + '.txt.gz').then((t) => t.split('\n'))
        .catch((e) => { local.lists.delete(id); throw e; }));
    }
    return local.lists.get(id);
  },

  async rankMap(lang) {
    const id = lang + '-rank';
    if (!local.lists.has(id)) local.lists.set(id, local.list(lang, 'top').then((l) => new Map(l.map((w, i) => [keyOf(w), i]))));
    return local.lists.get(id);
  },

  async suggest(q, n = 8) {
    const lang = isCyr(q) ? 'ru' : 'en';
    const [words, rank] = await Promise.all([local.list(lang, 'words'), local.rankMap(lang)]);
    const k = keyOf(q);
    let lo = 0, hi = words.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (keyOf(words[mid]) < k) lo = mid + 1; else hi = mid; }
    const hits = [];
    for (let i = lo; i < words.length && hits.length < 400; i++) {
      const wk = keyOf(words[i]);
      if (!wk.startsWith(k)) break;
      hits.push(words[i]);
    }
    const score = (w) => (keyOf(w) === k ? -1 : rank.get(keyOf(w)) ?? 1e6 + w.length);
    return [...new Set(hits.sort((a, b) => score(a) - score(b)))].slice(0, n);
  },

  // Words spelled almost the same (for "not found").
  async similar(q, n = 10) {
    const lang = isCyr(q) ? 'ru' : 'en';
    const [words, rank] = await Promise.all([local.list(lang, 'words'), local.rankMap(lang)]);
    const k = keyOf(q);
    const dist = (a, b) => {
      if (Math.abs(a.length - b.length) > 2) return 9;
      let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
      for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
      }
      return prev[b.length];
    };
    const out = [];
    for (const w of words) {
      const wk = keyOf(w);
      if (wk[0] !== k[0] && wk[1] !== k[1]) continue;
      const d = dist(k, wk);
      if (d <= 2 && wk !== k) out.push([w, d * 1e6 + (rank.get(wk) ?? 5e5)]);
    }
    return out.sort((a, b) => a[1] - b[1]).slice(0, n).map((x) => x[0]);
  },

  async lookup(word) {
    if (!(await local.init())) return null;
    const lang = isCyr(word) ? 'ru' : 'en';
    const ents = await local.entries(lang, word);
    let lemmas = ents.filter((x) => !x.f);
    // "went", "was", "ran": the word's own entries are rare homographs without translations → lead with the lemma.
    const weak = lang === 'en' ? !lemmas.some((x) => x.tr) : !lemmas.length;
    // Skip notes from other spellings ("WAs" for "was") and, next to a real entry, links to rare words ("run" → "rin").
    const main = (lemmas[0] || ents[0] || {}).w;
    const rank = await local.rankMap(lang).catch(() => new Map());
    const formNote = [];
    for (const x of ents) {
      const notes = (x.f ? [{ g: x.g, f: x.f }] : []).concat(x.fo || []);
      for (const f of notes) {
        if (x.w !== main && ents.some((y) => y.w === main)) continue;
        if (!weak && !((rank.get(keyOf(f.f)) ?? 1e9) < (rank.get(keyOf(x.w)) ?? 1e9))) continue;
        formNote.push({ w: x.w, g: f.g, f: f.f });
      }
    }
    if (formNote.length && weak) {
      const target = (await local.entries(lang, formNote[0].f)).filter((x) => !x.f);
      if (target.length) lemmas = target.concat(lemmas);
    }
    if (lang === 'ru') return local.toRu(word, lemmas, formNote);
    return local.toEn(word, lemmas, formNote);
  },

  toEn(word, ents, formNote) {
    const e = { word: ents[0]?.w || word, foreign: false, blocks: [], ipa: { uk: null, us: null, any: null }, audio: {}, trans: [], extra: [], rev: [], source: 'local', formNote, phrases: { pv: [], id: [] } };
    for (const x of ents) {
      e.blocks.push({ pos: posName(x.p), word: x.w,
        defs: (x.s || []).map((s) => ({ def: esc(s.g), ex: (s.e || []).map(esc), syn: s.sy || [], ant: [] })),
        syn: x.sy || [], ant: x.an || [] });
      if (x.i) { e.ipa.uk = e.ipa.uk || x.i.uk || null; e.ipa.us = e.ipa.us || x.i.us || null; e.ipa.any = e.ipa.any || x.i.x || null; }
      if (x.a) for (const r of ['uk', 'us']) if (x.a[r] && !e.audio[r]) e.audio[r] = x.a[r].replace(/^~/, AUDIO_BASE);
      for (const g of x.tr || []) {
        e.trans.push({ pos: posName(x.p), gloss: g.s, ru: g.w.map(([term, tags]) => ({ term, genders: (tags || []).map((t) => TAG_RU[t] || t), qual: '' })) });
      }
      if (x.tx) e.extra.push({ pos: posName(x.p), words: x.tx });
      for (const kind of ['pv', 'id']) for (const [w, g] of (x.ph && x.ph[kind]) || []) {
        if (!e.phrases[kind].some((p) => p[0] === w)) e.phrases[kind].push([w, g]);
      }
    }
    e.found = e.blocks.length > 0;
    return e;
  },

  toRu(word, ents, formNote) {
    const e = { word: ents[0]?.w || word, foreign: true, blocks: [], ipa: {}, audio: {}, trans: [], extra: [], rev: [], source: 'local', formNote, revLangName: 'Russian' };
    for (const x of ents) {
      e.rev.push({ pos: posName(x.p), word: x.w,
        defs: (x.s || []).map((s) => ({ def: linkGloss(s.g),
          ex: (s.e || []).map(([ru, en]) => esc(ru) + (en ? ` <span class="ex__tr">— ${esc(en)}</span>` : '')), syn: [], ant: [] })),
        syn: [], ant: [] });
    }
    e.found = e.rev.length > 0;
    return e;
  },
};

// "cat, she-cat" → links to both English words; longer glosses stay plain text.
function linkGloss(g) {
  const m = g.match(/^((?:\([^)]*\)\s*)*)(.*)$/);
  const label = m[1], rest = m[2];
  const parts = rest.split(/([;,]\s*)/);
  const simple = parts.every((p, i) => i % 2 === 1 || /^(to\s+)?[A-Za-z][A-Za-z' -]{0,30}$/.test(p.trim()) && p.trim().split(/\s+/).length <= 4);
  const body = simple
    ? parts.map((p, i) => (i % 2 ? esc(p) : `<a href="${wordHref(p.trim().replace(/^to\s+/, ''))}">${esc(p)}</a>`)).join('')
    : esc(rest);
  return (label ? `<i>${esc(label.trim())}</i> ` : '') + body;
}

// Downloads every shard into the data cache so the whole dictionary works offline.
const offline = {
  running: false,
  async status() {
    if (!(await local.init())) return null;
    if (!canCache) return { done: 0, total: 1, bytes: 0, totalBytes: local.meta.bytes || 0 };
    const files = offline.files();
    const cache = await caches.open(local.cacheName());
    const have = new Set((await cache.keys()).map((r) => new URL(r.url).pathname.split('/data/')[1]));
    let done = 0, bytes = 0;
    for (const [path, size] of files) if (have.has(local.meta.version + '/' + path)) { done++; bytes += size; }
    return { done, total: files.length, bytes, totalBytes: files.reduce((s, f) => s + f[1], 0) };
  },
  files() {
    const out = [];
    for (const [lang, m] of Object.entries(local.meta.langs)) {
      out.push([lang + '-words.txt.gz', m.words], [lang + '-top.txt.gz', m.top]);
      for (const [name, size] of Object.entries(m.shards)) out.push([lang + '/' + shardFile(name) + '.json.gz', size]);
    }
    return out;
  },
  async downloadAll(onProgress) {
    if (offline.running) return;
    offline.running = true;
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      const cache = await caches.open(local.cacheName());
      const files = offline.files();
      const total = files.reduce((s, f) => s + f[1], 0);
      let bytes = 0, i = 0, failed = 0;
      const worker = async () => {
        while (i < files.length) {
          const [path, size] = files[i++];
          const url = local.url(path);
          try { if (!(await cache.match(url))) await cache.add(url); } catch (e) { failed++; }
          bytes += size;
          onProgress && onProgress(bytes, total);
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      if (failed) throw new Error(failed + ' files failed');
    } finally { offline.running = false; }
  },
};
const mb = (b) => (b / 1048576).toFixed(b < 10485760 ? 1 : 0).replace('.', ',') + ' МБ';

/* ============ Speech ============ */
let currentAudio = null;
function speak(text, lang, btn) {
  if (!('speechSynthesis' in window)) { toast('Озвучка недоступна в этом браузере'); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  const voice = speechSynthesis.getVoices().find((v) => v.lang.replace('_', '-').toLowerCase() === lang.toLowerCase())
    || speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2)));
  if (voice) u.voice = voice;
  u.rate = 0.92;
  if (btn) { btn.classList.add('is-playing'); u.onend = u.onerror = () => btn.classList.remove('is-playing'); }
  speechSynthesis.speak(u);
}
function playPron(entry, region, btn) {
  const url = entry.audio[region] || (region === 'uk' ? null : entry.audio.any);
  if (url) {
    if (currentAudio) currentAudio.pause();
    currentAudio = new Audio(url);
    btn.classList.add('is-playing');
    const done = () => btn.classList.remove('is-playing');
    currentAudio.onended = done;
    currentAudio.onerror = () => { done(); speak(entry.word, region === 'uk' ? 'en-GB' : 'en-US', btn); };
    currentAudio.play().catch(() => { done(); speak(entry.word, region === 'uk' ? 'en-GB' : 'en-US', btn); });
  } else speak(entry.word, region === 'uk' ? 'en-GB' : 'en-US', btn);
}

/* ============ Toast ============ */
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('is-on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('is-on'), 2200);
}

/* ============ Views ============ */
const app = $('#app');
const RU_POS = { noun: 'существительное', verb: 'глагол', adjective: 'прилагательное', adverb: 'наречие', pronoun: 'местоимение',
  preposition: 'предлог', conjunction: 'союз', interjection: 'междометие', determiner: 'определитель', article: 'артикль',
  numeral: 'числительное', particle: 'частица', phrase: 'фраза', 'proper noun': 'имя собственное', prefix: 'приставка',
  suffix: 'суффикс', idiom: 'идиома', exclamation: 'восклицание', abbreviation: 'сокращение', 'prepositional phrase': 'предложная фраза',
  contraction: 'стяжение', proverb: 'пословица', symbol: 'символ', number: 'числительное', affix: 'аффикс' };
const ruPos = (p) => RU_POS[(p || '').toLowerCase()] || (p || '').toLowerCase();

function scopeChips() {
  return '<div class="scopes" role="group" aria-label="Словарь">' + SCOPES.map((s) =>
    `<button type="button" class="scope" data-scope="${s.id}" aria-pressed="${scope === s.id}">${esc(s.label)}${s.tag ? `<span class="scope__tag">${s.tag}</span>` : ''}</button>`
  ).join('') + '</div>';
}
function bindScopes(root, onChange) {
  $$('.scope', root).forEach((b) => b.addEventListener('click', () => {
    scope = b.dataset.scope; store.set('scope', scope);
    $$('.scope', root).forEach((x) => x.setAttribute('aria-pressed', x.dataset.scope === scope));
    onChange && onChange();
  }));
}

const WOTD = ['serendipity', 'ephemeral', 'resilient', 'eloquent', 'wanderlust', 'meticulous', 'ubiquitous', 'benevolent', 'candid',
  'diligent', 'nostalgia', 'pragmatic', 'quaint', 'tenacious', 'whimsical', 'zealous', 'ambiguous', 'catalyst', 'dazzling', 'enigma',
  'frugal', 'gregarious', 'haven', 'intrepid', 'jubilant', 'kindle', 'luminous', 'mellow', 'nimble', 'oblivious', 'placid', 'quench',
  'reverie', 'solace', 'thrive', 'unravel', 'vivid', 'wistful', 'yearn', 'zest', 'breeze', 'cherish', 'delight', 'embrace', 'flourish',
  'glimmer', 'harmony', 'insight', 'journey', 'kinship', 'linger', 'marvel', 'nurture', 'overcome', 'ponder', 'radiant', 'savour',
  'tranquil', 'uplift', 'venture', 'wonder'];
const wordOfDay = () => WOTD[Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 864e5) % WOTD.length];

function renderHome() {
  document.title = 'Лексикон — английский словарь';
  const hist = history.all().slice(0, 14);
  const fav = favs.all().slice(0, 14);
  const w = wordOfDay();
  const tries = ['run', 'beautiful', 'take off', 'look forward to', 'кошка'];
  app.innerHTML = `
    <section class="hero fade-in">
      <h1 class="hero__title">Слова, которые <em>открываются</em></h1>
      <p class="hero__sub">Английский толковый и англо-русский словарь: определения, произношение UK и US, примеры и переводы.</p>
      <form class="search search--hero" id="heroSearch" role="search" autocomplete="off">
        ${ICON.search.replace('<svg', '<svg class="search__icon"')}
        <input class="search__input" type="search" name="q" placeholder="Слово по-английски или по-русски" aria-label="Поиск слова" spellcheck="false" autocapitalize="off" enterkeyhint="search" autofocus>
        <button class="search__go" type="submit">Найти</button>
        <ul class="suggest" role="listbox" hidden></ul>
      </form>
      ${scopeChips()}
      <p class="hero__try">Попробуйте: ${tries.map((t) => `<a href="${wordHref(t)}">${esc(t)}</a>`).join(' · ')}</p>
    </section>

    <div class="home-grid">
      <article class="card wotd fade-in">
        <h2 class="panel__title">${ICON.spark} Слово дня</h2>
        <div class="wotd__word"><a href="${wordHref(w)}">${esc(w)}</a></div>
        <div class="wotd__meta" id="wotdMeta"></div>
        <p class="wotd__def is-loading" id="wotdDef">Загружаем определение…</p>
        <a class="btn" href="${wordHref(w)}">Открыть статью ${ICON.arrow}</a>
      </article>
      <div style="display:flex;flex-direction:column;gap:24px">
        <section class="card panel offline fade-in" id="offlinePanel" hidden>
          <h2 class="panel__title"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19.5h14"/></svg> Офлайн-словарь</h2>
          <p class="offline__text" id="offText"></p>
          <div class="progress" id="offProg" hidden><div class="progress__bar"></div></div>
          <button class="btn" id="offBtn" type="button" hidden></button>
        </section>
        <section class="card panel fade-in">
          <h2 class="panel__title">${ICON.clock} Недавние ${hist.length ? '<a href="#/history">Вся история</a>' : ''}</h2>
          ${hist.length ? `<div class="chips">${hist.map((h) => `<a class="chip" href="${wordHref(h.word)}">${esc(h.word)}</a>`).join('')}</div>` : '<p class="empty">Здесь появятся слова, которые вы искали.</p>'}
        </section>
        <section class="card panel fade-in">
          <h2 class="panel__title">${ICON.star} Избранное ${fav.length ? '<a href="#/favorites">Все</a>' : ''}</h2>
          ${fav.length ? `<div class="chips">${fav.map((h) => `<a class="chip" href="${wordHref(h.word)}">${esc(h.word)}</a>`).join('')}</div>` : '<p class="empty">Нажмите звёздочку в статье, чтобы сохранить слово.</p>'}
        </section>
      </div>
    </div>

    <div class="features">
      <div class="card feature" style="--band:var(--band-en)"><span class="code">EN</span><h3>Толковый словарь</h3><p>Значения по частям речи, примеры, синонимы и антонимы.</p></div>
      <div class="card feature" style="--band:var(--band-ru)"><span class="code">EN · RU</span><h3>Англо-русский</h3><p>Переводы по значениям, с ударением, родом и видом глагола. Озвучка на русском.</p></div>
      <div class="card feature" style="--band:var(--band-rev)"><span class="code">RU · EN</span><h3>Русско-английский</h3><p>Введите русское слово — получите английские значения и примеры.</p></div>
    </div>`;
  setupSearch($('#heroSearch'));
  bindScopes(app);
  paintOffline();

  lookup(w).then((e) => {
    const def = $('#wotdDef'); if (!def) return;
    const b = e.blocks[0];
    def.classList.remove('is-loading');
    def.innerHTML = b ? b.defs[0].def : 'Откройте статью, чтобы узнать значение.';
    const ipa = e.ipa.uk || e.ipa.any;
    $('#wotdMeta').innerHTML = (b ? `<span class="pos">${esc(b.pos)}</span>` : '') + (ipa ? `<span class="pron__ipa">${esc(ipa)}</span>` : '');
  }).catch(() => { const def = $('#wotdDef'); if (def) { def.classList.remove('is-loading'); def.textContent = 'Нет соединения — определение появится, когда вы будете онлайн.'; } });
}

async function paintOffline() {
  const panel = $('#offlinePanel');
  const st = await offline.status().catch(() => null);
  if (!panel || !panel.isConnected || !st) return;
  const m = local.meta.langs, text = $('#offText'), btn = $('#offBtn'), prog = $('#offProg');
  const counts = `${plural(m.en.count, 'английское слово', 'английских слова', 'английских слов')} и ${plural(m.ru.count, 'русское', 'русских', 'русских')}`;
  panel.hidden = false;
  if (location.protocol === 'app:' || ['127.0.0.1', 'localhost'].includes(location.hostname)) {   // Windows app / Start-Lexikon.bat: the base is already on this computer
    panel.classList.add('is-done');
    text.innerHTML = `<b>Словарь установлен на этом компьютере</b> — ${counts}. Интернет не нужен.`;
    btn.hidden = true; prog.hidden = true;
    return;
  }
  if (st.done === st.total) {
    panel.classList.add('is-done');
    text.innerHTML = `<b>Весь словарь на устройстве</b> — ${counts}. Интернет не нужен.`;
    btn.hidden = true; prog.hidden = true;
    return;
  }
  text.innerHTML = `В словаре ${counts}. Скачайте его целиком, чтобы искать без интернета.` +
    (st.bytes ? `<br><small>Уже сохранено ${mb(st.bytes)} из ${mb(st.totalBytes)}.</small>` : '');
  btn.hidden = false;
  btn.textContent = (st.bytes ? 'Докачать' : 'Скачать весь словарь') + ' · ' + mb(st.totalBytes - st.bytes);
  btn.onclick = async () => {
    btn.disabled = true; prog.hidden = false;
    const bar = $('.progress__bar', prog);
    try {
      await offline.downloadAll((b, t) => {
        bar.style.width = (100 * b / t).toFixed(1) + '%';
        btn.textContent = 'Скачиваем… ' + Math.floor(100 * b / t) + '%';
      });
      toast('Словарь сохранён — теперь он работает без интернета');
    } catch (e) {
      toast('Не всё скачалось — нажмите ещё раз, чтобы докачать');
    }
    btn.disabled = false;
    paintOffline();
  };
}

function skeleton() {
  return `<div class="layout"><div><div class="card head"><div class="sk sk--title"></div><div class="sk sk--line" style="width:30%"></div></div>
    <div class="card dict"><div class="dict__body" style="padding-top:20px">${'<div class="sk sk--line"></div>'.repeat(3)}<div class="sk sk--line" style="width:60%"></div></div></div></div><div></div></div>`;
}

let renderSeq = 0;
async function renderEntry(word) {
  const seq = ++renderSeq;
  document.title = word + ' — Лексикон';
  app.innerHTML = skeleton();
  let e;
  try { e = await lookup(word); } catch (err) {
    if (seq !== renderSeq) return;
    app.innerHTML = `<div class="emptystate fade-in"><div class="emptystate__art">⌁</div><h2>Нет связи со словарём</h2>
      <p>Проверьте интернет и попробуйте ещё раз. Слова, которые вы уже открывали, доступны офлайн.</p>
      <button class="btn" id="retry">Повторить</button></div>`;
    $('#retry').onclick = () => renderEntry(word);
    return;
  }
  if (seq !== renderSeq) return;
  if (!e.found) return renderNotFound(word, seq);

  const firstDef = e.blocks[0]?.defs[0]?.def || e.rev[0]?.defs[0]?.def || '';
  const snap = { word: e.word, ipa: e.ipa.uk || e.ipa.any || '', def: firstDef.replace(/<[^>]+>/g, '') };
  history.add(snap);
  favs.refresh(snap);

  const posList = [...new Set((e.foreign ? e.rev : e.blocks).map((b) => b.pos).filter(Boolean))];
  const prons = [];
  if (!e.foreign) {
    const uk = e.ipa.uk || e.ipa.any || e.ipa.us, us = e.ipa.us || e.ipa.any || e.ipa.uk;
    prons.push(`<button class="pron" data-region="uk" type="button" title="Британское произношение"><span class="pron__region">UK</span><span class="pron__ipa">${esc(uk || '')}</span>${ICON.speaker}</button>`);
    prons.push(`<button class="pron" data-region="us" type="button" title="Американское произношение"><span class="pron__region pron__region--us">US</span><span class="pron__ipa">${esc(us || '')}</span>${ICON.speaker}</button>`);
  } else {
    prons.push(`<button class="pron" data-say="ru-RU" type="button"><span class="pron__region">RU</span>${ICON.speaker}</button>`);
  }

  const sections = [];
  const show = (id) => scope === 'all' || scope === id;
  if (e.foreign) sections.push(revSection(e));
  else {
    if (show('en')) sections.push(enSection(e));
    if (show('ru')) sections.push(transSection(e, 'ru'));
  }

  app.innerHTML = `
    <div class="layout fade-in">
      <div>
        <div class="crumbs"><a href="#/">Лексикон</a> › ${e.foreign ? 'Русско-английский' : 'Английский'} › ${esc(e.word)}</div>
        <article class="card head">
          <div class="head__row">
            <h1 class="headword"${e.foreign ? ' lang="ru"' : ''}>${esc(e.word)}</h1>
            <div class="head__actions">
              <button class="roundbtn" id="shareBtn" type="button" title="Поделиться" aria-label="Поделиться">${ICON.share}</button>
              <button class="roundbtn${favs.has(e.word) ? ' is-on' : ''}" id="favBtn" type="button" aria-pressed="${favs.has(e.word)}" title="В избранное" aria-label="В избранное">${ICON.star}</button>
            </div>
          </div>
          ${posList.length ? `<div class="pos-list">${posList.map((p) => `<span class="pos">${esc(p)}</span>`).join('')}</div>` : ''}
          <div class="prons">${prons.join('')}</div>
          ${e.formNote && e.formNote.length ? `<div class="formnote">${e.formNote.map((f) => `<p><b>${esc(f.w)}</b> — ${esc(f.g)}${keyOf(f.f) !== keyOf(e.word) ? ` → <a href="${wordHref(noStress(f.f))}">${esc(f.f)}</a>` : ''}</p>`).join('')}</div>` : ''}
        </article>
        ${e.foreign ? '' : scopeChips().replace('class="scopes"', 'class="scopes" style="justify-content:flex-start;margin-top:18px"')}
        <div id="sections">${sections.join('')}</div>
      </div>
      <aside class="aside">
        <section class="card panel" id="relatedPanel" ${e.foreign ? 'hidden' : ''}>
          <h2 class="panel__title">${ICON.link} Похожие слова</h2>
          <div class="chips" id="related"><span class="empty">Загружаем…</span></div>
        </section>
        <section class="card panel">
          <h2 class="panel__title">${ICON.clock} Недавние <a href="#/history">Все</a></h2>
          <ul class="wordlist">${history.all().slice(1, 9).map((h) => `<li><a href="${wordHref(h.word)}">${esc(h.word)}<small>${esc(h.ipa || '')}</small></a></li>`).join('') || '<li class="empty">Пока пусто</li>'}</ul>
        </section>
      </aside>
    </div>`;

  $$('.pron').forEach((b) => b.addEventListener('click', () => b.dataset.say ? speak(e.word, b.dataset.say, b) : playPron(e, b.dataset.region, b)));
  const favBtn = $('#favBtn');
  favBtn.onclick = () => {
    const on = favs.toggle(snap);
    favBtn.classList.toggle('is-on', on); favBtn.setAttribute('aria-pressed', on);
    favBtn.classList.remove('pop'); void favBtn.offsetWidth; favBtn.classList.add('pop');
    toast(on ? 'Добавлено в избранное' : 'Убрано из избранного');
  };
  $('#shareBtn').onclick = async () => {
    const url = location.href;
    if (navigator.share) { try { await navigator.share({ title: e.word, text: snap.def, url }); return; } catch (x) { return; } }
    try { await navigator.clipboard.writeText(url); toast('Ссылка скопирована'); } catch (x) { toast(url); }
  };
  bindSections(e);
  bindScopes(app, () => {
    const s = [];
    if (scope === 'all' || scope === 'en') s.push(enSection(e));
    if (scope === 'all' || scope === 'ru') s.push(transSection(e, 'ru'));
    $('#sections').innerHTML = s.join('');
    bindSections(e);
  });

  const syns = [...new Set(e.blocks.flatMap((b) => [...b.syn, ...b.defs.flatMap((d) => d.syn)]))];
  if (!e.foreign) (syns.length || e.source === 'local' ? Promise.resolve(syns.slice(0, 16)) : api.related(e.word)).then((list) => {
    const el = $('#related'); if (!el || seq !== renderSeq) return;
    if (!list.length) { $('#relatedPanel').hidden = true; return; }
    el.innerHTML = list.map((w) => `<a class="chip" href="${wordHref(w)}">${esc(w)}</a>`).join('');
  }).catch(() => { const p = $('#relatedPanel'); if (p) p.hidden = true; });
}

function bindSections(e) {
  $$('.tword__say').forEach((b) => b.addEventListener('click', () => speak(b.dataset.text, b.dataset.lang, b)));
  $$('.linkbtn[data-more]').forEach((b) => b.addEventListener('click', () => {
    $$('[data-extra="' + b.dataset.more + '"]').forEach((x) => (x.hidden = false));
    b.remove();
  }));
}

function nyms(label, list, cls) {
  if (!list || !list.length) return '';
  return `<div class="nyms ${cls || ''}"><span class="nyms__label">${label}</span>${list.slice(0, 12).map((w) => `<a class="chip" href="${wordHref(w)}">${esc(w)}</a>`).join('')}</div>`;
}

function defBlocks(blocks, word) {
  return blocks.map((b, bi) => {
    const LIMIT = 8;
    const senses = b.defs.map((d, i) => `
      <li class="sense"${i >= LIMIT ? ` data-extra="b${bi}" hidden` : ''}>
        <div class="sense__def">${d.def}</div>
        ${d.ex.length ? `<ul class="ex-list">${d.ex.map((x) => `<li class="ex">${x}</li>`).join('')}</ul>` : ''}
        ${nyms('Синонимы', d.syn)}${nyms('Антонимы', d.ant, 'nyms--ant')}
      </li>`).join('');
    return `<section class="posblock">
      <div class="posblock__head"><span class="posblock__word"${isCyr(b.word || word) ? ' lang="ru"' : ''}>${esc(b.word || word)}</span><span class="posblock__pos">${esc(b.pos)}</span></div>
      <ol class="senses">${senses}</ol>
      ${b.defs.length > LIMIT ? `<div class="more"><button class="linkbtn" data-more="b${bi}" type="button">Ещё ${b.defs.length - LIMIT} значений</button></div>` : ''}
      ${nyms('Синонимы', b.syn)}${nyms('Антонимы', b.ant, 'nyms--ant')}
    </section>`;
  }).join('');
}

function phraseBlock(title, list, id) {
  if (!list || !list.length) return '';
  const LIMIT = 10;
  return `<section class="posblock phr">
    <div class="posblock__head"><span class="posblock__word">${title}</span><span class="posblock__pos">${list.length}</span></div>
    <ul class="phrlist">${list.map(([w, g], i) => `<li${i >= LIMIT ? ` data-extra="ph${id}" hidden` : ''}><a href="${wordHref(w)}">${esc(w)}</a>${g ? `<span>${esc(g)}</span>` : ''}</li>`).join('')}</ul>
    ${list.length > LIMIT ? `<div class="more"><button class="linkbtn" data-more="ph${id}" type="button">Показать все (${list.length})</button></div>` : ''}
  </section>`;
}

function band(cls, code, title, srcUrl, srcName) {
  return `<div class="dict__band"><span class="dict__code">${code}</span><h2>${title}</h2>${srcUrl ? `<a class="dict__src" href="${esc(srcUrl)}" target="_blank" rel="noopener">${srcName}</a>` : ''}</div>`;
}
const wiktUrl = (e) => 'https://en.wiktionary.org/wiki/' + encodeURIComponent((e.wikiTitle || e.word).replace(/ /g, '_'));

function enSection(e) {
  const body = (e.blocks.length ? defBlocks(e.blocks, e.word) : '<p class="note">Толкование для этого слова не найдено — посмотрите переводы ниже.</p>')
    + phraseBlock('Фразовые глаголы', e.phrases && e.phrases.pv, 'pv') + phraseBlock('Выражения и идиомы', e.phrases && e.phrases.id, 'id');
  const src = e.source === 'freedict' ? ['https://dictionaryapi.dev', 'Free Dictionary'] : [wiktUrl(e) + '#English', 'Wiktionary'];
  return `<section class="card dict dict--en">${band('en', 'EN', 'Толковый словарь английского', src[0], src[1])}<div class="dict__body">${body}</div></section>`;
}

function transSection(e, lang) {
  const groups = e.trans.filter((g) => g[lang].length || g.see);
  const extra = (e.extra || []).filter((x) => x.words.length);
  const title = 'Англо-русский словарь';
  const code = 'EN · RU';
  let body;
  if (!groups.some((g) => g[lang].length) && !groups.some((g) => g.see) && !extra.length) {
    body = `<p class="note">Переводы на русский для «${esc(e.word)}» пока не найдены в открытых источниках.</p>`;
  } else {
    const LIMIT = 8;
    body = groups.map((g, i) => `
      <div class="tgroup"${i >= LIMIT ? ` data-extra="t${lang}" hidden` : ''}>
        <div class="tgroup__gloss">${g.pos ? `<span class="pos">${esc(ruPos(g.pos))}</span>` : ''}<span class="tgroup__text">${esc(g.gloss)}</span></div>
        ${g.see ? `<p class="note" style="margin:0">Переводы — в статье <a href="${wordHref(g.see)}">${esc(g.see)}</a></p>` : `<div class="tlist">${g[lang].map((t) => tword(t)).join('')}</div>`}
      </div>`).join('') + (groups.length > LIMIT ? `<div class="more"><button class="linkbtn" data-more="t${lang}" type="button">Ещё ${groups.length - LIMIT} значений</button></div>` : '')
      + extra.map((x) => `
      <div class="tgroup">
        <div class="tgroup__gloss"><span class="pos">${esc(ruPos(x.pos))}</span><span class="tgroup__text">${groups.length ? 'Ещё переводы' : 'Переводы'}</span></div>
        <div class="tlist">${x.words.map((w) => tword({ term: w, genders: [], qual: '' })).join('')}</div>
      </div>`).join('');
  }
  return `<section class="card dict dict--${lang}">${band(lang, code, title, wiktUrl(e) + '#Translations', 'Wiktionary')}<div class="dict__body">${body}</div></section>`;
}

function tword(t) {
  const plain = noStress(t.term);
  const say = `<button class="tword__say" type="button" data-text="${esc(plain)}" data-lang="ru-RU" title="Произнести" aria-label="Произнести">${ICON.speaker}</button>`;
  const q = t.qual ? `<span class="tword__q">(${esc(t.qual)})</span>` : '';
  const g = t.genders.length ? `<span class="tword__meta">${esc(t.genders.join(' '))}</span>` : '';
  return `<span class="tword">${q}<a class="tword__text" href="${wordHref(plain)}" style="color:inherit">${esc(t.term)}</a>${g}${say}</span>`;
}

function revSection(e) {
  const lang = e.revLangName || 'Russian';
  return `<section class="card dict dict--rev">${band('rev', 'RU · EN', 'Русско-английский словарь', wiktUrl(e) + '#' + lang, 'Wiktionary')}<div class="dict__body">${defBlocks(e.rev, e.word)}</div></section>`;
}

async function renderNotFound(word, seq) {
  app.innerHTML = `<div class="emptystate fade-in"><div class="emptystate__art">?</div>
    <h2>«${esc(word)}» не найдено</h2><p>Проверьте написание или выберите похожее слово.</p>
    <div class="chips" id="spell" style="justify-content:center"></div></div>`;
  const list = (await local.init())
    ? await local.similar(word).catch(() => [])
    : isCyr(word) ? await api.suggest(word).catch(() => []) : await api.spell(word).catch(() => []);
  if (seq !== renderSeq) return;
  $('#spell').innerHTML = list.filter((w) => w.toLowerCase() !== word.toLowerCase()).map((w) => `<a class="chip" href="${wordHref(w)}">${esc(w)}</a>`).join('') || '<a class="btn btn--ghost" href="#/">На главную</a>';
}

function renderFavorites() {
  document.title = 'Избранное — Лексикон';
  const list = favs.all();
  app.innerHTML = `
    <div class="pagehead fade-in"><div><h1>Избранное</h1><p>${list.length ? plural(list.length, 'слово', 'слова', 'слов') : 'Сохранённых слов пока нет'}</p></div></div>
    ${list.length ? `<div class="cards fade-in">${list.map((f) => `
      <a class="card wcard" href="${wordHref(f.word)}">
        <div class="wcard__word">${esc(f.word)}</div>
        ${f.ipa ? `<div class="wcard__ipa">${esc(f.ipa)}</div>` : ''}
        ${f.def ? `<p class="wcard__def">${esc(f.def)}</p>` : ''}
        <button class="wcard__x" type="button" data-remove="${esc(f.word)}" title="Убрать" aria-label="Убрать из избранного">${ICON.x}</button>
      </a>`).join('')}</div>`
      : `<div class="card emptystate"><div class="emptystate__art">☆</div><h2>Здесь будут ваши слова</h2><p>Откройте статью и нажмите звёздочку рядом со словом.</p><a class="btn" href="#/">Искать слова</a></div>`}`;
  $$('[data-remove]').forEach((b) => b.addEventListener('click', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    favs.remove(b.dataset.remove); renderFavorites(); toast('Убрано из избранного');
  }));
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  return n.toLocaleString('ru-RU') + ' ' + w;
}

function renderHistory() {
  document.title = 'История — Лексикон';
  const list = history.all();
  const fmtDay = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const fmtTime = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const today = new Date().toDateString(), yest = new Date(Date.now() - 864e5).toDateString();
  const groups = new Map();
  for (const h of list) {
    const d = new Date(h.t), ds = d.toDateString();
    const label = ds === today ? 'Сегодня' : ds === yest ? 'Вчера' : fmtDay.format(d);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(h);
  }
  app.innerHTML = `
    <div class="pagehead fade-in"><div><h1>История</h1><p>${list.length ? plural(list.length, 'слово', 'слова', 'слов') : 'Вы ещё ничего не искали'}</p></div>
      ${list.length ? '<button class="btn btn--ghost" id="clearHist" type="button">Очистить</button>' : ''}</div>
    ${list.length ? [...groups].map(([label, items]) => `<div class="daygroup">${esc(label)}</div>
      <ul class="card hist fade-in">${items.map((h) => `<li><a href="${wordHref(h.word)}">${esc(h.word)}</a>
        <span class="wcard__ipa">${esc(h.ipa || '')}</span><time>${fmtTime.format(new Date(h.t))}</time>
        <button class="wcard__x" style="position:static" type="button" data-remove="${esc(h.word)}" aria-label="Удалить из истории">${ICON.x}</button></li>`).join('')}</ul>`).join('')
      : `<div class="card emptystate"><div class="emptystate__art">⌚</div><h2>История пуста</h2><p>Найдите первое слово — оно появится здесь.</p><a class="btn" href="#/">Искать слова</a></div>`}`;
  const clr = $('#clearHist');
  if (clr) clr.onclick = () => { if (confirm('Очистить всю историю поиска?')) { history.clear(); renderHistory(); } };
  $$('[data-remove]').forEach((b) => b.addEventListener('click', () => { history.remove(b.dataset.remove); renderHistory(); }));
}

/* ============ Search box + autocomplete ============ */
function setupSearch(form) {
  const input = $('input', form), box = $('.suggest', form);
  let items = [], sel = -1, reqId = 0;

  const close = () => { box.hidden = true; sel = -1; input.setAttribute('aria-expanded', 'false'); };
  const go = (w) => { w = norm(w); if (!w) return; close(); input.blur(); location.hash = wordHref(w); };
  const paint = (q) => {
    if (!items.length) return close();
    const ql = q.toLowerCase();
    box.innerHTML = items.map((it, i) => {
      const w = it.word, hit = w.toLowerCase().startsWith(ql) ? `<mark>${esc(w.slice(0, q.length))}</mark>${esc(w.slice(q.length))}` : esc(w);
      return `<li role="option" data-i="${i}" aria-selected="${i === sel}">${it.recent ? ICON.clock : ICON.search}<span>${hit}</span>${it.recent ? '<span class="suggest__hint">недавнее</span>' : ''}</li>`;
    }).join('');
    box.hidden = false; input.setAttribute('aria-expanded', 'true');
  };
  const load = debounce(async (q) => {
    const id = ++reqId;
    const ql = q.toLowerCase();
    const recent = history.all().filter((h) => h.word.toLowerCase().startsWith(ql)).slice(0, 3).map((h) => ({ word: h.word, recent: true }));
    items = recent; sel = -1; paint(q);
    const remote = (await local.init()) ? await local.suggest(q).catch(() => []) : await api.suggest(q).catch(() => []);
    if (id !== reqId || input.value.trim() !== q) return;
    const seen = new Set(recent.map((r) => r.word.toLowerCase()));
    items = recent.concat(remote.filter((w) => !seen.has(w.toLowerCase())).map((w) => ({ word: w }))).slice(0, 9);
    paint(q);
  }, 140);

  input.addEventListener('input', () => { const q = input.value.trim(); if (!q) { items = []; close(); return; } load(q); });
  input.addEventListener('keydown', (ev) => {
    if (box.hidden) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      // Cycle through -1 (the typed text) and the suggestions.
      const n = items.length + 1;
      sel = ((sel + 1 + (ev.key === 'ArrowDown' ? 1 : -1)) % n + n) % n - 1;
      $$('li', box).forEach((li, i) => li.setAttribute('aria-selected', i === sel));
    } else if (ev.key === 'Escape') close();
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('focus', () => { if (input.value.trim() && items.length) paint(input.value.trim()); });
  box.addEventListener('mousedown', (ev) => { const li = ev.target.closest('li'); if (li) { ev.preventDefault(); go(items[+li.dataset.i].word); } });
  form.addEventListener('submit', (ev) => { ev.preventDefault(); go(sel >= 0 ? items[sel].word : input.value); });
}

/* ============ Router ============ */
function route() {
  const hash = location.hash || '#/';
  const top = $('#topSearch input');
  $$('.nav__link').forEach((a) => a.classList.toggle('is-active', hash === '#/' + a.dataset.nav));
  document.body.classList.toggle('is-home', hash === '#/' || hash === '#');
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  const m = hash.match(/^#\/w\/(.+)$/);
  if (m) {
    const w = norm(decodeURIComponent(m[1]));
    top.value = w;
    renderEntry(w);
  } else {
    top.value = '';
    renderSeq++;
    if (hash === '#/favorites') renderFavorites();
    else if (hash === '#/history') renderHistory();
    else renderHome();
  }
  window.scrollTo(0, 0);
}

/* ============ Global wiring ============ */
setupSearch($('#topSearch'));
window.addEventListener('hashchange', route);

// Double-click any word in an article to look it up.
app.addEventListener('dblclick', (ev) => {
  if (ev.target.closest('input, button, .headword')) return;
  const sel = window.getSelection();
  const w = norm(String(sel || '')).replace(/^[^\p{L}]+|[^\p{L}'-]+$/gu, '');
  if (w && w.length < 40 && !/\s/.test(w)) location.hash = wordHref(w.toLowerCase() === w ? w : w.toLowerCase());
});

// "/" focuses search.
document.addEventListener('keydown', (ev) => {
  if (ev.key !== '/' || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  ev.preventDefault();
  const el = document.body.classList.contains('is-home') ? $('#heroSearch input') : $('#topSearch input');
  el && el.focus();
});

$('#themeToggle').addEventListener('click', () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('lex.theme', root.dataset.theme); } catch (e) {}
});

if ('speechSynthesis' in window) speechSynthesis.getVoices();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

if (!window.LEX_UNSUPPORTED) route();
