/* HSK · 汉语 — китайский по уровням HSK 1–6.
   Одна страница без сборки: данные подключаются обычными <script>, поэтому index.html работает
   и с диска (file://), и с любого статического хостинга. */
'use strict';
(() => {
  // ---------- helpers ----------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pick = (a) => a[Math.random() * a.length | 0];
  const plural = (n, one, few, many) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many; };
  const words_ = (n) => `${n} ${plural(n, 'слово', 'слова', 'слов')}`;
  const ICON = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.4-6.5a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    speak: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    slow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 19h14.5a4.5 4.5 0 0 0 4.5-4.5V9"/><path d="M5 19a6 6 0 1 1 10.5-4"/><path d="M11.2 15a2.2 2.2 0 1 1 .6-3.3"/><path d="M21 9l-1.2-3.2M21 9l1.4-3"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2v14H6zM20 5.5v13a1 1 0 0 1-1.6.8L10 13a1 1 0 0 1 0-2l8.4-6.3a1 1 0 0 1 1.6.8z"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM4 5.5v13a1 1 0 0 0 1.6.8L14 13a1 1 0 0 0 0-2L5.6 4.7A1 1 0 0 0 4 5.5z"/></svg>',
    full: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    film: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor"/></svg>',
  };
  const GRID_SVG = '<svg class="grid" viewBox="0 0 100 100" preserveAspectRatio="none"><g stroke="var(--grid)" stroke-width=".6" stroke-dasharray="2 2" fill="none"><path d="M0 0L100 100M100 0L0 100M50 0V100M0 50H100"/></g></svg>';

  // ---------- storage ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('hsk.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('hsk.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const settings = Object.assign({
    std: 'n', rate: 0.85, slowRate: 0.55, voice: '', recordings: true, toneColors: true, theme: '',
    lessons: {}, video: {}, dictTones: true, cardMode: 'zh',
  }, store.get('settings', {}));
  const saveSettings = () => store.set('settings', settings);
  let known = store.get('known', {});          // слово -> коробка 0..5; 3 и выше — «выучено»
  const saveKnown = () => store.set('known', known);
  let mistakes = store.get('mistakes', {});    // слово -> сколько раз ошибались
  const saveMistakes = () => store.set('mistakes', mistakes);
  let best = store.get('best', {});
  const isKnown = (w) => (known[w] || 0) >= 3;

  function toast(text, ms = 2600) {
    $$('.toast').forEach((t) => t.remove());
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  // ---------- data ----------
  const WORDS = (window.HSK_WORDS || []).map((r, i) => ({ i, w: r[0], p: r[1], ru: r[2], o: r[3], n: r[4], pos: r[5], cl: r[6], tr: r[7], f: r[8] }));
  const BY_WORD = new Map(WORDS.map((x) => [x.w, x]));
  const LESSON_SIZE = { 1: 15, 2: 15, 3: 20, 4: 20, 5: 25, 6: 25 };
  const STD_NAME = { n: 'HSK 3.0 (2026)', o: 'HSK 2.0' };
  const lvOf = (x, std = settings.std) => (std === 'n' ? x.n : x.o);
  const cache = new Map();
  const memo = (key, fn) => { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); };

  const levelWords = (level, std = settings.std) => memo(`lw${std}${level}`, () =>
    WORDS.filter((x) => lvOf(x, std) === level).sort((a, b) => a.f - b.f || a.i - b.i));
  const upTo = (level, std = settings.std) => memo(`up${std}${level}`, () =>
    WORDS.filter((x) => { const l = lvOf(x, std); return l > 0 && l <= level; }));
  const lessonsOf = (level, std = settings.std) => memo(`ls${std}${level}`, () => {
    const ws = levelWords(level, std), size = LESSON_SIZE[level], out = [];
    for (let i = 0; i < ws.length; i += size) out.push(ws.slice(i, i + size));
    if (out.length > 1 && out[out.length - 1].length < size / 2) out[out.length - 2].push(...out.pop());
    return out;
  });
  const lessonKey = (level) => settings.std + level;
  const currentLesson = (level) => settings.lessons[lessonKey(level)] ?? 1;   // 0 — весь уровень
  const lessonWords = (level, n = currentLesson(level)) => (n === 0 ? levelWords(level) : lessonsOf(level)[n - 1] || []);
  const levelChars = (level, std = settings.std) => memo(`ch${std}${level}`, () => {
    const before = new Set();
    for (let l = 1; l < level; l++) levelWords(l, std).forEach((x) => [...x.w].forEach((c) => before.add(c)));
    const out = [];
    levelWords(level, std).forEach((x) => [...x.w].forEach((c) => { if (/\p{Script=Han}/u.test(c) && !before.has(c) && !out.includes(c)) out.push(c); }));
    return out;
  });
  const wordsWithChar = (c) => memo('wc' + c, () => WORDS.filter((x) => x.w.includes(c)).sort((a, b) => (a.w.length === 1 ? -1 : 0) - (b.w.length === 1 ? -1 : 0) || a.f - b.f));
  function charReading(c) {
    const single = BY_WORD.get(c);
    if (single) return single.p;
    for (const x of wordsWithChar(c)) {
      const syl = x.p.split(' / ')[0].split(' ').filter((s) => s !== 'r');
      if (syl.length === x.w.length) return syl[x.w.indexOf(c)];
    }
    return '';
  }

  // ---------- pinyin ----------
  const MARKS = {};
  'āáǎà|ēéěè|īíǐì|ōóǒò|ūúǔù|ǖǘǚǜ'.split('|').forEach((grp, k) => [...grp].forEach((ch, t) => { MARKS[ch] = ['a', 'e', 'i', 'o', 'u', 'ü'][k] + (t + 1); }));
  const MARK_OF = {};
  Object.entries(MARKS).forEach(([ch, v]) => { MARK_OF[v] = ch; });
  function toneOf(s) { for (const ch of s.normalize('NFC')) if (MARKS[ch]) return +MARKS[ch][1]; return 5; }
  function plainSyl(s) { return [...s.normalize('NFC')].map((ch) => (MARKS[ch] ? MARKS[ch][0] : ch)).join(''); }
  function markSyl(plain, tone) {
    if (tone < 1 || tone > 4) return plain;
    const s = plain.toLowerCase();
    let i = s.indexOf('a');
    if (i < 0) i = s.indexOf('e');
    if (i < 0) i = s.indexOf('ou');
    if (i < 0) { for (let k = s.length - 1; k >= 0; k--) if ('iouü'.includes(s[k])) { i = k; break; } }
    if (i < 0) return plain;
    const ch = MARK_OF[s[i] + tone];
    return plain.slice(0, i) + (plain[i] === plain[i].toUpperCase() && plain[i] !== plain[i].toLowerCase() ? ch.toUpperCase() : ch) + plain.slice(i + 1);
  }
  const sylls = (p) => p.split(' / ')[0].split(' ').filter(Boolean);
  function pyHtml(p) {
    return p.split(' / ').map((alt) => {
      const syl = alt.split(' ').filter(Boolean);
      const join = syl.length < 4;
      return syl.map((s, k) => {
        const apos = join && k > 0 && /^[aoeāáǎàōóǒòēéěè]/i.test(s) ? "'" : '';
        return `${apos}<span class="t${toneOf(s)}">${esc(s)}</span>`;
      }).join(join ? '' : ' ');
    }).join(' / ');
  }
  const pyText = (p) => p.split(' / ').map((alt) => { const s = alt.split(' '); return s.length < 4 ? s.map((x, k) => (k && /^[aoeāáǎàōóǒòēéěè]/i.test(x) ? "'" : '') + x).join('') : alt; }).join(' / ');
  function parseAnswer(input) {                 // «ni3 hao3», «nǐhǎo», «nihao» -> {letters, tones}
    let letters = '', tones = '';
    for (const ch of input.normalize('NFC').toLowerCase()) {
      if (MARKS[ch]) { letters += MARKS[ch][0]; tones += MARKS[ch][1]; }
      else if (/[1-5]/.test(ch)) tones += ch;
      else if (/[a-zü]/.test(ch)) letters += ch;
      else if (ch === 'v') letters += 'ü';
    }
    return { letters: letters.replace(/v/g, 'ü'), tones: tones.replace(/5/g, '') };
  }
  function expectedAnswer(p) {
    const s = sylls(p);
    return { letters: s.map(plainSyl).join('').toLowerCase(), tones: s.map(toneOf).filter((t) => t !== 5).join('') };
  }

  // ---------- scripts on demand ----------
  const loadedScripts = {};
  function loadScript(src) {
    if (!loadedScripts[src]) {
      loadedScripts[src] = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => res();
        s.onerror = () => { delete loadedScripts[src]; rej(new Error('no ' + src)); };
        document.head.appendChild(s);
      });
    }
    return loadedScripts[src];
  }
  let SENTENCES = null, EXAMPLES = {};
  function loadSentences() {
    if (SENTENCES) return Promise.resolve(SENTENCES);
    return loadScript('data/sentences.js').then(() => {
      SENTENCES = (window.HSK_SENTENCES || []).map((r, i) => ({ i, id: r[0], zh: r[1], py: r[2], ru: r[3], o: r[4], n: r[5], a: r[6] }));
      EXAMPLES = window.HSK_EXAMPLES || {};
      return SENTENCES;
    }).catch(() => { SENTENCES = []; return SENTENCES; });
  }
  let AUDIO = {};
  const audioReady = loadScript('data/audio.js').then(() => { AUDIO = window.HSK_AUDIO || {}; }).catch(() => {});
  const COMMONS = 'https://upload.wikimedia.org/wikipedia/commons/';
  const recordingUrl = (w) => { const a = AUDIO[w]; return a ? (/^https?:/.test(a[1]) ? a[1] : COMMONS + a[1]) : ''; };

  // ---------- stroke data ----------
  const STROKES = {};
  window.HSK_STROKES = (d) => Object.assign(STROKES, d);
  const strokeData = (c) => (STROKES[c] ? Promise.resolve(STROKES[c])
    : loadScript(`data/strokes/${c.codePointAt(0) % 96}.js`).then(() => STROKES[c] || Promise.reject(new Error('no strokes'))));
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  function hanziBox(c, size, opts = {}) {
    const box = document.createElement('div');
    box.className = 'hw-box';
    if (size) { box.style.width = size + 'px'; box.style.height = size + 'px'; }
    box.innerHTML = GRID_SVG + '<div class="hw"></div>';
    const target = $('.hw', box);
    const fallback = () => { if (!$('.fallback', box)) box.insertAdjacentHTML('beforeend', `<div class="fallback">${esc(c)}</div>`); };
    let writer = null;
    const ready = new Promise((resolve) => {
      if (!window.HanziWriter || !/\p{Script=Han}/u.test(c)) { fallback(); resolve(null); return; }
      requestAnimationFrame(() => {
        const px = box.clientWidth || size || 120;
        try {
          writer = window.HanziWriter.create(target, c, Object.assign({
            width: px, height: px, padding: Math.round(px * 0.05),
            strokeColor: opts.dark ? '#1b130e' : cssVar('--ink') || '#222',
            outlineColor: opts.dark ? '#e9dccb' : cssVar('--line') || '#ddd',
            radicalColor: opts.radical ? cssVar('--brand') : null,
            drawingColor: cssVar('--brand') || '#b3261e',
            highlightColor: cssVar('--accent') || '#d99a1e',
            strokeAnimationSpeed: 1, delayBetweenStrokes: 180, showCharacter: opts.showCharacter !== false,
            charDataLoader: (ch, done, fail) => { strokeData(ch).then(done, fail); },
            onLoadCharDataSuccess: () => resolve(writer),
            onLoadCharDataError: () => { fallback(); resolve(null); },
          }, opts.hw || {}));
        } catch (e) { fallback(); resolve(null); }
      });
    });
    box.ready = ready;
    box.animate = () => ready.then((w) => (w ? new Promise((r) => w.animateCharacter({ onComplete: r })) : null));
    box.writer = () => writer;
    return box;
  }

  // ---------- speech ----------
  const Speech = {
    ok: 'speechSynthesis' in window,
    voices: [],
    load() { if (this.ok) this.voices = speechSynthesis.getVoices(); },
    zh() {
      const all = this.voices.filter((v) => /^(zh|cmn)/i.test(v.lang));
      const cn = all.filter((v) => !/(HK|TW|yue|hant)/i.test(v.lang + v.name));
      return cn.length ? cn : all;
    },
    voiceFor(lang) {
      if (lang === 'ru') return this.voices.find((v) => /^ru/i.test(v.lang)) || null;
      const list = this.zh();
      if (settings.voice) { const v = list.find((x) => x.name === settings.voice); if (v) return v; }
      const rank = (v) => (/Xiaoxiao|Yunxi|Xiaoyi|Yunjian|Natural|Neural/i.test(v.name) ? 0 : /Google/i.test(v.name) ? 1
        : /Tingting|Ting-Ting|Meijia|Lili|Huihui|Yaoyao|Kangkang|Yu-shu/i.test(v.name) ? 2 : 3) + (/zh[-_]CN/i.test(v.lang) ? 0 : 0.5);
      return list.slice().sort((a, b) => rank(a) - rank(b))[0] || null;
    },
    stop() { if (this.ok) speechSynthesis.cancel(); },
    say(text, { lang = 'zh', rate } = {}) {
      return new Promise((resolve) => {
        if (!this.ok || !text) { resolve(); return; }
        const u = new SpeechSynthesisUtterance(text);
        const v = this.voiceFor(lang);
        if (v) u.voice = v;
        u.lang = v ? v.lang : lang === 'ru' ? 'ru-RU' : 'zh-CN';
        u.rate = rate || (lang === 'ru' ? 1 : settings.rate);
        let done = false;
        const finish = () => { if (!done) { done = true; clearTimeout(t); resolve(); } };
        const t = setTimeout(finish, 1500 + text.length * 700 / u.rate);
        u.onend = finish;
        u.onerror = finish;
        speechSynthesis.speak(u);
      });
    },
  };
  if (Speech.ok) { Speech.load(); speechSynthesis.addEventListener('voiceschanged', () => Speech.load()); }

  let currentAudio = null;
  function stopSound() {
    Speech.stop();
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    $$('.speak.playing').forEach((b) => b.classList.remove('playing'));
  }
  function playUrl(url, rate = 1) {
    return new Promise((resolve, reject) => {
      const a = new Audio(url);
      currentAudio = a;
      a.playbackRate = rate;
      a.preservesPitch = true;
      let started = false;
      const t = setTimeout(() => { if (!started) { a.pause(); reject(new Error('timeout')); } }, 6000);
      a.onplaying = () => { started = true; };
      a.onended = () => { clearTimeout(t); resolve(); };
      a.onerror = () => { clearTimeout(t); reject(new Error('audio')); };
      a.play().catch((e) => { clearTimeout(t); reject(e); });
    });
  }
  // Произнести слово: живая запись из Wikimedia Commons, если есть, иначе голос браузера.
  async function sayWord(w, slow = false) {
    stopSound();
    await audioReady;
    const url = settings.recordings && recordingUrl(w);
    if (url) {
      try { await playUrl(url, slow ? 0.7 : 1); return; } catch (e) { /* нет сети — голос браузера */ }
    }
    await Speech.say(w, { rate: slow ? settings.slowRate : settings.rate });
  }
  async function saySentence(s, slow = false) {
    stopSound();
    if (settings.recordings && s.a) {
      try { await playUrl(`https://audio.tatoeba.org/sentences/cmn/${s.id}.mp3`, slow ? 0.75 : 1); return; } catch (e) { /* голос браузера */ }
    }
    await Speech.say(s.zh, { rate: slow ? settings.slowRate : settings.rate });
  }
  const sayText = (text, slow) => { stopSound(); return Speech.say(text, { rate: slow ? settings.slowRate : settings.rate }); };
  // Кнопки озвучки: data-say="слово" | data-sent="индекс" | data-text="фраза"; data-slow — медленно.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-say],[data-sent],[data-text]');
    if (!b) return;
    e.stopPropagation();
    e.preventDefault();
    const slow = b.hasAttribute('data-slow');
    b.classList.add('playing');
    const done = () => b.classList.remove('playing');
    const p = b.dataset.say != null ? sayWord(b.dataset.say, slow)
      : b.dataset.sent != null ? saySentence(SENTENCES[+b.dataset.sent], slow) : sayText(b.dataset.text, slow);
    p.then(done, done);
  });
  const speakBtn = (attr, title = 'Послушать', slow = false) =>
    `<button class="speak" ${attr} ${slow ? 'data-slow' : ''} title="${title}" aria-label="${title}">${slow ? ICON.slow : ICON.speak}</button>`;
  const sayBtn = (w, slow) => speakBtn(`data-say="${esc(w)}"`, slow ? 'Медленно' : 'Послушать', slow);

  // ---------- route lifecycle ----------
  let cleanups = [];
  const onLeave = (fn) => cleanups.push(fn);
  function leave() {
    stopSound();
    cleanups.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
    cleanups = [];
    closeModal();
  }
  const app = $('#app');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- modal ----------
  function openModal(html, onClose) {
    closeModal();
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><button class="icon-btn modal-x" aria-label="Закрыть">${ICON.x}</button>${html}</div>`;
    back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('.modal-x')) closeModal(); });
    back.onClose = onClose;
    document.body.appendChild(back);
    return $('.modal', back);
  }
  function closeModal() {
    $$('.modal-back').forEach((m) => { if (m.onClose) m.onClose(); m.remove(); });
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  // ---------- word card ----------
  const POS = { n: 'сущ.', v: 'гл.', a: 'прил.', d: 'нар.', r: 'мест.', m: 'числ.', q: 'сч. слово', p: 'предлог', c: 'союз', cc: 'союз', u: 'частица',
    y: 'частица', e: 'межд.', o: 'звукоподр.', t: 'время', f: 'место', s: 'место', i: 'чэнъюй', l: 'выражение', vn: 'гл./сущ.', an: 'прил./сущ.',
    ad: 'прил./нар.', nr: 'имя', ns: 'геогр.', nz: 'имя собств.', vd: 'гл./нар.', b: 'прил.', z: 'опис.', j: 'сокращ.' };
  const posText = (x) => [...new Set((x.pos || '').split(',').map((p) => POS[p]).filter(Boolean))].slice(0, 2).join(', ');
  const levelsText = (x) => [x.n ? `HSK 3.0 · ${x.n}` : '', x.o ? `HSK 2.0 · ${x.o}` : ''].filter(Boolean).join(' &nbsp;·&nbsp; ');

  function openWord(w) {
    const x = BY_WORD.get(w);
    if (!x) return;
    const chars = [...x.w];
    const m = openModal(`
      <div class="wc-head">
        <div class="wc-chars"></div>
        <div class="grow" style="min-width:200px">
          <div class="wc-py">${pyHtml(x.p)}</div>
          <div class="wc-ru">${esc(x.ru)}</div>
          <div class="row" style="margin-top:10px">${sayBtn(x.w)}${sayBtn(x.w, true)}
            <button class="btn small" data-act="anim">Порядок черт</button>
            <button class="btn small star-btn">${isKnown(x.w) ? '★ Выучено' : '☆ Отметить как выученное'}</button></div>
          <div class="row" style="margin-top:10px;gap:6px">
            ${posText(x) ? `<span class="tag">${esc(posText(x))}</span>` : ''}
            ${x.cl ? `<span class="tag">сч. слово: <span class="zh">${esc(x.cl.split(',').join('、'))}</span></span>` : ''}
            ${x.tr ? `<span class="tag">полная форма: <span class="zh">${esc(x.tr)}</span></span>` : ''}
            <span class="tag">${levelsText(x)}</span>
          </div>
        </div>
      </div>
      <div class="wc-body">
        <div class="wc-sec wc-ex"><h4>Примеры</h4><div class="muted ex-list">Загрузка…</div></div>
        ${chars.map((c) => `<div class="wc-sec"><h4><span class="zh">${esc(c)}</span> в других словах</h4><div class="mini-words">${
          wordsWithChar(c).filter((y) => y.w !== x.w).slice(0, 10).map((y) => `<button data-open="${esc(y.w)}"><span class="zh">${esc(y.w)}</span> <span class="muted">${esc(y.ru.split(/[;,(]/)[0])}</span></button>`).join('') || '<span class="faint">—</span>'
        }</div></div>`).join('')}
        <div class="wc-sec rec-note faint" style="font-size:13px"></div>
      </div>`);
    const boxWrap = $('.wc-chars', m);
    const size = chars.length > 2 ? 104 : 132;
    const boxes = chars.map((c) => { const b = hanziBox(c, size); boxWrap.appendChild(b); return b; });
    $('[data-act="anim"]', m).onclick = async () => { for (const b of boxes) await b.animate(); };
    $('.star-btn', m).onclick = (e) => {
      known[x.w] = isKnown(x.w) ? 0 : 3;
      saveKnown();
      e.target.textContent = isKnown(x.w) ? '★ Выучено' : '☆ Отметить как выученное';
      document.dispatchEvent(new CustomEvent('known-changed'));
    };
    m.addEventListener('click', (e) => { const o = e.target.closest('[data-open]'); if (o) openWord(o.dataset.open); });
    audioReady.then(() => {
      const a = AUDIO[x.w];
      if (a) $('.rec-note', m).innerHTML = `Живая запись произношения: <a href="https://commons.wikimedia.org/wiki/File:${encodeURIComponent(a[0].replace(/ /g, '_'))}" target="_blank" rel="noopener">Wikimedia Commons</a> (CC BY-SA, автор указан на странице файла).`;
    });
    loadSentences().then(() => {
      const list = $('.ex-list', m);
      if (!list) return;
      const ids = EXAMPLES[x.w] || [];
      if (!ids.length) { $('.wc-ex', m).remove(); return; }
      list.classList.remove('muted');
      list.innerHTML = ids.map((i) => sentenceRow(SENTENCES[i], x.w)).join('');
    });
    sayWord(x.w);
  }
  function highlight(zh, w) { return w ? esc(zh).split(esc(w)).join(`<b style="color:var(--brand)">${esc(w)}</b>`) : esc(zh); }
  function sentenceRow(s, w) {
    return `<div class="ex">${speakBtn(`data-sent="${s.i}"`, 'Послушать предложение')}
      <div class="grow"><div class="zh">${highlight(s.zh, w)}</div><div class="py">${esc(s.py)}</div><div class="ru">${esc(s.ru)}</div></div>
      <a class="faint" style="font-size:12px" href="https://tatoeba.org/ru/sentences/show/${s.id}" target="_blank" rel="noopener" title="Источник: Tatoeba">#${s.id}</a></div>`;
  }
  document.addEventListener('click', (e) => {
    const o = e.target.closest('[data-word]');
    if (o && !e.target.closest('button,a,input,label')) openWord(o.dataset.word);
  });

  // ---------- header ----------
  function paintStd() { $$('#std button').forEach((b) => b.classList.toggle('on', b.dataset.std === settings.std)); }
  $('#std').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-std]');
    if (!b || b.dataset.std === settings.std) return;
    settings.std = b.dataset.std;
    saveSettings();
    paintStd();
    route();
    toast(`Списки слов: ${STD_NAME[settings.std]}`);
  });
  function applyLook() {
    if (settings.theme) document.documentElement.dataset.theme = settings.theme; else delete document.documentElement.dataset.theme;
    document.body.classList.toggle('plain-tones', !settings.toneColors);
  }

  // ---------- views ----------
  function viewHome() {
    const std = settings.std;
    const samples = ['你好', '学习', '旅游', '经验', '传统', '博大精深'];
    app.innerHTML = `
      <section class="card hero">
        <div>
          <h1>Китайский по уровням HSK 1–6</h1>
          <p>Все слова экзамена с переводом на русский. Каждое слово звучит, иероглифы показывают порядок черт,
          а любой урок превращается в видеоурок для класса, аудирование, карточки и пробный тест.</p>
        </div>
        <div class="hero-zh">汉语</div>
      </section>
      <p class="std-note">${std === 'n'
        ? '<b>HSK 3.0 (программа 2026 года)</b> — новый экзамен, который сдают с июля 2026 г.: 300 / 500 / 1000 / 2000 / 3600 / 5400 слов нарастающим итогом.'
        : '<b>HSK 2.0</b> — классический экзамен и учебники «HSK Standard Course»: 150 / 300 / 600 / 1200 / 2500 / 5000 слов нарастающим итогом.'}
        Переключить стандарт — вверху справа.</p>
      <div class="levels">${[1, 2, 3, 4, 5, 6].map((l) => {
        const ws = levelWords(l), learned = ws.filter((x) => isKnown(x.w)).length;
        return `<a class="card level" href="#/level/${l}">
          <span class="sample">${samples[l - 1][0]}</span>
          <div class="level-n">Уровень ${l}</div><h2>HSK ${l}</h2>
          <div class="meta">${words_(ws.length)} · ${lessonsOf(l).length} ${plural(lessonsOf(l).length, 'урок', 'урока', 'уроков')}<br>
          всего к уровню: ${upTo(l).length} · иероглифов: ${levelChars(l).length}</div>
          <div class="bar" title="Выучено ${learned} из ${ws.length}"><i style="width:${ws.length ? learned / ws.length * 100 : 0}%"></i></div>
        </a>`;
      }).join('')}</div>
      <h2 class="section-h">Для всех уровней</h2>
      <div class="tools">
        <a class="card tool" href="#/pinyin"><span class="tool-ic">ā</span><span><b>Пиньинь и тоны</b><span>Все слоги с озвучкой, тренажёр тонов, правила</span></span></a>
        <a class="card tool" href="#/level/1/grammar"><span class="tool-ic">把</span><span><b>Грамматика</b><span>Конструкции каждого уровня с примерами вслух</span></span></a>
        <a class="card tool" href="#/about"><span class="tool-ic">?</span><span><b>Как пользоваться</b><span>Голос, запись видео, печать, источники</span></span></a>
      </div>
      <div class="note" style="margin-top:18px" id="voice-note"></div>`;
    paintVoiceNote();
  }
  function paintVoiceNote() {
    const el = $('#voice-note');
    if (!el) return;
    const zh = Speech.zh();
    if (!Speech.ok) el.innerHTML = 'Этот браузер не умеет озвучивать текст. Откройте приложение в Chrome, Edge, Safari или Яндекс Браузере.';
    else if (!zh.length) el.innerHTML = 'Китайский голос пока не найден. В Chrome и Edge он есть сразу (нужен интернет); в Windows можно добавить голос «Китайский (упрощённое письмо)». <a href="#/about">Как включить голос</a>. Слова с живыми записями звучат в любом случае.';
    else el.innerHTML = `Голос: <b>${esc(Speech.voiceFor('zh').name)}</b>. Скорость и выбор голоса — в настройках (⚙). Там, где есть запись носителя языка из Wikimedia Commons, звучит она.`;
  }
  if (Speech.ok) speechSynthesis.addEventListener('voiceschanged', paintVoiceNote);

  const TABS = [['words', 'Слова'], ['video', 'Видеоурок'], ['cards', 'Карточки'], ['listen', 'Аудирование'], ['chars', 'Иероглифы'], ['grammar', 'Грамматика'], ['test', 'Тест']];
  function viewLevel(level, tab) {
    if (!(level >= 1 && level <= 6)) { location.hash = '#/'; return; }
    const ws = levelWords(level);
    app.innerHTML = `
      <div class="crumbs"><a class="back" href="#/">← Все уровни</a></div>
      <div class="row lv-head" style="align-items:flex-end">
        <div class="grow"><h1 class="page-title">HSK ${level}</h1>
          <div class="page-sub">${STD_NAME[settings.std]} · ${words_(ws.length)} · ${lessonsOf(level).length} ${plural(lessonsOf(level).length, 'урок', 'урока', 'уроков')}</div></div>
        <div class="chips">${[1, 2, 3, 4, 5, 6].map((l) => `<a class="chip ${l === level ? 'on' : ''}" href="#/level/${l}/${tab}" style="text-decoration:none">${l}</a>`).join('')}</div>
      </div>
      <nav class="tabs">${TABS.map(([k, t]) => `<a href="#/level/${level}/${k}" class="${k === tab ? 'on' : ''}">${t}</a>`).join('')}</nav>
      <div id="tab"></div>`;
    const el = $('#tab');
    ({ words: tabWords, video: tabVideo, cards: tabCards, listen: tabListen, chars: tabChars, grammar: tabGrammar, test: tabTest }[tab] || tabWords)(el, level);
  }

  function lessonPicker(level, onChange, { allowAll = true } = {}) {
    const ls = lessonsOf(level);
    const cur = currentLesson(level);
    const wrap = document.createElement('div');
    wrap.className = 'row';
    wrap.style.gap = '6px';
    wrap.innerHTML = `
      <button class="btn small" data-d="-1" aria-label="Предыдущий урок">‹</button>
      <select aria-label="Урок">${allowAll ? `<option value="0">Весь уровень (${ls.reduce((s, l) => s + l.length, 0)})</option>` : ''}${ls.map((l, i) =>
        `<option value="${i + 1}">Урок ${i + 1} · ${l.slice(0, 3).map((x) => x.w).join(' ')}…</option>`).join('')}</select>
      <button class="btn small" data-d="1" aria-label="Следующий урок">›</button>`;
    const sel = $('select', wrap);
    sel.value = String(!allowAll && cur === 0 ? 1 : cur);
    const set = (n) => {
      n = Math.max(allowAll ? 0 : 1, Math.min(ls.length, n));
      settings.lessons[lessonKey(level)] = n;
      saveSettings();
      sel.value = String(n);
      onChange(n);
    };
    sel.onchange = () => set(+sel.value);
    $$('[data-d]', wrap).forEach((b) => { b.onclick = () => set(+sel.value + +b.dataset.d); });
    return wrap;
  }

  // ----- Words -----
  function tabWords(el, level) {
    el.innerHTML = `
      <div class="toolbar" id="wt"></div>
      <div class="toolbar">
        <input type="search" id="q" placeholder="Поиск: иероглиф, пиньинь или перевод" aria-label="Поиск">
        <button class="btn" id="listen-all">${ICON.play} Слушать урок</button>
        <a class="btn" id="to-video">${ICON.film} Видеоурок</a>
        <button class="btn" id="print-list">${ICON.print} Печать</button>
      </div>
      <div class="card" id="list"></div>`;
    $('#wt').appendChild(lessonPicker(level, render));
    const q = $('#q');
    let playing = null;
    q.addEventListener('input', () => render());
    function items() {
      const s = q.value.trim().toLowerCase();
      if (!s) return lessonWords(level);
      const plainQ = plainSyl(s).replace(/[\s']/g, '');
      return upTo(level).filter((x) => x.w.includes(s) || x.ru.toLowerCase().includes(s)
        || sylls(x.p).map(plainSyl).join('').toLowerCase().startsWith(plainQ) || x.p.replace(/ /g, '').toLowerCase().startsWith(s.replace(/ /g, ''))).slice(0, 200);
    }
    function render() {
      stopPlaylist();
      const list = items();
      const n = currentLesson(level);
      const head = q.value.trim() ? `Найдено: ${list.length}` : n ? `Урок ${n}` : `Весь уровень`;
      $('#list').innerHTML = `<div class="lesson-h"><h3>${head}</h3><span class="muted" style="font-size:14px">${words_(list.length)} · выучено ${list.filter((x) => isKnown(x.w)).length}</span></div>
        <ul class="words">${list.map(wordRow).join('') || '<li class="empty">Ничего не найдено</li>'}</ul>`;
      $('#to-video').href = `#/level/${level}/video`;
    }
    function wordRow(x) {
      return `<li class="word" data-word="${esc(x.w)}">
        <span class="hz">${esc(x.w)}</span><span class="py">${pyHtml(x.p)}</span><span class="ru">${esc(x.ru)}</span>
        <span class="acts">${sayBtn(x.w)}<button class="star ${isKnown(x.w) ? 'on' : ''}" data-star="${esc(x.w)}" title="Выучено" aria-label="Отметить как выученное">★</button></span></li>`;
    }
    $('#list').addEventListener('click', (e) => {
      const s = e.target.closest('[data-star]');
      if (!s) return;
      e.stopPropagation();
      known[s.dataset.star] = isKnown(s.dataset.star) ? 0 : 3;
      saveKnown();
      s.classList.toggle('on', isKnown(s.dataset.star));
    });
    const onKnown = () => render();
    document.addEventListener('known-changed', onKnown);
    onLeave(() => document.removeEventListener('known-changed', onKnown));
    function stopPlaylist() {
      if (playing) { playing.dead = true; playing = null; stopSound(); }
      $('#listen-all').innerHTML = `${ICON.play} Слушать урок`;
      $$('.word.playing-row').forEach((r) => { r.classList.remove('playing-row'); r.style.background = ''; });
    }
    onLeave(stopPlaylist);
    $('#listen-all').onclick = async () => {
      if (playing) { stopPlaylist(); return; }
      const tok = playing = { dead: false };
      $('#listen-all').innerHTML = `${ICON.pause} Стоп`;
      const rows = $$('#list .word');
      for (const row of rows) {
        if (tok.dead) return;
        row.style.background = 'var(--accent-soft)';
        row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        const x = BY_WORD.get(row.dataset.word);
        await sayWord(x.w);
        if (tok.dead) return;
        await sleep(700);
        if (tok.dead) return;
        await sayWord(x.w);
        if (tok.dead) return;
        if (Speech.voiceFor('ru')) { await sleep(300); if (tok.dead) return; await Speech.say(x.ru.split(';')[0].replace(/\(.*?\)/g, ''), { lang: 'ru' }); }
        await sleep(1400);
        row.style.background = '';
      }
      stopPlaylist();
    };
    $('#print-list').onclick = () => printWords(level, items());
    render();
  }

  // ----- Video lesson -----
  function tabVideo(el, level) {
    const o = Object.assign({ repeats: 2, pause: 3, ru: 'after', sayRu: false, anim: true, examples: true }, settings.video);
    el.innerHTML = `
      <div class="toolbar" id="vt"></div>
      <div class="stage" id="stage"><div class="stage-top"><span id="st-title"></span><span id="st-count"></span></div>
        <div class="stage-mid" id="st-mid"></div>
        <div><div class="stage-prog"><i id="st-prog" style="width:0"></i></div>
        <div class="stage-bot">
          <button class="btn" id="st-prev" aria-label="Назад">${ICON.prev}</button>
          <button class="btn primary" id="st-play">${ICON.play} Начать</button>
          <button class="btn" id="st-next" aria-label="Вперёд">${ICON.next}</button>
          <span class="grow"></span>
          <button class="btn" id="st-full">${ICON.full} Во весь экран</button>
        </div></div>
      </div>
      <div class="card pad" style="margin-top:14px">
        <b>Настройки видеоурока</b>
        <div class="opts">
          <label>Повторов слова<select id="o-rep"><option value="1">1 раз</option><option value="2">2 раза</option><option value="3">3 раза (+ медленно)</option></select></label>
          <label>Пауза «Повторите!»<select id="o-pause"><option value="0">без паузы</option><option value="2">2 секунды</option><option value="3">3 секунды</option><option value="5">5 секунд</option></select></label>
          <label>Перевод<select id="o-ru"><option value="after">после произношения</option><option value="before">сразу</option><option value="never">не показывать</option></select></label>
          <label>Порядок черт<select id="o-anim"><option value="1">рисовать иероглиф</option><option value="0">сразу показывать</option></select></label>
          <label>Пример предложения<select id="o-ex"><option value="1">показывать и озвучивать</option><option value="0">без примеров</option></select></label>
          <label>Перевод вслух (русский голос)<select id="o-sayru"><option value="0">нет</option><option value="1">да</option></select></label>
        </div>
        <p class="muted" style="font-size:14px;margin:12px 0 0">Урок проигрывается сам: иероглиф рисуется по чертам, звучит слово, появляются пиньинь и перевод,
        затем пауза, чтобы класс повторил. <kbd>Пробел</kbd> — пауза, <kbd>←</kbd> <kbd>→</kbd> — листать.
        Чтобы получить видеофайл, запустите запись экрана (Windows: <kbd>Win</kbd>+<kbd>Alt</kbd>+<kbd>R</kbd>, macOS: <kbd>⌘</kbd>+<kbd>⇧</kbd>+<kbd>5</kbd>) и включите урок во весь экран.</p>
      </div>`;
    const bind = (id, key, num) => { const s = $(id); s.value = String(num ? +o[key] : o[key]); s.onchange = () => { o[key] = num ? +s.value : s.value; settings.video = o; saveSettings(); }; };
    bind('#o-rep', 'repeats', true); bind('#o-pause', 'pause', true); bind('#o-ru', 'ru');
    const sel = (id, key) => { const s = $(id); s.value = o[key] ? '1' : '0'; s.onchange = () => { o[key] = s.value === '1'; settings.video = o; saveSettings(); }; };
    sel('#o-anim', 'anim'); sel('#o-ex', 'examples'); sel('#o-sayru', 'sayRu');
    if (!Speech.voiceFor('ru')) { $('#o-sayru').disabled = true; $('#o-sayru').title = 'В браузере нет русского голоса'; }

    const stage = $('#stage'), mid = $('#st-mid');
    let words = [], idx = 0, tok = null;
    function cover() {
      stop();
      words = lessonWords(level);
      idx = 0;
      const n = currentLesson(level);
      $('#st-title').textContent = `HSK ${level} · ${n ? 'урок ' + n : 'весь уровень'}`;
      $('#st-count').textContent = words_(words.length);
      $('#st-prog').style.width = '0';
      mid.innerHTML = `<div class="stage-cover"><div class="kai" style="font-size:22px;color:#cbbfae">视频课 · видеоурок</div>
        <h2>HSK ${level}${n ? ` · Урок ${n}` : ''}</h2><div class="list">${words.slice(0, 40).map((x) => esc(x.w)).join(' · ')}${words.length > 40 ? ' …' : ''}</div></div>`;
      $('#st-play').innerHTML = `${ICON.play} Начать`;
    }
    $('#vt').appendChild(lessonPicker(level, cover));
    function stop() {
      if (tok) { tok.dead = true; tok = null; }
      stopSound();
      $('#st-play').innerHTML = `${ICON.play} Продолжить`;
    }
    async function show(i, t) {
      const x = words[i];
      if (!x) return;
      $('#st-count').textContent = `${i + 1} / ${words.length}`;
      $('#st-prog').style.width = `${(i + 1) / words.length * 100}%`;
      const chars = [...x.w];
      stage.classList.toggle('few', chars.length === 1);
      stage.classList.toggle('many', chars.length > 2);
      mid.innerHTML = `<div style="width:100%"><div class="big-chars"></div>
        <div class="stage-py"></div><div class="stage-ru"></div><div class="stage-say"></div><div class="stage-ex"></div></div>`;
      const boxes = chars.map((c) => { const b = hanziBox(c, 0, { dark: true, showCharacter: !o.anim, hw: { strokeColor: '#1b130e', outlineColor: '#eadfce' } }); $('.big-chars', mid).appendChild(b); return b; });
      const py = $('.stage-py', mid), ru = $('.stage-ru', mid), say = $('.stage-say', mid), ex = $('.stage-ex', mid);
      if (o.ru === 'before') ru.textContent = x.ru;
      if (o.anim) { for (const b of boxes) { if (t.dead) return; await b.animate(); } }
      else await Promise.all(boxes.map((b) => b.ready));
      if (t.dead) return;
      py.innerHTML = pyHtml(x.p);
      for (let r = 0; r < o.repeats; r++) {
        if (t.dead) return;
        await sayWord(x.w, r === 2);
        if (t.dead) return;
        await sleep(650);
      }
      if (t.dead) return;
      if (o.ru === 'after') ru.textContent = x.ru;
      if (o.sayRu && Speech.voiceFor('ru')) { await Speech.say(x.ru.split(';')[0].replace(/\(.*?\)/g, ''), { lang: 'ru' }); if (t.dead) return; }
      if (o.pause) {
        for (let s = o.pause; s > 0; s--) { say.textContent = `Повторите! 请跟我读 · ${s}`; await sleep(1000); if (t.dead) return; }
        say.textContent = '';
        await sayWord(x.w);
        if (t.dead) return;
      }
      if (o.examples) {
        await loadSentences();
        const ids = EXAMPLES[x.w] || [];
        const s = ids.length ? SENTENCES[ids[0]] : null;
        if (s && !t.dead) {
          ex.innerHTML = `<div class="zh">${highlight(s.zh, x.w)}</div><div style="opacity:.8">${esc(s.py)}</div><div style="color:#f1c98a">${esc(s.ru)}</div>`;
          await saySentence(s);
          if (t.dead) return;
        }
      }
      await sleep(1200);
    }
    async function run() {
      const t = tok = { dead: false };
      $('#st-play').innerHTML = `${ICON.pause} Пауза`;
      while (idx < words.length && !t.dead) {
        await show(idx, t);
        if (t.dead) return;
        idx++;
      }
      if (!t.dead) {
        tok = null;
        mid.innerHTML = `<div class="stage-cover"><h2>Урок пройден! 太棒了!</h2><div class="list">${words.map((x) => esc(x.w)).join(' · ')}</div></div>`;
        idx = 0;
        $('#st-play').innerHTML = `${ICON.play} Сначала`;
      }
    }
    $('#st-play').onclick = () => { if (tok) stop(); else run(); };
    $('#st-next').onclick = () => { const was = !!tok; stop(); idx = Math.min(words.length - 1, idx + 1); if (was) run(); else show(idx, { dead: false }); };
    $('#st-prev').onclick = () => { const was = !!tok; stop(); idx = Math.max(0, idx - 1); if (was) run(); else show(idx, { dead: false }); };
    $('#st-full').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else stage.requestFullscreen?.().catch(() => {}); };
    const key = (e) => {
      if (e.target.closest('input,select,textarea')) return;
      if (e.key === ' ') { e.preventDefault(); $('#st-play').click(); }
      if (e.key === 'ArrowRight') $('#st-next').click();
      if (e.key === 'ArrowLeft') $('#st-prev').click();
    };
    document.addEventListener('keydown', key);
    onLeave(() => { stop(); document.removeEventListener('keydown', key); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); });
    cover();
  }

  // ----- Flashcards -----
  function tabCards(el, level) {
    el.innerHTML = `
      <div class="toolbar" id="ct"></div>
      <div class="chips" id="cmode" style="margin-bottom:12px">
        <button class="chip" data-m="zh">汉字 → перевод</button><button class="chip" data-m="ru">Перевод → 汉字</button><button class="chip" data-m="ear">На слух</button>
      </div>
      <div class="card" id="deck"></div>`;
    let deck = [], pos = 0, flipped = false, right = 0, wrong = [];
    function start(list) {
      deck = list || shuffle(lessonWords(level)).sort((a, b) => (isKnown(a.w) ? 1 : 0) - (isKnown(b.w) ? 1 : 0));
      pos = 0; right = 0; wrong = []; flipped = false;
      draw();
    }
    $('#ct').appendChild(lessonPicker(level, () => start()));
    const paintMode = () => $$('#cmode .chip').forEach((c) => c.classList.toggle('on', c.dataset.m === settings.cardMode));
    $('#cmode').onclick = (e) => { const c = e.target.closest('[data-m]'); if (!c) return; settings.cardMode = c.dataset.m; saveSettings(); paintMode(); flipped = false; draw(); };
    paintMode();
    function draw() {
      const box = $('#deck');
      if (pos >= deck.length) {
        box.innerHTML = `<div class="result"><div class="num">${right}/${deck.length}</div><p>${wrong.length ? `Повторите ещё: ${wrong.map((x) => `<span class="zh">${esc(x.w)}</span>`).join(' ')}` : 'Все слова узнаны!'}</p>
          <div class="row" style="justify-content:center">${wrong.length ? '<button class="btn primary" id="again-wrong">Повторить ошибки</button>' : ''}<button class="btn" id="again">Заново</button></div></div>`;
        $('#again').onclick = () => start();
        if ($('#again-wrong')) $('#again-wrong').onclick = () => start(shuffle(wrong));
        return;
      }
      const x = deck[pos], m = settings.cardMode;
      const front = m === 'zh' ? `<div class="hz">${esc(x.w)}</div>`
        : m === 'ru' ? `<div class="ru">${esc(x.ru)}</div>`
        : `<button class="speak quiz-play" data-say="${esc(x.w)}" aria-label="Послушать">${ICON.speak}</button>`;
      const back = `<div class="hz">${esc(x.w)}</div><div class="py">${pyHtml(x.p)}</div><div class="ru">${esc(x.ru)}</div>`;
      box.innerHTML = `<div class="score-line"><span class="muted">Карточка ${pos + 1} из ${deck.length}</span><span class="muted">✓ ${right} · ✗ ${wrong.length}</span></div>
        <div class="flash" id="flash">${flipped ? back : `${front}<div class="hint">Нажмите, чтобы перевернуть (пробел)</div>`}</div>
        <div class="row" style="justify-content:center;padding:0 16px 18px">
          ${sayBtn(x.w)}
          <button class="btn bad" id="no">Не знаю <kbd>1</kbd></button><button class="btn good" id="yes">Знаю <kbd>2</kbd></button></div>`;
      $('#flash').onclick = (e) => { if (e.target.closest('.speak')) return; flipped = !flipped; draw(); if (flipped) sayWord(x.w); };
      $('#yes').onclick = () => answer(true);
      $('#no').onclick = () => answer(false);
      if (!flipped && m === 'ear') sayWord(x.w);
    }
    function answer(ok) {
      const x = deck[pos];
      if (ok) { right++; known[x.w] = Math.min(5, (known[x.w] || 0) + 1); }
      else { wrong.push(x); known[x.w] = 0; }
      saveKnown();
      pos++; flipped = false; draw();
    }
    const key = (e) => {
      if (e.target.closest('input,select')) return;
      if (e.key === ' ') { e.preventDefault(); $('#flash')?.click(); }
      if (e.key === '1') $('#no')?.click();
      if (e.key === '2') $('#yes')?.click();
    };
    document.addEventListener('keydown', key);
    onLeave(() => document.removeEventListener('keydown', key));
    start();
  }

  // ----- Quiz engine -----
  // Вопрос: {play?: () => Promise, prompt: html, options?: [{html, ok}], input?: {check(value) -> {ok, show}}, reveal: html, word?}
  function runQuiz(box, { title, questions, onFinish }) {
    let i = 0, score = 0, answered = false;
    const missed = [];
    function draw() {
      answered = false;
      if (i >= questions.length) {
        const pct = Math.round(score / questions.length * 100);
        box.innerHTML = `<div class="result"><div class="num">${score}/${questions.length}</div><p class="muted">${esc(title)} · ${pct}%</p>
          ${missed.length ? `<div style="text-align:left;max-width:560px;margin:0 auto" class="stack"><b>Ошибки:</b>${missed.map((q) => `<div class="row">${q.word ? sayBtn(q.word.w) : ''}<span class="grow">${q.reveal}</span></div>`).join('')}</div>` : '<p>Без ошибок! 太棒了!</p>'}
          <div class="row" style="justify-content:center;margin-top:16px"><button class="btn primary" id="q-again">Ещё раз</button></div></div>`;
        $('#q-again', box).onclick = () => onFinish && onFinish('again');
        onFinish && onFinish('done', score, questions.length);
        return;
      }
      const q = questions[i];
      box.innerHTML = `<div class="score-line"><b>${esc(title)}</b><span class="muted">Вопрос ${i + 1} из ${questions.length} · ✓ ${score}</span></div>
        <div class="quiz-q">${q.play ? `<button class="speak quiz-play" id="q-play" aria-label="Послушать ещё раз">${ICON.speak}</button>
          <div style="margin-top:6px">${q.slow ? `<button class="btn small ghost" id="q-slow">${ICON.slow} медленно</button>` : ''}</div>` : ''}${q.prompt || ''}</div>
        ${q.options ? `<div class="answers">${q.options.map((o, k) => `<button class="answer" data-k="${k}">${o.html}</button>`).join('')}</div>` : ''}
        ${q.input ? `<div style="text-align:center;padding:12px 16px"><input type="text" class="dict-input" id="q-in" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(q.input.placeholder || '')}">
          <div style="margin-top:10px"><button class="btn primary" id="q-check">Проверить</button></div></div>` : ''}
        <div class="feedback" id="q-fb"></div>
        <div class="row" style="justify-content:center;padding:0 16px 18px"><button class="btn hidden" id="q-next">Дальше →</button></div>`;
      const play = (slow) => { const b = $('#q-play', box); b.classList.add('playing'); const d = () => b.classList.remove('playing'); q.play(slow).then(d, d); };
      if (q.play) { $('#q-play', box).onclick = () => play(false); if ($('#q-slow', box)) $('#q-slow', box).onclick = () => play(true); setTimeout(() => play(false), 250); }
      if (q.options) $$('.answer', box).forEach((b) => { b.onclick = () => choose(+b.dataset.k); });
      if (q.input) {
        const inp = $('#q-in', box);
        inp.focus();
        const check = () => { if (answered) { next(); return; } const r = q.input.check(inp.value); finish(r.ok, r.show); };
        $('#q-check', box).onclick = check;
        inp.onkeydown = (e) => { if (e.key === 'Enter') check(); };
      }
      $('#q-next', box).onclick = next;
    }
    function choose(k) {
      if (answered) return;
      const q = questions[i];
      $$('.answer', box).forEach((b, j) => { b.disabled = true; if (q.options[j].ok) b.classList.add('right'); else if (j === k) b.classList.add('wrong'); });
      finish(q.options[k].ok);
    }
    function finish(ok, show) {
      answered = true;
      const q = questions[i];
      if (ok) score++; else missed.push(q);
      if (q.word) {
        if (ok) known[q.word.w] = Math.max(known[q.word.w] || 0, 1);
        else { mistakes[q.word.w] = (mistakes[q.word.w] || 0) + 1; saveMistakes(); }
      }
      $('#q-fb', box).innerHTML = `<div style="font-weight:700;color:var(${ok ? '--good' : '--bad'})">${ok ? 'Верно!' : 'Неверно'}${show ? ` — ${show}` : ''}</div><div>${q.reveal || ''}</div>`;
      $('#q-next', box).classList.remove('hidden');
      $('#q-next', box).focus();
      if (ok && q.options) setTimeout(() => { if (answered && questions[i] === q) next(); }, 1300);
    }
    function next() { stopSound(); i++; draw(); }
    const key = (e) => {
      if (!box.isConnected) return;
      if (e.target.closest('input')) return;
      if (/^[1-4]$/.test(e.key) && !answered && questions[i]?.options?.[+e.key - 1]) choose(+e.key - 1);
      else if (e.key === 'Enter' && answered) next();
      else if (e.key === ' ' && questions[i]?.play) { e.preventDefault(); $('#q-play', box)?.click(); }
    };
    document.addEventListener('keydown', key);
    onLeave(() => document.removeEventListener('keydown', key));
    draw();
  }

  const reveal = (x) => `<span class="zh" style="font-size:22px">${esc(x.w)}</span> ${pyHtml(x.p)} — ${esc(x.ru)}`;
  function distractors(x, pool, n, key = (y) => y.w) {
    const same = pool.filter((y) => y.w !== x.w && key(y) !== key(x) && y.ru !== x.ru);
    const len = same.filter((y) => y.w.length === x.w.length);
    const out = shuffle(len.length >= n ? len : same).slice(0, n);
    return out;
  }
  function toneVariants(x) {
    const syl = sylls(x.p), tones = syl.map(toneOf), plain = syl.map(plainSyl);
    const key = (ts) => ts.join('');
    const seen = new Set([key(tones)]), out = [tones];
    let guard = 0;
    while (out.length < 4 && guard++ < 200) {
      const ts = tones.map((t) => (t === 5 ? 5 : 1 + (Math.random() * 4 | 0)));
      if (!seen.has(key(ts))) { seen.add(key(ts)); out.push(ts); }
    }
    return shuffle(out).map((ts) => ({ html: `<span style="font-size:22px">${pyHtml(plain.map((p, k) => markSyl(p, ts[k])).join(' '))}</span>`, ok: key(ts) === key(tones) }));
  }
  const QUIZ = {
    hear: { ic: '听', title: 'Какое слово прозвучало?', d: 'Слушаете слово и выбираете иероглифы',
      make: (x, pool) => ({ word: x, play: (s) => sayWord(x.w, s), slow: true, prompt: '',
        options: shuffle([x, ...distractors(x, pool, 3)]).map((y) => ({ html: `<span class="zh">${esc(y.w)}</span>`, ok: y === x })), reveal: reveal(x) }) },
    mean: { ic: '意', title: 'Что это значит?', d: 'Слушаете слово и выбираете перевод',
      make: (x, pool) => ({ word: x, play: (s) => sayWord(x.w, s), slow: true, prompt: '',
        options: shuffle([x, ...distractors(x, pool, 3, (y) => y.ru)]).map((y) => ({ html: esc(y.ru.split(';')[0]), ok: y === x })), reveal: reveal(x) }) },
    tones: { ic: 'ǎ', title: 'Какие тоны?', d: 'Слушаете слово и выбираете правильные тоны',
      filter: (x) => sylls(x.p).some((s) => toneOf(s) !== 5),
      make: (x) => ({ word: x, play: (s) => sayWord(x.w, s), slow: true, prompt: `<div class="big" style="margin-top:10px">${esc(x.w)}</div>`, options: toneVariants(x), reveal: reveal(x) }) },
    dict: { ic: '写', title: 'Диктант: запишите пиньинь', d: 'Слушаете и пишете пиньинь (тоны — цифрами: ni3hao3)',
      make: (x) => ({ word: x, play: (s) => sayWord(x.w, s), slow: true, prompt: `<div class="muted" style="margin-top:8px">${settings.dictTones ? 'Пиньинь с тонами: цифры (hao3) или значки (hǎo)' : 'Пиньинь без тонов'}</div>`,
        input: { placeholder: settings.dictTones ? 'например: xue2xi2' : 'например: xuexi',
          check: (v) => { const a = parseAnswer(v), e = expectedAnswer(x.p); const ok = a.letters === e.letters && (!settings.dictTones || a.tones === e.tones); return { ok, show: `<span class="zh">${esc(x.w)}</span> ${pyHtml(x.p)}` }; } },
        reveal: reveal(x) }) },
    read: { ic: '读', title: 'Чтение: иероглифы → перевод', d: 'Видите слово и выбираете перевод',
      make: (x, pool) => ({ word: x, prompt: `<div class="big">${esc(x.w)}</div>`,
        options: shuffle([x, ...distractors(x, pool, 3, (y) => y.ru)]).map((y) => ({ html: esc(y.ru.split(';')[0]), ok: y === x })), reveal: reveal(x) }) },
    sent: { ic: '句', title: 'Предложения на слух', d: 'Слушаете фразу носителя или голоса и выбираете перевод', sentences: true },
  };
  function quizPool(level, scope) {
    const base = scope === 'lesson' ? lessonWords(level) : scope === 'level' ? levelWords(level) : scope === 'mistakes'
      ? upTo(level).filter((x) => mistakes[x.w]).sort((a, b) => mistakes[b.w] - mistakes[a.w]).slice(0, 30) : upTo(level);
    return base;
  }
  async function sentenceQuestions(level, count) {
    await loadSentences();
    const std = settings.std;
    let list = SENTENCES.filter((s) => lvOf(s, std) === level);
    if (list.length < count * 2) list = SENTENCES.filter((s) => lvOf(s, std) && lvOf(s, std) <= level);
    if (list.length < 4) return [];
    return shuffle(list).slice(0, count).map((s) => {
      const others = shuffle(list.filter((y) => y !== s && y.ru !== s.ru)).slice(0, 3);
      return { play: (slow) => saySentence(s, slow), slow: true, prompt: '',
        options: shuffle([s, ...others]).map((y) => ({ html: esc(y.ru), ok: y === s })),
        reveal: `<div class="zh" style="font-size:20px">${esc(s.zh)}</div><div class="muted">${esc(s.py)}</div><div>${esc(s.ru)}</div>` };
    });
  }

  // ----- Listening -----
  function tabListen(el, level) {
    let scope = 'lesson';
    el.innerHTML = `
      <div class="toolbar" id="lt"></div>
      <div class="chips" id="scope" style="margin-bottom:14px">
        <button class="chip on" data-s="lesson">Текущий урок</button><button class="chip" data-s="level">Весь HSK ${level}</button>
        <button class="chip" data-s="upto">HSK 1–${level}</button><button class="chip" data-s="mistakes">Мои ошибки</button></div>
      <div id="lbody"></div>`;
    $('#lt').appendChild(lessonPicker(level, () => menu(), { allowAll: false }));
    $('#scope').onclick = (e) => { const c = e.target.closest('[data-s]'); if (!c) return; scope = c.dataset.s; $$('#scope .chip').forEach((b) => b.classList.toggle('on', b === c)); menu(); };
    function menu() {
      stopSound();
      const pool = quizPool(level, scope);
      $('#lbody').innerHTML = `<div class="mode-grid">${Object.entries(QUIZ).map(([k, m]) => `<button class="mode" data-q="${k}"><span class="ic">${m.ic}</span><b>${m.title}</b><span>${m.d}</span></button>`).join('')}</div>
        <p class="muted" style="font-size:14px">${scope === 'mistakes' ? `Слов с ошибками: ${pool.length}.` : `Слов в выборке: ${pool.length}.`}
        Диктант: <label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="dict-tones" ${settings.dictTones ? 'checked' : ''}> проверять тоны</label></p>`;
      $('#dict-tones').onchange = (e) => { settings.dictTones = e.target.checked; saveSettings(); };
      $$('#lbody [data-q]').forEach((b) => { b.onclick = () => start(b.dataset.q); });
    }
    async function start(kind) {
      const m = QUIZ[kind];
      const body = $('#lbody');
      body.innerHTML = '<div class="card empty">Загрузка…</div>';
      let questions;
      if (m.sentences) {
        questions = await sentenceQuestions(level, 10);
        if (!questions.length) { body.innerHTML = '<div class="card empty">Предложения ещё не загружены. Нужен файл data/sentences.js (собирается автоматически).</div>'; return; }
      } else {
        const pool = quizPool(level, scope).filter(m.filter || (() => true));
        if (pool.length < 2) { body.innerHTML = '<div class="card empty">Мало слов для упражнения. Выберите другой урок или «Весь уровень».</div>'; return; }
        const optsPool = upTo(level).length > 20 ? upTo(level) : WORDS.slice(0, 300);
        questions = shuffle(pool).slice(0, 10).map((x) => m.make(x, optsPool.concat(pool)));
      }
      body.innerHTML = '<div class="card" id="qbox"></div><div class="row" style="margin-top:12px"><button class="btn ghost" id="to-menu">← К упражнениям</button></div>';
      $('#to-menu').onclick = menu;
      runQuiz($('#qbox'), { title: m.title, questions, onFinish: (s) => { if (s === 'again') start(kind); } });
    }
    menu();
  }

  // ----- Characters -----
  function tabChars(el, level) {
    const chars = levelChars(level);
    let cur = chars[0];
    el.innerHTML = `
      <div class="toolbar"><span class="muted">${chars.length} ${plural(chars.length, 'новый иероглиф', 'новых иероглифа', 'новых иероглифов')} уровня</span><span class="grow"></span>
        <button class="btn" id="sheet-sel">${ICON.print} Пропись: выбранный</button><button class="btn" id="sheet-lesson">${ICON.print} Прописи урока</button></div>
      <div class="card pad char-panel" id="cp"></div>
      <div class="char-grid" style="margin-top:14px">${chars.map((c) => `<button data-c="${esc(c)}" class="${c === cur ? 'on' : ''}">${esc(c)}</button>`).join('')}</div>`;
    $('.char-grid', el).onclick = (e) => { const b = e.target.closest('[data-c]'); if (!b) return; cur = b.dataset.c; $$('.char-grid button', el).forEach((x) => x.classList.toggle('on', x === b)); draw(); $('#cp').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
    function draw() {
      if (!cur) { $('#cp').innerHTML = '<div class="empty">Нет новых иероглифов</div>'; return; }
      const reading = charReading(cur);
      const ws = wordsWithChar(cur).filter((x) => lvOf(x) && lvOf(x) <= level).slice(0, 12);
      $('#cp').innerHTML = `<div id="hwbox"></div><div>
        <div class="row"><span class="kai" style="font-size:54px;line-height:1">${esc(cur)}</span><span class="wc-py">${reading ? pyHtml(reading) : ''}</span>${speakBtn(`data-text="${esc(cur)}"`)}</div>
        <div class="muted" id="stroke-count" style="margin:6px 0 12px"></div>
        <div class="row"><button class="btn primary" id="c-anim">${ICON.play} Порядок черт</button><button class="btn" id="c-quiz">✎ Написать самому</button><button class="btn" id="c-show">Показать</button></div>
        <p class="muted" style="font-size:14px">«Написать самому»: ведите черты пальцем или мышью в клетке, в правильном порядке. После трёх ошибок подскажет.</p>
        <div class="wc-sec"><h4>Слова с этим иероглифом</h4><div class="mini-words">${ws.map((x) => `<button data-open="${esc(x.w)}"><span class="zh">${esc(x.w)}</span> <span class="muted">${esc(x.ru.split(/[;,(]/)[0])}</span></button>`).join('')}</div></div></div>`;
      const box = hanziBox(cur, 240, { radical: true });
      $('#hwbox').appendChild(box);
      box.ready.then((w) => { const d = STROKES[cur]; if (d) $('#stroke-count').textContent = `${d.strokes.length} ${plural(d.strokes.length, 'черта', 'черты', 'черт')}`; if (w) box.animate(); });
      $('#c-anim').onclick = () => box.animate();
      $('#c-show').onclick = () => box.ready.then((w) => w && w.showCharacter());
      $('#c-quiz').onclick = () => box.ready.then((w) => {
        if (!w) return;
        w.quiz({ showHintAfterMisses: 3, onComplete: (r) => toast(r.totalMistakes ? `Готово! Ошибок: ${r.totalMistakes}` : 'Отлично, без ошибок! 很好!') });
      });
      $('.mini-words', el).onclick = (e) => { const o = e.target.closest('[data-open]'); if (o) openWord(o.dataset.open); };
    }
    $('#sheet-sel').onclick = () => cur && printSheets([cur], `Пропись: ${cur}`);
    $('#sheet-lesson').onclick = () => {
      const lw = lessonWords(level, currentLesson(level) || 1);
      const cs = [];
      lw.forEach((x) => [...x.w].forEach((c) => { if (/\p{Script=Han}/u.test(c) && !cs.includes(c)) cs.push(c); }));
      printSheets(cs, `HSK ${level} · урок ${currentLesson(level) || 1} — прописи`);
    };
    draw();
  }

  // ----- Grammar -----
  function tabGrammar(el, level) {
    const list = (window.HSK_GRAMMAR || {})[level] || [];
    el.innerHTML = `<p class="muted" style="margin-top:0">Основные конструкции HSK ${level}. Нажмите ${ICON.speak.replace('<svg', '<svg style="width:16px;height:16px;vertical-align:-3px"')} чтобы послушать пример.</p>
      <div class="stack">${list.map((g, k) => `<div class="card gram">
        <div class="row"><h3 class="grow">${k + 1}. ${esc(g.t)}</h3><button class="btn small" data-all="${k}">${ICON.play} Все примеры</button></div>
        <div class="formula">${esc(g.f)}</div><p>${esc(g.d)}</p>
        ${g.ex.map((e) => `<div class="ex">${speakBtn(`data-text="${esc(e[0])}"`)}<div class="grow"><div class="zh">${esc(e[0])}</div><div class="py">${esc(e[1])}</div><div class="ru">${esc(e[2])}</div></div></div>`).join('')}
      </div>`).join('')}</div>`;
    let tok = null;
    $$('[data-all]', el).forEach((b) => {
      b.onclick = async () => {
        if (tok) tok.dead = true;
        const t = tok = { dead: false };
        for (const e of list[+b.dataset.all].ex) { if (t.dead) return; await sayText(e[0]); await sleep(900); }
      };
    });
    onLeave(() => { if (tok) tok.dead = true; });
  }

  // ----- Test -----
  function tabTest(el, level) {
    const key = settings.std + level;
    el.innerHTML = `<div class="card pad">
        <h2 style="font-size:22px">Пробный тест HSK ${level}</h2>
        <p class="muted">20 заданий по словам HSK 1–${level}: 听力 — аудирование (слова и фразы на слух) и 阅读 — чтение (значение слов и пропуски в предложениях).
        ${best[key] != null ? `Лучший результат: <b>${best[key]}%</b>.` : ''}</p>
        <button class="btn primary" id="t-start">${ICON.play} Начать тест</button></div><div id="tbody" style="margin-top:14px"></div>`;
    $('#t-start').onclick = async () => {
      const body = $('#tbody');
      body.innerHTML = '<div class="card empty">Готовлю задания…</div>';
      const pool = upTo(level), fresh = levelWords(level);
      const pickW = (n) => shuffle(fresh.length >= n ? fresh : pool).slice(0, n);
      const qs = [];
      pickW(5).forEach((x) => qs.push(QUIZ.hear.make(x, pool)));
      const sq = await sentenceQuestions(level, 5);
      qs.push(...sq);
      pickW(5 - sq.length).forEach((x) => qs.push(QUIZ.mean.make(x, pool)));
      pickW(5).forEach((x) => qs.push(QUIZ.read.make(x, pool)));
      // Пропуски: предложение с пропущенным словом, выбрать слово.
      const gaps = [];
      if (SENTENCES && SENTENCES.length) {
        const cands = shuffle(fresh).filter((x) => (EXAMPLES[x.w] || []).length);
        for (const x of cands) {
          if (gaps.length >= 5) break;
          const s = SENTENCES[EXAMPLES[x.w][0]];
          if (!s.zh.includes(x.w)) continue;
          gaps.push({ word: x, prompt: `<div class="zh" style="font-size:26px;line-height:1.6">${esc(s.zh).split(esc(x.w)).join('<span style="border-bottom:2px solid var(--brand);padding:0 1.2em"> </span>')}</div><div class="muted">${esc(s.ru)}</div>`,
            options: shuffle([x, ...distractors(x, pool, 3)]).map((y) => ({ html: `<span class="zh">${esc(y.w)}</span>`, ok: y === x })),
            reveal: `<div class="zh" style="font-size:20px">${highlight(s.zh, x.w)}</div>` });
        }
      }
      qs.push(...gaps);
      pickW(5 - gaps.length).forEach((x) => qs.push({ word: x, prompt: `<div style="font-size:24px">${esc(x.ru.split(';')[0])}</div>`,
        options: shuffle([x, ...distractors(x, pool, 3)]).map((y) => ({ html: `<span class="zh">${esc(y.w)}</span>`, ok: y === x })), reveal: reveal(x) }));
      body.innerHTML = '<div class="card" id="tq"></div>';
      runQuiz($('#tq'), { title: `Тест HSK ${level}`, questions: qs, onFinish: (s, score, total) => {
        if (s === 'again') { $('#t-start').click(); return; }
        const pct = Math.round(score / total * 100);
        if (best[key] == null || pct > best[key]) { best[key] = pct; store.set('best', best); }
      } });
    };
  }

  // ---------- pinyin ----------
  const TONE_NAMES = ['1-й тон — ровный высокий', '2-й тон — восходящий', '3-й тон — нисходяще-восходящий', '4-й тон — резкий нисходящий'];
  const CONTOURS = ['M10 14 L90 14', 'M10 44 L90 10', 'M10 30 L45 58 L90 16', 'M10 8 L90 60'];
  function viewPinyin() {
    const syl = window.HSK_SYLLABLES || [];
    const initials = ['', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'zh', 'ch', 'sh', 'r', 'z', 'c', 's', 'y', 'w'];
    let ini = 'm';
    app.innerHTML = `
      <div class="crumbs"><a class="back" href="#/">← Все уровни</a></div>
      <h1 class="page-title">Пиньинь и тоны</h1>
      <p class="page-sub">В китайском слоге — начальный согласный (инициаль), конечная часть (финаль) и тон. Тон меняет смысл: 妈 mā «мама», 麻 má «конопля», 马 mǎ «лошадь», 骂 mà «ругать».</p>
      <div class="tone-demo" style="margin-top:16px">${['妈', '麻', '马', '骂'].map((c, k) => `<button data-text="${c}">
        <svg viewBox="0 0 100 70"><g stroke="var(--line)" stroke-width="1">${[8, 21, 34, 47, 60].map((y) => `<path d="M6 ${y}H94"/>`).join('')}</g><path d="${CONTOURS[k]}" stroke="var(--t${k + 1})" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span class="zh">${c}</span><b class="t${k + 1}">${markSyl('ma', k + 1)}</b><div class="muted" style="font-size:13px">${TONE_NAMES[k]}</div></button>`).join('')}</div>
      <h2 class="section-h">Тренажёр тонов</h2>
      <div class="card" id="tone-game"></div>
      <h2 class="section-h">Все слоги</h2>
      <p class="muted" style="margin-top:-6px">Выберите инициаль и нажимайте на тоны: звучит иероглиф с этим чтением (подсказка — при наведении).</p>
      <div class="chips scroll" id="inis">${initials.map((i) => `<button class="chip" data-i="${i}">${i || 'без инициали'}</button>`).join('')}</div>
      <div class="syl-grid" id="syls" style="margin-top:10px"></div>
      <h2 class="section-h">Правила чтения</h2>
      <div class="card pad rules"><ul style="margin:0;padding-left:20px">
        <li><b>Два третьих тона подряд:</b> первый читается вторым. 你好 nǐ hǎo звучит как «ní hǎo».</li>
        <li><b>不 bù</b> перед 4-м тоном становится 2-м: 不是 bú shì, 不对 bú duì.</li>
        <li><b>一 yī</b> перед 4-м тоном — 2-й тон (一个 yí gè), перед 1–3-м — 4-й тон (一天 yì tiān); в счёте и в конце слова — yī.</li>
        <li><b>Лёгкий (нулевой) тон</b> — короткий и безударный, знака нет: 妈妈 māma, 的 de, 了 le.</li>
        <li><b>Эризация</b>: 儿 после слога даёт «р»-окраску: 一点儿 yīdiǎnr, 哪儿 nǎr.</li>
        <li><b>ü</b> после j, q, x и y пишется как u: ju, qu, xu, yu — но звучит как «ю» губами «у».</li>
        <li>Знак тона ставится над a или e; в ou — над o; в остальных случаях — над последней гласной: guì, liú.</li>
        <li><b>zh, ch, sh, r</b> — «твёрдые», язык загнут назад; <b>j, q, x</b> — мягкие, похожи на «цз», «ць», «сь»; <b>z, c, s</b> — «цз», «ц», «с».</li>
      </ul></div>`;
    function drawSyls() {
      $$('#inis .chip').forEach((c) => c.classList.toggle('on', c.dataset.i === ini));
      $('#syls').innerHTML = syl.filter((s) => s[1] === ini).map(([s, , cs]) => `<div class="syl"><b>${esc(s)}</b><div class="tones">${cs.map((c, k) =>
        `<button ${c ? `data-text="${esc(c)}" title="${esc(c)}"` : 'disabled'} class="t${k + 1}">${esc(markSyl(s, k + 1))}</button>`).join('')}</div></div>`).join('')
        || '<div class="muted">Нет слогов</div>';
    }
    $('#inis').onclick = (e) => { const c = e.target.closest('[data-i]'); if (!c) return; ini = c.dataset.i; drawSyls(); };
    drawSyls();
    // Тренажёр: звучит иероглиф, выбрать тон.
    const pool = [];
    syl.forEach(([s, , cs]) => cs.forEach((c, k) => { if (c && BY_WORD.has(c)) pool.push({ s, c, t: k + 1 }); }));
    let streak = 0, bestStreak = store.get('toneStreak', 0), cur = null, answered = false;
    function round() {
      answered = false;
      cur = pick(pool);
      const g = $('#tone-game');
      g.innerHTML = `<div class="score-line"><b>Какой тон?</b><span class="muted">Серия: ${streak} · рекорд: ${bestStreak}</span></div>
        <div class="quiz-q"><button class="speak quiz-play" id="tg-play" aria-label="Послушать">${ICON.speak}</button></div>
        <div class="answers" style="grid-template-columns:repeat(4,1fr)">${[1, 2, 3, 4].map((t) => `<button class="answer" data-t="${t}"><b class="t${t}" style="font-size:24px">${markSyl(cur.s, t)}</b><span class="muted" style="font-size:12px">${t}-й тон</span></button>`).join('')}</div>
        <div class="feedback" id="tg-fb"></div>`;
      const play = () => { stopSound(); Speech.say(cur.c, { rate: settings.rate * 0.9 }); };
      $('#tg-play').onclick = play;
      setTimeout(play, 200);
      $$('#tone-game [data-t]').forEach((b) => { b.onclick = () => {
        if (answered) return;
        answered = true;
        const ok = +b.dataset.t === cur.t;
        b.classList.add(ok ? 'right' : 'wrong');
        $(`#tone-game [data-t="${cur.t}"]`).classList.add('right');
        streak = ok ? streak + 1 : 0;
        if (streak > bestStreak) { bestStreak = streak; store.set('toneStreak', bestStreak); }
        const x = BY_WORD.get(cur.c);
        $('#tg-fb').innerHTML = `<span class="zh" style="font-size:26px">${esc(cur.c)}</span> ${pyHtml(markSyl(cur.s, cur.t))}${x ? ' — ' + esc(x.ru.split(';')[0]) : ''}`;
        setTimeout(round, ok ? 1200 : 2600);
      }; });
    }
    if (pool.length) round(); else $('#tone-game').innerHTML = '<div class="empty">Нет данных слогов</div>';
    const keyH = (e) => { if (/^[1-4]$/.test(e.key)) $(`#tone-game [data-t="${e.key}"]`)?.click(); if (e.key === ' ') { e.preventDefault(); $('#tg-play')?.click(); } };
    document.addEventListener('keydown', keyH);
    onLeave(() => document.removeEventListener('keydown', keyH));
  }

  // ---------- about ----------
  function viewAbout() {
    app.innerHTML = `
      <div class="crumbs"><a class="back" href="#/">← Все уровни</a></div>
      <h1 class="page-title">Как пользоваться</h1>
      <div class="stack" style="margin-top:16px">
      <div class="card pad"><h3>Для урока в классе</h3><ul>
        <li><b>Видеоурок</b> — выберите урок и нажмите «Во весь экран»: иероглифы рисуются по чертам, слово звучит, появляются пиньинь, перевод, пауза «Повторите!» и пример. Подходит для проектора и интерактивной доски.</li>
        <li><b>Слова → «Слушать урок»</b> — аудиоурок: каждое слово дважды, затем перевод (если в системе есть русский голос).</li>
        <li><b>Аудирование</b> — пять видов упражнений на слух, <b>Тест</b> — 20 заданий в формате HSK (听力 + 阅读).</li>
        <li><b>Печать</b>: список слов урока, контрольная без перевода, прописи с порядком черт (вкладка «Иероглифы»).</li>
        <li><b>Своё видео</b>: включите запись экрана (Windows 10/11: <kbd>Win</kbd>+<kbd>Alt</kbd>+<kbd>R</kbd> в Xbox Game Bar или бесплатный OBS; macOS: <kbd>⌘</kbd>+<kbd>⇧</kbd>+<kbd>5</kbd>) и запустите видеоурок — получится видеофайл для учеников.</li>
      </ul></div>
      <div class="card pad"><h3>Звук и голоса</h3><ul>
        <li>Для многих слов звучат <b>записи носителей языка</b> из Wikimedia Commons, для фраз — записи Tatoeba. Остальное озвучивает голос браузера (нужен китайский голос).</li>
        <li><b>Chrome и Edge</b> (Windows, macOS, Android) содержат китайский голос сразу. Лучший — «Microsoft Xiaoxiao Online (Natural)» в Edge.</li>
        <li><b>Windows</b>: Параметры → Время и язык → Речь → «Добавить голоса» → «Китайский (упрощённое письмо, Китай)».</li>
        <li><b>Android</b>: Настройки → Специальные возможности → Синтез речи → Google → Установка голосовых данных → китайский.</li>
        <li><b>iPhone / iPad</b>: Настройки → Универсальный доступ → Устное содержимое → Голоса → Китайский.</li>
        <li>Скорость (обычная и медленная) и выбор голоса — в настройках ⚙ вверху.</li>
      </ul></div>
      <div class="card pad"><h3>Видео в интернете по уровням</h3><p class="muted">Готовые подборки видео и аудирований по каждому уровню:</p>
        <div class="row">${[1, 2, 3, 4, 5, 6].map((l) => `<a class="btn small" target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${encodeURIComponent(`HSK ${l} 听力 listening`)}">YouTube: HSK ${l}</a>`).join('')}</div>
        <div class="row" style="margin-top:8px">${[1, 2, 3, 4, 5, 6].map((l) => `<a class="btn small" target="_blank" rel="noopener" href="https://search.bilibili.com/all?keyword=${encodeURIComponent(`HSK${l} 听力`)}">Bilibili: HSK ${l}</a>`).join('')}</div></div>
      <div class="card pad"><h3>Установка и работа без интернета</h3><ul>
        <li>Откройте <code>index.html</code> в браузере — установка не нужна. Если приложение опубликовано на сайте (например, GitHub Pages), его можно «Установить» из меню браузера и открывать с рабочего стола или телефона.</li>
        <li>Прогресс (выученные слова, ошибки, рекорды) хранится в браузере на этом устройстве.</li>
      </ul></div>
      <div class="card pad"><h3>Источники и лицензии</h3><ul>
        <li>Списки слов HSK 2.0 и HSK 3.0 (программа 2026): <a href="https://github.com/drkameleon/complete-hsk-vocabulary" target="_blank" rel="noopener">complete-hsk-vocabulary</a> (MIT) и <a href="https://github.com/clem109/hsk-vocabulary" target="_blank" rel="noopener">hsk-vocabulary</a> (MIT). Переводы на русский подготовлены для этого приложения.</li>
        <li>Порядок черт: <a href="https://github.com/skishore/makemeahanzi" target="_blank" rel="noopener">Make Me a Hanzi</a> (Arphic Public License), анимация — <a href="https://hanziwriter.org" target="_blank" rel="noopener">Hanzi Writer</a> (MIT).</li>
        <li>Примеры предложений и их записи: <a href="https://tatoeba.org" target="_blank" rel="noopener">Tatoeba</a> (CC BY 2.0 FR); ссылка на каждое предложение — рядом с ним.</li>
        <li>Записи слов: <a href="https://commons.wikimedia.org" target="_blank" rel="noopener">Wikimedia Commons</a> через Викисловарь (CC BY-SA; автор — на странице файла, ссылка в карточке слова).</li>
      </ul></div>
      </div>`;
  }

  // ---------- settings ----------
  $('#open-settings').onclick = () => {
    const zh = Speech.zh();
    const m = openModal(`<div class="pad stack" style="padding:22px">
      <h2 style="font-size:22px">Настройки</h2>
      <label class="opts" style="display:block;margin:0"><span class="muted" style="font-size:14px">Китайский голос</span>
        <select id="s-voice" style="width:100%">${zh.length ? `<option value="">Автоматически (${esc(Speech.voiceFor('zh')?.name || '')})</option>${zh.map((v) => `<option value="${esc(v.name)}">${esc(v.name)} · ${esc(v.lang)}</option>`).join('')}` : '<option value="">Китайский голос не найден</option>'}</select></label>
      <div class="row"><button class="btn small" data-text="你好！欢迎学习汉语。">${ICON.speak} Проверить голос</button></div>
      <label style="display:block">Скорость: <b id="s-rate-v"></b><input type="range" id="s-rate" min="0.5" max="1.2" step="0.05" style="width:100%"></label>
      <label style="display:block">Медленно: <b id="s-slow-v"></b><input type="range" id="s-slow" min="0.3" max="0.9" step="0.05" style="width:100%"></label>
      <label class="check"><input type="checkbox" id="s-rec"><span>Записи носителей языка (Wikimedia Commons, Tatoeba), когда они есть. Нужен интернет.</span></label>
      <label class="check"><input type="checkbox" id="s-tones"><span>Раскрашивать тоны в пиньине (1 — красный, 2 — зелёный, 3 — синий, 4 — фиолетовый)</span></label>
      <label style="display:block"><span class="muted" style="font-size:14px">Оформление</span>
        <select id="s-theme" style="width:100%"><option value="">как в системе</option><option value="light">светлое</option><option value="dark">тёмное</option></select></label>
      <div class="row"><button class="btn small" id="s-export">Сохранить прогресс в файл</button><label class="btn small">Загрузить прогресс<input type="file" id="s-import" accept=".json,application/json" hidden></label>
        <button class="btn small bad" id="s-reset">Сбросить прогресс</button></div>
    </div>`);
    $('#s-voice', m).value = settings.voice;
    $('#s-voice', m).onchange = (e) => { settings.voice = e.target.value; saveSettings(); };
    const rng = (id, key) => { const r = $(id, m), v = $(id + '-v', m); r.value = settings[key]; v.textContent = '×' + settings[key]; r.oninput = () => { settings[key] = +r.value; v.textContent = '×' + r.value; saveSettings(); }; };
    rng('#s-rate', 'rate'); rng('#s-slow', 'slowRate');
    $('#s-rec', m).checked = settings.recordings; $('#s-rec', m).onchange = (e) => { settings.recordings = e.target.checked; saveSettings(); };
    $('#s-tones', m).checked = settings.toneColors; $('#s-tones', m).onchange = (e) => { settings.toneColors = e.target.checked; saveSettings(); applyLook(); };
    $('#s-theme', m).value = settings.theme; $('#s-theme', m).onchange = (e) => { settings.theme = e.target.value; saveSettings(); applyLook(); };
    $('#s-export', m).onclick = () => {
      const blob = new Blob([JSON.stringify({ app: 'hsk', known, mistakes, best }, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'hsk-progress.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $('#s-import', m).onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      f.text().then((t) => {
        const d = JSON.parse(t);
        if (d.app !== 'hsk') throw new Error('bad');
        known = Object.assign(known, d.known || {}); mistakes = Object.assign(mistakes, d.mistakes || {}); best = Object.assign(best, d.best || {});
        saveKnown(); saveMistakes(); store.set('best', best);
        toast('Прогресс загружен');
        route();
      }).catch(() => toast('Не удалось прочитать файл'));
    };
    $('#s-reset', m).onclick = () => {
      if (!confirm('Сбросить отметки «выучено», ошибки и рекорды на этом устройстве?')) return;
      known = {}; mistakes = {}; best = {};
      saveKnown(); saveMistakes(); store.set('best', best);
      toast('Прогресс сброшен');
      closeModal();
      route();
    };
  };

  // ---------- printing ----------
  function printNow(html) {
    $('#print').innerHTML = html;
    setTimeout(() => window.print(), 50);
  }
  function printWords(level, list) {
    const n = currentLesson(level);
    const title = `HSK ${level}${n ? ` · урок ${n}` : ''} (${STD_NAME[settings.std]})`;
    const m = openModal(`<div class="pad stack" style="padding:22px"><h2 style="font-size:22px">Печать</h2>
      <p class="muted" style="margin:0">${esc(title)} · ${words_(list.length)}</p>
      <button class="btn" data-p="list">${ICON.print} Список слов с переводом</button>
      <button class="btn" data-p="test">${ICON.print} Контрольная: написать пиньинь и перевод</button>
      <button class="btn" data-p="back">${ICON.print} Контрольная: по переводу написать иероглифы</button>
      <button class="btn" data-p="sheets">${ICON.print} Прописи иероглифов с порядком черт</button></div>`);
    m.onclick = (e) => {
      const b = e.target.closest('[data-p]');
      if (!b) return;
      const kind = b.dataset.p;
      closeModal();
      if (kind === 'sheets') {
        const cs = [];
        list.forEach((x) => [...x.w].forEach((c) => { if (/\p{Script=Han}/u.test(c) && !cs.includes(c)) cs.push(c); }));
        printSheets(cs, `${title} — прописи`);
        return;
      }
      const test = kind !== 'list';
      printNow(`<h1 class="p-h">${esc(title)}${test ? ' — контрольная' : ''}</h1><div class="p-sub">${test ? 'Имя: ____________________  Дата: __________' : words_(list.length)}</div>
        <table class="p-words"><thead><tr><th>№</th><th>Иероглифы</th><th>Пиньинь</th><th>Перевод</th></tr></thead><tbody>${(test ? shuffle(list) : list).map((x, k) =>
          `<tr><td>${k + 1}</td><td class="zh" style="height:${test ? '11mm' : 'auto'}">${kind === 'back' ? '' : esc(x.w)}</td><td>${test ? '' : esc(pyText(x.p))}</td><td>${kind === 'test' ? '' : esc(x.ru)}</td></tr>`).join('')}</tbody></table>`);
    };
  }
  const cellGrid = '<svg viewBox="0 0 100 100"><g stroke="#e3aaa4" stroke-width="1" stroke-dasharray="3 3" fill="none"><path d="M0 0L100 100M100 0L0 100M50 0V100M0 50H100"/></g></svg>';
  const strokeSvg = (d, upto, color) => `<svg viewBox="0 0 1024 1024"><g transform="translate(0, 900) scale(1, -1)">${d.strokes.map((s, k) =>
    `<path d="${s}" fill="${k < upto ? (k === upto - 1 && color === 'step' ? '#b3261e' : color === 'step' ? '#222' : color) : 'none'}"/>`).join('')}</g></svg>`;
  async function printSheets(chars, title) {
    if (!chars.length) return;
    toast('Готовлю прописи…');
    await Promise.all(chars.map((c) => strokeData(c).catch(() => null)));
    const rows = chars.map((c) => {
      const d = STROKES[c];
      const reading = charReading(c);
      const w = BY_WORD.get(c);
      const head = `<div class="p-char-h"><b style="font-size:14px">${esc(c)}</b> ${esc(reading)} ${w ? '— ' + esc(w.ru.split(';')[0]) : ''} ${d ? `· ${d.strokes.length} черт` : ''}</div>`;
      if (!d) return head + `<div class="p-row">${Array.from({ length: 12 }, (_, k) => `<div class="p-cell ${k === 0 ? 'model' : k < 4 ? 'trace' : ''}">${cellGrid}${k < 4 ? `<span>${esc(c)}</span>` : ''}</div>`).join('')}</div>`;
      const n = d.strokes.length;
      const steps = Array.from({ length: Math.min(n, 12) }, (_, k) => `<div class="p-cell">${cellGrid}${strokeSvg(d, n <= 12 ? k + 1 : Math.round((k + 1) * n / 12), 'step')}</div>`).join('');
      const practice = Array.from({ length: 12 }, (_, k) => `<div class="p-cell">${cellGrid}${k === 0 ? strokeSvg(d, n, '#111') : k < 5 ? strokeSvg(d, n, '#d4d4d4') : ''}</div>`).join('');
      return `${head}<div class="p-row">${steps}</div><div class="p-row">${practice}</div>`;
    });
    printNow(`<h1 class="p-h">${esc(title)}</h1><div class="p-sub">Первая строка — порядок черт, вторая — обведите серые и пишите сами.</div>${rows.join('')}`);
  }

  // ---------- router ----------
  function route() {
    leave();
    window.scrollTo(0, 0);
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    if (!WORDS.length) { app.innerHTML = '<div class="card empty">Не удалось загрузить data/words.js</div>'; return; }
    if (parts[0] === 'level') viewLevel(+parts[1], parts[2] || 'words');
    else if (parts[0] === 'pinyin') viewPinyin();
    else if (parts[0] === 'about') viewAbout();
    else viewHome();
  }
  window.addEventListener('hashchange', route);
  $('#foot').innerHTML = 'Слова: complete-hsk-vocabulary (MIT) · Порядок черт: Make Me a Hanzi (Arphic PL), Hanzi Writer · Предложения: Tatoeba (CC BY 2.0 FR) · Записи: Wikimedia Commons (CC BY-SA) · <a href="#/about">подробнее</a>';
  paintStd();
  applyLook();
  route();
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
