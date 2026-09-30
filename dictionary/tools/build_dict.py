#!/usr/bin/env python3
"""Build the offline dictionary for Лексикон from Wiktionary extracts (kaikki.org / wiktextract).

    pip install wordfreq
    python3 tools/build_dict.py            # downloads the extracts from kaikki.org
    python3 tools/build_dict.py --en English.jsonl --ru Russian.jsonl   # or use local copies

Output (dictionary/data/):
    meta.json                       version, counts, shard list with sizes
    <ver>/en-words.txt.gz           every English headword, sorted by lookup key (autocomplete)
    <ver>/ru-words.txt.gz           every Russian headword
    <ver>/en-top.txt.gz             most frequent English words, most frequent first (ranking)
    <ver>/ru-top.txt.gz
    <ver>/en/<shard>.json.gz        {key: [entry, ...]}; shard = first 2 (or 3) chars of the key
    <ver>/ru/<shard>.json.gz

English entry:  {w, p, i:{uk,us,x}, a:{uk,us}, s:[{g, e:[..], sy:[..]}], tr:[{s, w:[[word, tags]]}],
                 tx:[word, ...] (extra Russian translations found in Russian entries), sy, an, f}
Russian entry:  {w, p, s:[{g, e:[[ru, en], ..]}], f}
Wiktionary content is CC BY-SA 4.0: keep the attribution in the app footer.
"""
import argparse, collections, datetime, gzip, io, json, os, re, shutil, sys, tempfile, unicodedata, urllib.request

KAIKKI = 'https://kaikki.org/dictionary/{0}/kaikki.org-dictionary-{0}.jsonl'
SKIP_POS = {'name', 'character', 'punct', 'romanization', 'symbol'}
SPLIT_BYTES = 450_000          # split a 2-char shard into 3-char shards above this raw size
MAX_SENSES, MAX_EX, MAX_EX_LEN = 24, 2, 260
TR_TAGS = {'masculine': 'm', 'feminine': 'f', 'neuter': 'n', 'imperfective': 'impf', 'perfective': 'pf',
           'plural': 'p', 'animate': 'an', 'colloquial': 'colloq', 'formal': 'formal', 'informal': 'informal'}


# ---------- keys & shards (the app mirrors these in app.js) ----------
def key_of(word):
    s = unicodedata.normalize('NFD', word.lower().replace('ё', 'е').replace('Ё', 'е'))
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return unicodedata.normalize('NFC', s).strip()


def safe(prefix, n):
    out = ''
    for c in prefix.ljust(n, '_')[:n]:
        out += c if re.match(r'[a-z0-9а-я]', c) else '_'
    return out


# ---------- input ----------
def open_lines(src):
    if re.match(r'https?://', src):
        print('  downloading', src, file=sys.stderr)
        raw = urllib.request.urlopen(src, timeout=120)
    else:
        raw = open(src, 'rb')
    if src.endswith('.gz'):
        raw = gzip.GzipFile(fileobj=raw)
    return io.TextIOWrapper(raw, encoding='utf-8')


def entries(src, lang_code):
    n = 0
    for line in open_lines(src):
        if not line.strip():
            continue
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e.get('lang_code', lang_code) != lang_code or not e.get('word'):
            continue
        n += 1
        if n % 100_000 == 0:
            print(f'  {lang_code}: {n:,} entries', file=sys.stderr)
        yield e


# ---------- helpers ----------
def gloss_of(sense):
    g = (sense.get('raw_glosses') or sense.get('glosses') or [''])[-1]
    return re.sub(r'\s+', ' ', g).strip()


def form_of(sense):
    for k in ('form_of', 'alt_of'):
        for x in sense.get(k) or []:
            if x.get('word'):
                return x['word']
    return None


# "simple past of go", "plural of service", "genitive singular of ко́шка" — also when the sense lacks form_of data.
FORM_RE = re.compile(
    r"^(?:[^.]*\b(?:plural|singular|past|participle|present|gerund|comparative|superlative|third-person|first-person|"
    r"second-person|indicative|subjunctive|imperative|inflection|genitive|dative|accusative|instrumental|prepositional|"
    r"nominative|locative|vocative|short|alternative (?:form|spelling)|obsolete (?:form|spelling)|archaic (?:form|spelling)|"
    r"misspelling|eye dialect spelling|pronunciation spelling)\b[^.]*?) of ([^\s(,.;:]+(?: [^\s(,.;:]+){0,2})\s*\.?$", re.I)


def form_target(sense):
    t = form_of(sense)
    if t:
        return t
    m = FORM_RE.match((sense.get('glosses') or [''])[-1].strip())
    return m.group(1) if m else None


def is_form_entry(e):
    senses = e.get('senses') or []
    return bool(senses) and all(form_target(s) or 'form-of' in (s.get('tags') or []) for s in senses)


def examples_en(sense):
    ex = [x for x in sense.get('examples') or [] if x.get('text')]
    plain = [x['text'] for x in ex if x.get('type', 'example') == 'example']
    quotes = [x['text'] for x in ex if x.get('type') in ('quote', 'quotation')]
    out = plain or [q for q in quotes if len(q) <= 160]
    return [re.sub(r'\s+', ' ', t).strip() for t in out if len(t) <= MAX_EX_LEN][:MAX_EX]


def examples_ru(sense):
    out = []
    for x in sense.get('examples') or []:
        t = x.get('text')
        if not t or len(t) > MAX_EX_LEN:
            continue
        out.append([t.strip(), (x.get('english') or x.get('translation') or '').strip()])
    return out[:MAX_EX]


def ipa_of(e):
    res = {}
    for s in e.get('sounds') or []:
        ipa = s.get('ipa')
        if not ipa:
            continue
        tags = set(s.get('tags') or []) | set(s.get('raw_tags') or [])
        if tags & {'UK', 'Received-Pronunciation', 'British', 'RP', 'Standard-Southern-British'}:
            res.setdefault('uk', ipa)
        elif tags & {'US', 'General-American', 'American', 'GA', 'GenAm'}:
            res.setdefault('us', ipa)
        elif not tags:
            res.setdefault('x', ipa)
    return res


def audio_of(e):
    res = {}
    for s in e.get('sounds') or []:
        url = s.get('mp3_url') or s.get('ogg_url')
        if not url:
            continue
        name = (s.get('audio') or url.rsplit('/', 1)[-1]).lower()
        tags = set(s.get('tags') or [])
        region = 'uk' if ('UK' in tags or re.search(r'en-(uk|gb)', name)) else 'us' if ('US' in tags or 'en-us' in name) else None
        if region and region not in res:
            res[region] = url.replace('https://upload.wikimedia.org/wikipedia/commons/', '~')
    return res


def nyms(lst, n):
    out = []
    for x in lst or []:
        w = x.get('word')
        if w and w not in out:
            out.append(w)
    return out[:n]


def canonical_ru(e):
    for f in e.get('forms') or []:
        if 'canonical' in (f.get('tags') or []) and f.get('form'):
            return f['form']
    return e['word']


# ---------- Russian pass: RU→EN entries + inverted EN→RU candidates ----------
INV_SPLIT = re.compile(r'[;,]')
def inverted_targets(gloss, pos):
    g = re.sub(r'\([^)]*\)', '', gloss)
    for piece in INV_SPLIT.split(g):
        p = piece.strip().strip('.').strip()
        p = re.sub(r'^(to|a|an|the)\s+', '', p, flags=re.I) if pos == 'verb' or re.match(r'^(a|an|the)\s', p, re.I) else p
        if p and len(p.split()) <= 3 and re.fullmatch(r"[A-Za-z][A-Za-z' -]*", p):
            yield key_of(p)


def build_russian(src, tmp, freq_ru):
    inv = collections.defaultdict(dict)   # en key -> {(ru word, pos): score}
    words, n = set(), 0
    with ShardWriter(os.path.join(tmp, 'ru')) as out:
        for e in entries(src, 'ru'):
            if e.get('pos') in SKIP_POS:
                continue
            w = canonical_ru(e)
            senses = e.get('senses') or []
            if is_form_entry(e):
                tgt = form_target(senses[0]) or ''
                out.add(key_of(e['word']), {'w': w, 'p': e.get('pos'), 'f': tgt, 'g': gloss_of(senses[0])[:120]})
                words.add(e['word'])
                continue
            ss = []
            for s in senses[:MAX_SENSES]:
                g = gloss_of(s)
                if not g or 'form-of' in (s.get('tags') or []) or form_target(s):
                    continue
                item = {'g': g}
                ex = examples_ru(s)
                if ex:
                    item['e'] = ex
                ss.append(item)
                score = freq_ru.get(key_of(e['word']), 0)
                for t in inverted_targets((s.get('glosses') or [g])[-1], e.get('pos')):
                    inv[t][(w, e.get('pos'))] = max(inv[t].get((w, e.get('pos')), 0), score)
            if not ss:
                continue
            out.add(key_of(e['word']), {'w': w, 'p': e.get('pos'), 's': ss})
            words.add(e['word'])
            n += 1
    print(f'  ru: {n:,} lemmas, {len(words):,} headwords, {len(inv):,} inverted English targets', file=sys.stderr)
    return words, inv


# ---------- English pass ----------
PARTICLES = {'up', 'out', 'off', 'in', 'on', 'away', 'down', 'over', 'back', 'through', 'around', 'round', 'about',
             'into', 'along', 'across', 'by', 'for', 'with', 'after', 'forward', 'to', 'at', 'apart', 'aside', 'ahead',
             'behind', 'onto', 'upon', 'without', 'against', 'from', 'of', 'together', 'under', 'it', 'oneself'}
PHRASE_STOP = {'a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'and', 'or', 'for', 'with', 'by', 'as', 'is', 'be', 'it',
               "one's", 'one', 'oneself', 'someone', "someone's", 'something', 'somebody', 'sb', 'sth', 'not', 'no', 'your',
               'my', 'his', 'her', 'their', 'its', 'our', 'from', 'up', 'out', 'off', 'into', 'over', 'down', 'all', 'that'}


def phrase_refs(word, pos, gloss, has_tr, phrases):
    toks = [t for t in re.split(r"[ ]+", key_of(word)) if t]
    if len(toks) < 2:
        return
    kind = 'pv' if pos == 'verb' and all(t in PARTICLES for t in toks[1:]) else 'id'
    g = re.sub(r'^(\([^)]*\)\s*)+', '', gloss)[:90]
    for t in set(toks):
        t = t.strip("'.,!?")
        if t and t not in PHRASE_STOP and (kind == 'id' or t == toks[0]):
            phrases[t].append((kind, word, g, has_tr))


def build_english(src, tmp, inv, phrases):
    words, n = set(), 0
    with ShardWriter(os.path.join(tmp, 'en')) as out:
        for e in entries(src, 'en'):
            if e.get('pos') in SKIP_POS:
                continue
            senses = e.get('senses') or []
            k = key_of(e['word'])
            if not k:
                continue
            if is_form_entry(e):
                out.add(k, {'w': e['word'], 'p': e.get('pos'), 'f': form_target(senses[0]) or '', 'g': gloss_of(senses[0])[:140]})
                words.add(e['word'])
                continue
            live = [s for s in senses if 'obsolete' not in (s.get('tags') or [])] or senses
            ss, fo = [], []
            for s in live[:MAX_SENSES]:
                g = gloss_of(s)
                if not g:
                    continue
                t = form_target(s)
                if t:   # "was": first-person singular simple past of be
                    if key_of(t) != k and all(key_of(x['f']) != key_of(t) for x in fo) and len(fo) < 3:
                        fo.append({'g': g[:140], 'f': t})
                    continue
                item = {'g': g}
                ex = examples_en(s)
                if ex:
                    item['e'] = ex
                sy = nyms(s.get('synonyms'), 6)
                if sy:
                    item['sy'] = sy
                ss.append(item)
            if not ss:
                if fo:
                    out.add(k, {'w': e['word'], 'p': e.get('pos'), 'f': fo[0]['f'], 'g': fo[0]['g']})
                    words.add(e['word'])
                continue
            ent = {'w': e['word'], 'p': e.get('pos'), 's': ss}
            if fo:
                ent['fo'] = fo
            ipa = ipa_of(e)
            if ipa:
                ent['i'] = ipa
            au = audio_of(e)
            if au:
                ent['a'] = au
            # direct translations, grouped by sense
            groups, seen = collections.OrderedDict(), set()
            trs = list(e.get('translations') or [])
            for s in senses:
                trs += [dict(t, sense=t.get('sense') or gloss_of(s)) for t in s.get('translations') or []]
            for t in trs:
                if t.get('code') != 'ru' and t.get('lang') != 'Russian':
                    continue
                word = (t.get('word') or '').strip()
                if not word:
                    continue
                tags = [TR_TAGS[x] for x in t.get('tags') or [] if x in TR_TAGS]
                groups.setdefault((t.get('sense') or '').strip(), []).append([word, tags] if tags else [word])
                seen.add(key_of(word))
            if groups:
                ent['tr'] = [{'s': s, 'w': ws[:16]} for s, ws in groups.items()]
            extra = sorted(((w, sc) for (w, p), sc in inv.get(k, {}).items() if p == e.get('pos')), key=lambda x: -x[1])
            extra = list(dict.fromkeys(w for w, _ in extra if key_of(w) not in seen))[:6 if groups else 12]
            if extra:
                ent['tx'] = extra
            for fld, src_key in (('sy', 'synonyms'), ('an', 'antonyms')):
                v = nyms(e.get(src_key), 12)
                if v:
                    ent[fld] = v
            phrase_refs(e['word'], e.get('pos'), ss[0]['g'], bool(groups), phrases)
            out.add(k, ent)
            words.add(e['word'])
            n += 1
    print(f'  en: {n:,} lemmas, {len(words):,} headwords', file=sys.stderr)
    return words


# ---------- shard writing ----------
class ShardWriter:
    """Appends entries to per-2-char temp files; finish() groups them into gzip shards."""
    def __init__(self, tmpdir):
        self.dir = tmpdir
        os.makedirs(tmpdir, exist_ok=True)
        self.files = {}

    def __enter__(self):
        return self

    def __exit__(self, *a):
        for f in self.files.values():
            f.close()

    def add(self, key, ent):
        p = safe(key, 2)
        f = self.files.get(p)
        if f is None:
            f = self.files[p] = open(os.path.join(self.dir, p + '.jsonl'), 'a', encoding='utf-8')
        f.write(json.dumps([key, ent], ensure_ascii=False, separators=(',', ':')) + '\n')


def attach_phrases(k, ents, phrases):
    refs = phrases.get(k)
    target = next((x for x in ents if 'f' not in x), None)
    if not refs or not target:
        return
    out = {}
    for kind in ('pv', 'id'):
        items = {}
        for kd, w, g, has_tr in refs:
            if kd == kind and key_of(w) != k and w not in items:
                items[w] = (not has_tr, len(w), g)
        best = sorted(items.items(), key=lambda x: x[1][:2])[:40]
        if best:
            out[kind] = [[w, v[2]] for w, v in best]
    if out:
        target['ph'] = out


def file_name(shard):
    """ASCII file name for a shard ("ко_" → "x43a-43e-5f"): archive tools on Windows mangle Cyrillic names."""
    return shard if re.fullmatch(r'[a-z0-9_]+', shard) else 'x' + '-'.join(format(ord(c), 'x') for c in shard)


def finish_shards(tmpdir, outdir, phrases=None):
    os.makedirs(outdir, exist_ok=True)
    shards, split = {}, []
    for fn in sorted(os.listdir(tmpdir)):
        p2 = fn[:-6]
        groups = collections.defaultdict(list)
        with open(os.path.join(tmpdir, fn), encoding='utf-8') as f:
            for line in f:
                k, ent = json.loads(line)
                groups[k].append(ent)
        # Put the most frequent spelling first when several entries share a key (e.g. "Polish" / "polish").
        for k, ents in groups.items():
            ents.sort(key=lambda x: (x['w'] != k, 'f' in x))
            if phrases:
                attach_phrases(k, ents, phrases)
        raw = os.path.getsize(os.path.join(tmpdir, fn))
        if raw > SPLIT_BYTES:
            split.append(p2)
            parts = collections.defaultdict(dict)
            for k, ents in groups.items():
                parts[safe(k, 3)][k] = ents
        else:
            parts = {p2: dict(groups)}
        for name, data in parts.items():
            path = os.path.join(outdir, file_name(name) + '.json.gz')
            with gzip.open(path, 'wt', encoding='utf-8', compresslevel=9) as g:
                json.dump(data, g, ensure_ascii=False, separators=(',', ':'))
            shards[name] = os.path.getsize(path)
    return shards, split


def write_list(path, items):
    with gzip.open(path, 'wt', encoding='utf-8', compresslevel=9) as g:
        g.write('\n'.join(items))
    return os.path.getsize(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--en', default=KAIKKI.format('English'), help='English wiktextract JSONL (path or URL, .gz ok)')
    ap.add_argument('--ru', default=KAIKKI.format('Russian'), help='Russian wiktextract JSONL (path or URL, .gz ok)')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data'))
    ap.add_argument('--version', default=datetime.date.today().strftime('%Y%m%d'))
    args = ap.parse_args()

    try:
        from wordfreq import top_n_list
    except ImportError:
        sys.exit('pip install wordfreq')
    top_en = [w for w in top_n_list('en', 60000) if re.fullmatch(r"[a-z][a-z'-]*", w)]
    top_ru = [w for w in top_n_list('ru', 60000) if re.fullmatch(r'[а-яё-]+', w)]
    freq_ru = {key_of(w): len(top_ru) - i for i, w in enumerate(top_ru)}

    out = os.path.abspath(args.out)
    ver_dir = os.path.join(out, args.version)
    tmp = tempfile.mkdtemp(prefix='lexbuild-')
    try:
        print('Russian pass', file=sys.stderr)
        ru_words, inv = build_russian(args.ru, tmp, freq_ru)
        print('English pass', file=sys.stderr)
        phrases = collections.defaultdict(list)
        en_words = build_english(args.en, tmp, inv, phrases)
        print(f'  phrases indexed under {len(phrases):,} words', file=sys.stderr)
        del inv

        if os.path.isdir(out):
            for d in os.listdir(out):   # keep only the version being built
                if d != args.version and os.path.isdir(os.path.join(out, d)):
                    shutil.rmtree(os.path.join(out, d))
        shutil.rmtree(ver_dir, ignore_errors=True)
        meta = {'version': args.version, 'built': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                'source': 'Wiktionary via kaikki.org (CC BY-SA 4.0)', 'langs': {}}
        for lang, words, top in (('en', en_words, top_en), ('ru', ru_words, top_ru)):
            print(f'Writing {lang} shards', file=sys.stderr)
            shards, split = finish_shards(os.path.join(tmp, lang), os.path.join(ver_dir, lang), phrases if lang == 'en' else None)
            wl = sorted(words, key=lambda w: (key_of(w), w))
            present = {key_of(w) for w in words}
            top_present = [w for w in top if key_of(w) in present][:40000]
            meta['langs'][lang] = {
                'count': len(words),
                'split': sorted(split),
                'shards': shards,
                'words': write_list(os.path.join(ver_dir, f'{lang}-words.txt.gz'), wl),
                'top': write_list(os.path.join(ver_dir, f'{lang}-top.txt.gz'), top_present),
            }
        total = sum(sum(m['shards'].values()) + m['words'] + m['top'] for m in meta['langs'].values())
        meta['bytes'] = total
        with open(os.path.join(out, 'meta.json'), 'w', encoding='utf-8') as f:
            json.dump(meta, f, ensure_ascii=False, separators=(',', ':'))
        print(f'Done: {len(en_words):,} English and {len(ru_words):,} Russian headwords, {total / 1e6:.1f} MB', file=sys.stderr)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    main()
