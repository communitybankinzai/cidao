"""parsed.json（座標で読み取った時刻表）を、別の取り出し方（pdftotext -layout の文字の並び）と全数比べる。

1. 時刻の数：PDF に出てくる時刻（h:mm）の個数と、parsed.json の時刻の個数が、時刻ごとに一致するか
2. 行の並び：バス停ごとに「その行に左から並ぶ時刻」が、PDF の同じ行の時刻の並びと一致するか
   （左右に2つの表がある PDF は、1行に両方の表の時刻が並ぶので、左の表の分＋右の表の分として比べる）
3. 便ごと：時刻が後戻りしていないか、隣のバス停まで20分を超える飛びが無いか
"""
import collections
import json
import re
import sys
import unicodedata

sys.stdout.reconfigure(encoding="utf-8")
FILES = {"makinohara": "2.1makinohara", "higashi": "2.1higasi", "naka": "2.1naka", "nishi": "2.1nisi", "minami": "minami", "fusa": "2.1fusa", "shisho": "2.1sisho"}
TIME = re.compile(r"(?<![\d:])(\d{1,2}:\d{2})(?![\d:])")
hm = lambda s: f"{s // 3600}:{s % 3600 // 60:02d}"

parsed = json.load(open("parsed.json", encoding="utf-8"))
total_bad = 0
for key, base in FILES.items():
    text = unicodedata.normalize("NFKC", open(base + ".txt", encoding="utf-8").read())
    lines = text.split("\n")
    pdf_times = collections.Counter(TIME.findall(text))
    tables = [t for t in parsed if t["route"] == key]
    mine = collections.Counter(hm(x) for t in tables for tr in t["trips"] for x in tr["times"] if x is not None)
    diff = (pdf_times - mine) + (mine - pdf_times)
    n_pdf, n_mine = sum(pdf_times.values()), sum(mine.values())
    # 行ごとの並び
    line_seqs = [TIME.findall(ln) for ln in lines]
    line_seqs = [s for s in line_seqs if s]
    row_ok = row_ng = 0
    ng_examples = []
    for t in tables:
        for i, stop in enumerate(t["stops"]):
            row = [hm(tr["times"][i]) for tr in t["trips"] if tr["times"][i] is not None]
            if not row:
                continue
            # 行の時刻が、PDF のどれかの行（または続く2行をつないだもの）に、この順で含まれるか
            def contains(seq, sub):
                it = iter(seq)
                return all(x in it for x in sub)
            hit = any(contains(s, row) for s in line_seqs) or any(contains(a + b, row) for a, b in zip(line_seqs, line_seqs[1:]))
            if hit:
                row_ok += 1
            else:
                row_ng += 1
                if len(ng_examples) < 4:
                    ng_examples.append(f"{t['caption']} {stop['name']} {row}")
    # 便ごと
    trip_bad = []
    for t in tables:
        for tr in t["trips"]:
            seq = [x for x in tr["times"] if x is not None]
            for a, b in zip(seq, seq[1:]):
                if b < a:
                    trip_bad.append(f"{t['caption']} {tr['label']} 後戻り {hm(a)}→{hm(b)}")
                elif b - a > 20 * 60:
                    trip_bad.append(f"{t['caption']} {tr['label']} 20分超 {hm(a)}→{hm(b)}")
    ok = not diff and row_ng == 0 and not trip_bad
    total_bad += 0 if ok else 1
    print(f"{'✅' if ok else '⚠'} {key}: 時刻の数 PDF {n_pdf}／読み取り {n_mine}・食い違い {sum(diff.values())}／行の並び 一致 {row_ok}・不一致 {row_ng}／便の点検 {len(trip_bad)}件")
    if diff:
        print("    数の食い違い:", dict(list(diff.items())[:12]))
    for e in ng_examples:
        print("    行の不一致:", e)
    for e in trip_bad[:6]:
        print("    便:", e)
print("まとめ:", "すべて一致" if total_bad == 0 else f"{total_bad}ルートに要確認あり")
