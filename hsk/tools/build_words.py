#!/usr/bin/env python3
"""Build the HSK word list and the pinyin syllable table for the HSK app (hsk/).

    pip install pypinyin
    python3 hsk/tools/build_words.py                  # downloads the word lists from GitHub
    python3 hsk/tools/build_words.py --complete complete.json --clem hsk-vocab-json/

Sources
    complete-hsk-vocabulary (MIT, © Yanis Zafirópulos): levels of HSK 2.0 ("old-N") and of the
        HSK 3.0 syllabus of 2026 ("newest-N"), traditional forms, parts of speech, measure words, frequency.
    hsk-vocabulary (MIT, © Clement Venard): the reading used in the official HSK 2.0 lists.
    hsk/tools/ru/*.txt: Russian glosses, one line per word: word|gloss[|pinyin override].

Output
    hsk/data/words.js       window.HSK_WORDS = [[word, pinyin, ru, old, new, pos, measure, trad, freq], ...]
    hsk/data/syllables.js   window.HSK_SYLLABLES = [[syllable, initial, [char tone1, tone2, tone3, tone4]], ...]
"""
import argparse, collections, glob, json, os, re, sys, unicodedata, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'data')
COMPLETE = 'https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/7ac65bf1a6387d35f1ade478906172a19311c7f9/complete.json'
CLEM = 'https://raw.githubusercontent.com/clem109/hsk-vocabulary/f3dc9d12ae00d04fa3676b0bd4c43cd58de2c264/hsk-vocab-json/hsk-level-{}.json'
BAD_MEANING = re.compile(r'(old |archaic )?variant of|used in|see |also pr|surname|abbr', re.I)


def load_json(src):
    if re.match(r'https?://', src):
        print('  downloading', src, file=sys.stderr)
        with urllib.request.urlopen(src, timeout=120) as r:
            return json.loads(r.read().decode('utf-8'))
    with open(src, encoding='utf-8') as f:
        return json.load(f)


def score(form):
    ms = form['meanings']
    return len(ms) - 2 * sum(1 for m in ms if BAD_MEANING.match(m))


def squash(p):
    return p.replace(' ', '').lower()


def load_ru():
    ru = {}
    for path in sorted(glob.glob(os.path.join(HERE, 'ru', '*.txt'))):
        for n, line in enumerate(open(path, encoding='utf-8'), 1):
            line = line.rstrip('\n')
            if not line:
                continue
            parts = line.split('|')
            if len(parts) not in (2, 3) or not parts[1].strip():
                sys.exit(f'{path}:{n}: expected word|gloss[|pinyin]')
            ru[parts[0]] = (parts[1].strip(), parts[2].strip() if len(parts) == 3 else '')
    return ru


def build_words(complete, clem_dir):
    data = load_json(complete)
    clem = {}
    for i in range(1, 7):
        src = os.path.join(clem_dir, f'hsk-level-{i}.json') if clem_dir else CLEM.format(i)
        for e in load_json(src):
            clem.setdefault(e['hanzi'], e['pinyin'])
    ru = load_ru()

    rows = []
    for e in data:
        lv = e['level']
        old = min([int(l[4:]) for l in lv if l.startswith('old-')] or [0])
        new = min([int(l[7:]) for l in lv if l.startswith('newest-')] or [0])
        new = 0 if new > 6 else new
        if not old and not new:
            continue
        w = e['simplified']
        if w not in ru:
            sys.exit(f'no Russian gloss for {w}: add it to hsk/tools/ru/')
        forms = e['forms']
        lower = [f for f in forms if f['transcriptions']['pinyin'][:1].islower()] or forms
        main = None
        if w in clem:
            same = [f for f in forms if squash(f['transcriptions']['pinyin']) == squash(clem[w])]
            main = max(same, key=score) if same else None
        main = main or max(lower, key=score)
        gloss, override = ru[w]
        pinyin = override or clem.get(w) or main['transcriptions']['pinyin']
        trad = main.get('traditional') or ''
        rows.append([
            w, normalize_pinyin(pinyin), gloss, old, new,
            ','.join((e.get('pos') or [])[:3]),
            ','.join(main.get('classifiers') or [])[:8],
            trad if trad != w else '',
            e.get('frequency') or 99999,
        ])
    rows.sort(key=lambda r: (min(x for x in (r[3], r[4]) if x), r[8], r[0]))
    missing = set(ru) - {r[0] for r in rows}
    if missing:
        print('  glosses without a word:', sorted(missing)[:20], file=sys.stderr)
    return rows


def normalize_pinyin(p):
    p = unicodedata.normalize('NFC', p.strip()).replace('ɡ', 'g')
    p = re.sub(r'\s+', ' ', p)
    return p


# ---------- syllables ----------
TONE_MARKS = {'ā': 1, 'á': 2, 'ǎ': 3, 'à': 4, 'ē': 1, 'é': 2, 'ě': 3, 'è': 4, 'ī': 1, 'í': 2, 'ǐ': 3, 'ì': 4,
              'ō': 1, 'ó': 2, 'ǒ': 3, 'ò': 4, 'ū': 1, 'ú': 2, 'ǔ': 3, 'ù': 4, 'ǖ': 1, 'ǘ': 2, 'ǚ': 3, 'ǜ': 4}
INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w']
FINALS = ['a', 'o', 'e', 'i', 'u', 'ü', 'ai', 'ei', 'ao', 'ou', 'an', 'en', 'ang', 'eng', 'ong', 'er',
          'ia', 'ie', 'iao', 'iu', 'ian', 'in', 'iang', 'ing', 'iong',
          'ua', 'uo', 'uai', 'ui', 'uan', 'un', 'uang', 'ueng', 'üe', 'üan', 'ün', 'ue', 'uan', 'un']


def split_syllable(s):
    for ini in INITIALS:
        if s.startswith(ini) and s[len(ini):] in FINALS:
            return ini, s[len(ini):]
    if s in FINALS:
        return '', s
    return None


def build_syllables(words):
    from pypinyin import pinyin, Style
    hsk_chars = {}
    for w in words:
        for c in w[0]:
            hsk_chars[c] = min(hsk_chars.get(c, 99999), w[8])
    single = {w[0]: w for w in words if len(w[0]) == 1}
    cands = collections.defaultdict(list)          # (syllable, tone) -> [(score, char)]
    pool = set(hsk_chars)
    for code in range(0x4E00, 0x9FA6):             # GB2312 level-1 characters (the 3755 most common)
        c = chr(code)
        try:
            b = c.encode('gb2312')
        except UnicodeEncodeError:
            continue
        if 0xB0 <= b[0] <= 0xD7:
            pool.add(c)
    for c in pool:
        # Only the main reading counts: a speech engine reads a lone character that way.
        main = pinyin(c, style=Style.TONE3, heteronym=False, neutral_tone_with_five=True)[0][0].replace('v', 'ü')
        readings = pinyin(c, style=Style.TONE3, heteronym=True, neutral_tone_with_five=True)[0]
        if main[-1:] not in '1234':
            continue
        syl, tone = main[:-1], int(main[-1])
        if not split_syllable(syl):
            continue
        s = 0 if c in hsk_chars else 100000
        s += hsk_chars.get(c, 50000)
        if len(readings) > 1:
            s += 200000                             # polyphones are risky even when the main reading fits
        cands[(syl, tone)].append((s, c))
    table = {}
    for (syl, tone), lst in cands.items():
        table.setdefault(syl, ['', '', '', ''])[tone - 1] = min(lst)[1]
    out = []
    for syl in sorted(table, key=lambda s: (INITIALS.index(split_syllable(s)[0]) if split_syllable(s)[0] else -1,
                                            FINALS.index(split_syllable(s)[1]), s)):
        ini, fin = split_syllable(syl)
        out.append([syl, ini, table[syl]])
    return out


def write_js(path, name, value, header):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    body = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    body = body.replace('],[', '],\n[') if body.startswith('[[') else body
    with open(path, 'w', encoding='utf-8') as f:
        f.write(f'// {header}\nwindow.{name} = {body};\n')
    print(f'  {path}: {os.path.getsize(path) // 1024} KB', file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--complete', default=COMPLETE, help='complete.json of complete-hsk-vocabulary')
    ap.add_argument('--clem', default='', help='hsk-vocab-json directory of hsk-vocabulary')
    args = ap.parse_args()
    words = build_words(args.complete, args.clem)
    old = collections.Counter(w[3] for w in words if w[3])
    new = collections.Counter(w[4] for w in words if w[4])
    print('  words:', len(words), 'HSK 2.0:', sorted(old.items()), 'HSK 3.0:', sorted(new.items()), file=sys.stderr)
    write_js(os.path.join(OUT, 'words.js'), 'HSK_WORDS', words,
             'Generated by hsk/tools/build_words.py. [word, pinyin, ru, HSK 2.0 level, HSK 3.0 (2026) level, '
             'part of speech, measure word, traditional, frequency rank]. Word lists: complete-hsk-vocabulary (MIT), '
             'hsk-vocabulary (MIT).')
    syl = build_syllables(words)
    print('  syllables:', len(syl), 'with all four tones:', sum(1 for s in syl if all(s[2])), file=sys.stderr)
    write_js(os.path.join(OUT, 'syllables.js'), 'HSK_SYLLABLES', syl,
             'Generated by hsk/tools/build_words.py. [syllable, initial, [example character for tones 1-4]].')


if __name__ == '__main__':
    main()
