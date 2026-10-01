#!/usr/bin/env python3
"""Pack the stroke-order data of every character in the HSK word list for offline use.

    python3 hsk/tools/build_strokes.py                    # runs `npm pack hanzi-writer-data@2.0.1` itself
    python3 hsk/tools/build_strokes.py --data path/to/hanzi-writer-data

The data comes from hanzi-writer-data (derived from Make Me a Hanzi, Arphic Public License; the licence
text is copied to hsk/data/strokes/ARPHICPL.TXT). The shards are plain scripts so the app also works when
index.html is opened straight from disk:
    hsk/data/strokes/<n>.js   HSK_STROKES({"我": {strokes, medians, radStrokes}, ...})
with n = code point % SHARDS (the app computes the same number).
"""
import argparse, glob, json, os, re, shutil, subprocess, sys, tarfile, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'data', 'strokes')
SHARDS = 96


def words():
    src = open(os.path.join(HERE, '..', 'data', 'words.js'), encoding='utf-8').read()
    return json.loads(src[src.index('= [') + 2:src.rindex(']') + 1])


def fetch(tmp):
    subprocess.run(['npm', 'pack', 'hanzi-writer-data@2.0.1', '--silent'], cwd=tmp, check=True)
    with tarfile.open(glob.glob(os.path.join(tmp, '*.tgz'))[0]) as t:
        t.extractall(tmp)
    return os.path.join(tmp, 'package')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', help='unpacked hanzi-writer-data package')
    args = ap.parse_args()
    tmp = tempfile.mkdtemp()
    data = args.data or fetch(tmp)
    chars = sorted({c for w in words() for c in w[0] if '㐀' <= c <= '鿿'})
    shards, missing = [dict() for _ in range(SHARDS)], []
    for c in chars:
        path = os.path.join(data, c + '.json')
        if not os.path.exists(path):
            missing.append(c)
            continue
        d = json.load(open(path, encoding='utf-8'))
        # Round the medians and drop spaces in the outlines: a third smaller, same drawing.
        d = {'strokes': [re.sub(r' ?([A-Z]) ', r'\1', s) for s in d['strokes']],
             'medians': d['medians'], 'radStrokes': d.get('radStrokes', [])}
        shards[ord(c) % SHARDS][c] = d
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    total = 0
    for n, shard in enumerate(shards):
        path = os.path.join(OUT, f'{n}.js')
        with open(path, 'w', encoding='utf-8') as f:
            f.write('HSK_STROKES(' + json.dumps(shard, ensure_ascii=False, separators=(',', ':')) + ');\n')
        total += os.path.getsize(path)
    shutil.copy(os.path.join(data, 'ARPHICPL.TXT'), os.path.join(OUT, 'ARPHICPL.TXT'))
    print(f'  {len(chars) - len(missing)} characters, {SHARDS} shards, {total // 1024} KB; missing: {"".join(missing)}',
          file=sys.stderr)
    shutil.rmtree(tmp)


if __name__ == '__main__':
    main()
