#!/usr/bin/env python3
"""Add graded example sentences (Tatoeba) and native-speaker word recordings (Wiktionary) to the HSK app.

Runs in GitHub Actions (.github/workflows/build-hsk.yml), which has open network access:

    pip install pypinyin
    python3 hsk/tools/build_extras.py --tatoeba /tmp/tatoeba --kaikki /tmp/zh.jsonl

    /tmp/tatoeba must hold sentences.csv, links.csv and sentences_with_audio.csv
    (https://downloads.tatoeba.org/exports/). /tmp/zh.jsonl is the Chinese extract of English Wiktionary
    (https://kaikki.org/dictionary/Chinese/). Either input may be left out.

Output
    hsk/data/sentences.js  window.HSK_SENTENCES = [[tatoeba id, chinese, pinyin, russian, HSK 2.0 level,
                           HSK 3.0 level, audio (1 if Tatoeba has a freely licensed recording)], ...]
                           window.HSK_EXAMPLES = {word: [sentence index, ...]}
    hsk/data/audio.js      window.HSK_AUDIO = {word: [Commons file name, path under upload.wikimedia.org/wikipedia/commons/]}

A sentence gets the level of its hardest word; sentences with words outside HSK 1-6 are left out.
Tatoeba sentences: CC BY 2.0 FR. Wiktionary / Wikimedia Commons recordings: CC BY-SA (authors are named on
each file's page, which the app links to).
"""
import argparse, collections, csv, json, os, re, sys, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, '..', 'data')
COMMONS = 'https://upload.wikimedia.org/wikipedia/commons/'
CJK = re.compile(r'[㐀-鿿]')
NAMES = {'汤姆': 'Tom', '玛丽': 'Mary', '约翰': 'John', '杰克': 'Jack', '比尔': 'Bill', '吉姆': 'Jim', '迈克': 'Mike'}
PER_LEVEL = 700          # sentences kept per level and standard for listening practice
PER_WORD = 3             # example sentences per word
FREE_AUDIO = ('CC BY', 'CC BY-SA', 'CC BY 4.0', 'CC BY-SA 4.0', 'CC0', 'CC BY 2.0 FR', 'Public domain')
csv.field_size_limit(10 ** 8)


def load_words():
    src = open(os.path.join(DATA, 'words.js'), encoding='utf-8').read()
    return json.loads(src[src.index('= [') + 2:src.rindex(']') + 1])


def rows(path):
    with open(path, encoding='utf-8', newline='') as f:
        for r in csv.reader(f, delimiter='\t', quoting=csv.QUOTE_NONE):
            yield r


# ---------- Tatoeba ----------
def segment(text, vocab, longest):
    """Forward maximum matching over the HSK vocabulary; None if a CJK character is not covered."""
    out, i = [], 0
    while i < len(text):
        c = text[i]
        if not CJK.match(c):
            if c.isalnum():
                return None                     # Latin letters: English names, abbreviations
            out.append(c)
            i += 1
            continue
        for n in range(min(longest, len(text) - i), 0, -1):
            piece = text[i:i + n]
            if piece in vocab or piece in NAMES:
                out.append(piece)
                i += n
                break
        else:
            return None
    return out


def to_pinyin(tokens, vocab):
    """Word-by-word pinyin; HSK words keep the reading of the word list (neutral tones included)."""
    from pypinyin import pinyin, Style
    parts = []
    for t in tokens:
        if t in vocab:
            parts.append(vocab[t][1].split(' / ')[0].replace(' ', ''))
        elif CJK.match(t):
            parts.append(''.join(s[0] for s in pinyin(t, style=Style.TONE)))
        elif parts and t in '，。！？、；：,.!?;:':
            parts[-1] += {'，': ',', '。': '.', '！': '!', '？': '?', '、': ',', '；': ';', '：': ':'}.get(t, t)
        elif t.strip():
            parts.append(t)
    s = ' '.join(parts)
    return s[:1].upper() + s[1:]


def build_sentences(tatoeba, words):
    vocab = {w[0]: w for w in words}
    longest = max(len(w) for w in vocab)
    langs, cmn = {}, {}
    print('  reading sentences.csv', file=sys.stderr)
    for r in rows(os.path.join(tatoeba, 'sentences.csv')):
        if len(r) < 3:
            continue
        if r[1] == 'cmn':
            text = unicodedata.normalize('NFC', r[2]).strip()
            if 3 <= len(text) <= 32:
                cmn[int(r[0])] = text
        elif r[1] in ('rus', 'eng'):
            langs[int(r[0])] = (r[1], r[2].strip())
    print(f'  Mandarin sentences: {len(cmn)}', file=sys.stderr)

    graded = {}
    for sid, text in cmn.items():
        tokens = segment(text, vocab, longest)
        if not tokens:
            continue
        cjk = [t for t in tokens if CJK.match(t) and t not in NAMES]
        if not cjk:
            continue
        old = max((vocab[t][3] or 7) for t in cjk)
        new = max((vocab[t][4] or 7) for t in cjk)
        if min(old, new) > 6:
            continue
        graded[sid] = (text, tokens, old if old <= 6 else 0, new if new <= 6 else 0)
    print(f'  simplified sentences within HSK 1-6: {len(graded)}', file=sys.stderr)

    print('  reading links.csv', file=sys.stderr)
    direct, via_eng, eng_of = {}, collections.defaultdict(list), collections.defaultdict(list)
    for r in rows(os.path.join(tatoeba, 'links.csv')):
        if len(r) < 2:
            continue
        a, b = int(r[0]), int(r[1])
        if a in graded and b in langs:
            lang, text = langs[b]
            if lang == 'rus':
                if a not in direct or len(text) < len(direct[a]):
                    direct[a] = text
            else:
                eng_of[b].append(a)
        elif a in langs and b in langs and langs[a][0] == 'eng' and langs[b][0] == 'rus':
            via_eng[a].append(langs[b][1])
    ru = dict(direct)
    for e, sids in eng_of.items():
        for sid in sids:
            if sid not in ru and via_eng.get(e):
                ru[sid] = min(via_eng[e], key=len)
    print(f'  with a Russian translation: {len(ru)} ({len(direct)} direct)', file=sys.stderr)

    audio = set()
    path = os.path.join(tatoeba, 'sentences_with_audio.csv')
    if os.path.exists(path):
        licences = collections.Counter()
        for r in rows(path):
            if len(r) >= 4 and r[0].isdigit() and int(r[0]) in ru:
                licences[r[3]] += 1
                if r[3].strip() in FREE_AUDIO:
                    audio.add(int(r[0]))
        print(f'  recordings: {sum(licences.values())} {dict(licences)}; freely licensed: {len(audio)}', file=sys.stderr)

    pool = sorted(ru, key=lambda s: (len(graded[s][0]), s))
    keep, per_level = set(), collections.Counter()
    for sid in pool:
        text, tokens, old, new = graded[sid]
        for std, lv in (('o', old), ('n', new)):
            if lv and per_level[(std, lv)] < PER_LEVEL:
                per_level[(std, lv)] += 1
                keep.add(sid)
    examples = collections.defaultdict(list)
    for sid in pool:
        text, tokens, old, new = graded[sid]
        for t in set(tokens):
            w = vocab.get(t)
            if not w or len(examples[t]) >= PER_WORD:
                continue
            fits = (w[3] and old and old <= max(w[3], 2)) or (w[4] and new and new <= max(w[4], 2))
            if fits or len(examples[t]) < 1:
                examples[t].append(sid)
                keep.add(sid)
    order = sorted(keep, key=lambda s: (min(x for x in graded[s][2:4] if x), len(graded[s][0]), s))
    index = {sid: n for n, sid in enumerate(order)}
    out = []
    for sid in order:
        text, tokens, old, new = graded[sid]
        out.append([sid, text, to_pinyin(tokens, vocab), ru[sid], old, new, 1 if sid in audio else 0])
    ex = {w: [index[s] for s in sids] for w, sids in examples.items()}
    covered = sum(1 for w in words if w[0] in ex)
    print(f'  kept {len(out)} sentences; per level {dict(sorted(per_level.items()))}; '
          f'words with examples {covered}/{len(words)}', file=sys.stderr)
    return out, ex


# ---------- Wiktionary recordings ----------
def build_audio(kaikki, words):
    wanted = {w[0] for w in words}
    found, seen, samples = {}, 0, []
    with open(kaikki, encoding='utf-8') as f:
        for line in f:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            w = e.get('word')
            if w not in wanted or w in found:
                continue
            seen += 1
            for s in e.get('sounds') or []:
                name = s.get('audio') or ''
                if not name or not (s.get('mp3_url') or s.get('ogg_url')):
                    continue
                tags = ' '.join((s.get('tags') or []) + (s.get('raw_tags') or [])).lower()
                low = name.lower()
                mandarin = ('mandarin' in tags or '(cmn)' in low or low.startswith('cmn-') or low.startswith('zh-')
                            or 'standard chinese' in tags)
                other = any(x in tags for x in ('cantonese', 'hokkien', 'min nan', 'hakka', 'wu', 'taiwan'))
                if mandarin and not other:
                    url = s.get('mp3_url') or s.get('ogg_url')
                    found[w] = [name, url.replace(COMMONS, '')]
                    if len(samples) < 8:
                        samples.append((w, name, s.get('mp3_url') or s.get('ogg_url'), tags))
                    break
    print(f'  Wiktionary entries for HSK words: {seen}; with a Mandarin recording: {len(found)}', file=sys.stderr)
    for s in samples:
        print('   ', *s, file=sys.stderr)
    return found


def write_js(path, header, **values):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(f'// {header}\n')
        for name, value in values.items():
            body = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
            if body.startswith('[['):
                body = body.replace('],[', '],\n[')
            f.write(f'window.{name} = {body};\n')
    print(f'  {path}: {os.path.getsize(path) // 1024} KB', file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tatoeba', help='directory with the unpacked Tatoeba exports')
    ap.add_argument('--kaikki', help='Chinese JSONL extract of English Wiktionary from kaikki.org')
    args = ap.parse_args()
    words = load_words()
    if args.tatoeba:
        sentences, examples = build_sentences(args.tatoeba, words)
        write_js(os.path.join(DATA, 'sentences.js'),
                 'Generated by hsk/tools/build_extras.py from Tatoeba (tatoeba.org, CC BY 2.0 FR). '
                 '[tatoeba id, chinese, pinyin, russian, HSK 2.0 level, HSK 3.0 level, has recording]',
                 HSK_SENTENCES=sentences, HSK_EXAMPLES=examples)
    if args.kaikki:
        audio = build_audio(args.kaikki, words)
        write_js(os.path.join(DATA, 'audio.js'),
                 'Generated by hsk/tools/build_extras.py from English Wiktionary via kaikki.org. '
                 'Word -> [Wikimedia Commons file, path of its MP3/OGG under upload.wikimedia.org/wikipedia/commons/] '
                 '(CC BY-SA, author on the file page).',
                 HSK_AUDIO=audio)


if __name__ == '__main__':
    main()
