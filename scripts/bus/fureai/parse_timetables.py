"""ふれあいバスの時刻表PDF（文字つき）を、表ごとに「バス停の並び×便ごとの時刻」に起こす。

pdftotext -bbox-layout で語の座標を取り、座標で表を組み立てる（行の高さがバス停名と時刻でずれている表があるため、
文字の並びではなく「上から何番目か」で対応づける）。結果と点検の印を parsed.json に書く。
使い方: python parse_timetables.py <PDFのあるフォルダ>
"""
from __future__ import annotations

import html
import json
import re
import subprocess
import sys
import unicodedata

sys.stdout.reconfigure(encoding="utf-8")

FILES = [
    ("makinohara", "牧の原循環ルート", "2.1makinohara.pdf"),
    ("higashi", "東ルート", "2.1higasi.pdf"),
    ("naka", "中ルート", "2.1naka.pdf"),
    ("nishi", "西ルート", "2.1nisi.pdf"),
    ("minami", "南ルート", "minami.pdf"),
    ("fusa", "布佐ルート", "2.1fusa.pdf"),
    ("shisho", "印旛・本埜支所ルート", "2.1sisho.pdf"),
]
TIME = re.compile(r"^\d{1,2}:\d{2}$")
DASH = re.compile(r"^[-－ー―‐–—]+$")
NUM = re.compile(r"^\d{1,3}$")
WORD = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>')


def words_of(pdf: str) -> list[list[dict]]:
    import pymupdf  # C:/Temp/work/bus-map/_pylibs に入れたもの（PYTHONPATH で渡す）

    pages = []
    for page in pymupdf.open(pdf):
        ws = []
        for x0, y0, x1, y1, text, *_ in page.get_text("words"):
            t = unicodedata.normalize("NFKC", text).strip()
            if not t:
                continue
            ws.append({"t": t, "x0": x0, "x1": x1, "y": (y0 + y1) / 2, "cx": (x0 + x1) / 2, "h": y1 - y0})
        pages.append(ws)
    return pages


def cluster(vals: list[float], gap: float) -> list[list[int]]:
    order = sorted(range(len(vals)), key=lambda i: vals[i])
    groups: list[list[int]] = []
    last = None
    for i in order:
        if last is None or vals[i] - last > gap:
            groups.append([])
        groups[-1].append(i)
        last = vals[i]
    return groups


def to_sec(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 3600 + int(m) * 60


def parse_page(ws: list[dict]) -> list[dict]:
    heads = sorted([w for w in ws if "停留所名" in w["t"]], key=lambda w: w["x0"])
    tables = []
    for hi, head in enumerate(heads):
        left = head["x0"] - 90
        right = heads[hi + 1]["x0"] - 90 if hi + 1 < len(heads) else 1e9
        if hi > 0:
            left = max(left, 0)
        inside = [w for w in ws if left <= w["cx"] < right and w["y"] > head["y"] + 2]
        cells = [w for w in inside if TIME.match(w["t"]) or DASH.match(w["t"])]
        if not cells:
            continue
        first_time_x = min(w["x0"] for w in cells if TIME.match(w["t"]))
        # バス停名の列：最初の時刻の列より左
        name_words = [w for w in inside if w["x1"] <= first_time_x + 1 and not TIME.match(w["t"]) and not DASH.match(w["t"])]
        rows = []
        for g in cluster([w["y"] for w in name_words], 2.5):
            line = sorted([name_words[i] for i in g], key=lambda w: w["x0"])
            nums = [w for w in line if NUM.match(w["t"])]
            text = "".join(w["t"] for w in line if not NUM.match(w["t"]))
            rows.append({"y": sum(w["y"] for w in line) / len(line), "no": int(nums[0]["t"]) if nums else None, "name": text})
        # 番号だけの行（(着)(発)の2行にまたがる番号）を、すぐ上と下の名前の行へ渡す
        stops = []
        for i, r in enumerate(rows):
            if r["name"]:
                stops.append(dict(r))
        for r in rows:
            if r["name"] or r["no"] is None:
                continue
            near = sorted(stops, key=lambda s: abs(s["y"] - r["y"]))[:2]
            for s in near:
                if s["no"] is None and abs(s["y"] - r["y"]) < 14:
                    s["no"] = r["no"]
        stops = [s for s in stops if not s["name"].startswith("※") and not re.match(r"^\d*便", s["name"]) and len(s["name"]) <= 30]
        # 時刻の列（便）。見出しの「n便」の位置に、いちばん近い時刻を入れる
        # （「10便12便13便」のように1語にくっついた見出しは、幅を等分して分ける）
        labels = []
        for w in ws:
            if "便" not in w["t"] or abs(w["y"] - head["y"]) > 14 or not (left <= w["cx"] < right):
                continue
            parts = re.findall(r"\d+便", w["t"])
            if not parts:
                continue
            step = (w["x1"] - w["x0"]) / len(parts)
            for k, part in enumerate(parts):
                labels.append({"label": part, "cx": w["x0"] + step * (k + 0.5)})
        labels.sort(key=lambda v: v["cx"])
        cols = [{"cx": v["cx"], "label": v["label"], "cells": [], "ys": []} for v in labels]
        orphan = 0
        for w in sorted(cells, key=lambda w: w["y"]):
            if not cols:
                break
            c = min(cols, key=lambda c: abs(c["cx"] - w["cx"]))
            if abs(c["cx"] - w["cx"]) > 22:
                orphan += 1
                continue
            c["cells"].append(None if DASH.match(w["t"]) else to_sec(w["t"]))
            c["ys"].append(w["y"])
        cols = [c for c in cols if c["cells"]]
        # 見出し（表の上にある「（〜回り）」「（平日便）」など）
        caps = [w for w in ws if w["y"] < head["y"] - 2 and w["y"] > head["y"] - 40 and ("回り" in w["t"] or "平日" in w["t"] or "祝" in w["t"]) and left - 40 <= w["cx"] < right]
        cap = "".join(w["t"] for w in sorted(caps, key=lambda w: w["x0"]))
        tables.append({"caption": cap, "stops": [{"no": s["no"], "name": s["name"], "y": s["y"]} for s in stops], "cols": cols, "orphan": orphan})
    return tables


def align(n_stops: int, cells: list, ref: list | None) -> tuple[list, str]:
    """列の中身を、バス停の並びに当てる。数が合えばそのまま。足りないときは、基準の便の所要時間に合う位置へずらす。"""
    if len(cells) == n_stops:
        return cells, "ok"
    if len(cells) > n_stops:
        return cells[:n_stops], f"多い({len(cells)}>{n_stops})"
    if ref is None:
        return cells + [None] * (n_stops - len(cells)), f"少ない({len(cells)}<{n_stops})・基準なし"
    best, best_off = None, 0
    for off in range(n_stops - len(cells) + 1):
        err, cnt = 0, 0
        for i in range(len(cells) - 1):
            a, b = cells[i], cells[i + 1]
            ra, rb = ref[off + i], ref[off + i + 1]
            if None in (a, b, ra, rb):
                continue
            err += abs((b - a) - (rb - ra))
            cnt += 1
        score = err / cnt if cnt else 1e9
        if best is None or score < best:
            best, best_off = score, off
    out = [None] * best_off + cells + [None] * (n_stops - len(cells) - best_off)
    return out, f"少ない({len(cells)}<{n_stops})→{best_off}番目から・ずれ平均{best:.0f}秒"


def main() -> int:
    folder = sys.argv[1] if len(sys.argv) > 1 else "."
    result = []
    for key, title, fname in FILES:
        pages = words_of(f"{folder}/{fname}")
        print(f"== {title}（{fname}・{len(pages)}ページ）")
        for pi, ws in enumerate(pages):
            for ti, tb in enumerate(parse_page(ws)):
                n = len(tb["stops"])
                full = [c["cells"] for c in tb["cols"] if len(c["cells"]) == n and None not in c["cells"]]
                ref = full[0] if full else None
                trips, notes = [], []
                # バス停名と時刻が同じ高さに並んでいる表は、高さで対応づける（行が抜けていても、ずれない）
                sy = [s["y"] for s in tb["stops"]]
                allc = [(y, v) for c in tb["cols"] for y, v in zip(c["ys"], c["cells"])]
                near = sum(1 for y, _ in allc if min(abs(y - a) for a in sy) < 4)
                by_y = n > 0 and near >= 0.95 * len(allc)
                for c in tb["cols"]:
                    if by_y:
                        times, lost = [None] * n, 0
                        for y, v in zip(c["ys"], c["cells"]):
                            k = min(range(n), key=lambda i: abs(sy[i] - y))
                            if abs(sy[k] - y) < 4:
                                times[k] = v
                            else:
                                lost += 1
                        note = "ok" if not lost else f"バス停名の無い行の時刻{lost}個"
                    else:
                        times, note = align(n, c["cells"], ref)
                    seq = [t for t in times if t is not None]
                    if any(b < a for a, b in zip(seq, seq[1:])):
                        note += "・時刻が逆戻り"
                    trips.append({"label": c["label"], "times": times})
                    if note != "ok":
                        notes.append(f"{c['label'] or '?'}:{note}")
                nonum = [s["name"] for s in tb["stops"] if s["no"] is None]
                print(f"  p{pi+1} 表{ti+1}「{tb['caption']}」 バス停{n} 便{len(trips)}（{' '.join(t['label'] for t in trips)}） 対応づけ={'高さ' if by_y else '順番'}")
                print(f"     先頭 {tb['stops'][0] if n else None} 末尾 {tb['stops'][-1] if n else None}")
                if tb.get("orphan"):
                    print(f"     ⚠ どの便にも入らない時刻 {tb['orphan']}個")
                # 同じ便の中で、同じ行に時刻が2つ入っていないか
                for c in tb["cols"]:
                    ys = sorted(c["ys"])
                    if any(b - a < 3 for a, b in zip(ys, ys[1:])):
                        print(f"     ⚠ {c['label']}：同じ行に時刻が2つ")
                if nonum:
                    print(f"     ⚠ 番号なし: {nonum}")
                if notes:
                    print(f"     ⚠ {notes}")
                result.append({"route": key, "title": title, "file": fname, "page": pi + 1, "caption": tb["caption"], "stops": [{"no": s["no"], "name": s["name"]} for s in tb["stops"]], "trips": trips, "notes": notes})
    json.dump(result, open(f"{folder}/parsed.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
