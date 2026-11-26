"""ふれあいバスのバス停名に、位置を付ける。

位置の出どころ（上から順に使う）:
  1. 国土数値情報 バス停留所（P11・2022年）のうち、事業者が印西市（ふれあいバス）のもの
  2. 同じデータの、印西周辺のほかの事業者の同じ名前のバス停
  3. ちばレインボーバスの公開データ（GTFS・2024年版。位置の参考）・印西市の公開データ（宗像・六合）
  4. OpenStreetMap のバス停（osm_stops.json があれば）
どれにも無いものは「位置なし」として一覧に出す（勝手に置かない）。
"""
from __future__ import annotations

import csv
import json
import math
import os
import re
import sys
import unicodedata

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
BOX = (35.70, 35.90, 140.00, 140.32)  # 印西市と周辺（布佐・白井の一部を含む）


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s)
    s = re.sub(r"\((着|発)\)", "", s)
    s = re.sub(r"\(.*?\)", "", s)
    s = s.replace("ヶ", "ケ").replace("千葉ニュータウン", "千葉NT").replace(" ", "").replace("　", "")
    for a, b in zip("一二三四五六七八九", "123456789"):
        s = s.replace(a + "丁目", b + "丁目")
    return s


def in_box(lat: float, lon: float) -> bool:
    return BOX[0] <= lat <= BOX[1] and BOX[2] <= lon <= BOX[3]


def dist(a, b) -> float:
    p = math.pi / 180
    return math.hypot((a[0] - b[0]) * 110540, (a[1] - b[1]) * 111320 * math.cos(a[0] * p))


def load_ksj() -> list[dict]:
    path = os.path.join(HERE, "ksj", "P11-22_12_GML", "P11-22_12.xml")
    x = open(path, encoding="utf-8", errors="replace").read()
    pts = {m.group(1): tuple(map(float, m.group(2).split())) for m in re.finditer(r'<gml:Point gml:id="(n\d+)">\s*<gml:pos>([\d. ]+)</gml:pos>', x)}
    out = []
    for m in re.finditer(r"<ksj:BusStop gml:id=\"bs\d+\">(.*?)</ksj:BusStop>", x, re.S):
        b = m.group(1)
        ref = re.search(r'xlink:href="#(n\d+)"', b)
        name = re.search(r"<ksj:bsn>(.*?)</ksj:bsn>", b)
        op = re.search(r"<ksj:boc>(.*?)</ksj:boc>", b)
        if not ref or not name or ref.group(1) not in pts:
            continue
        lat, lon = pts[ref.group(1)]
        if in_box(lat, lon):
            out.append({"name": name.group(1), "op": op.group(1) if op else "", "lat": lat, "lon": lon,
                        "routes": re.findall(r"<ksj:brn>(.*?)</ksj:brn>", b)})
    return out


def load_gtfs(path: str, label: str) -> list[dict]:
    if not os.path.exists(path):
        return []
    return [{"name": r["stop_name"], "op": label, "lat": float(r["stop_lat"]), "lon": float(r["stop_lon"])}
            for r in csv.DictReader(open(path, encoding="utf-8-sig")) if r.get("stop_lat")]


def load_osm() -> list[dict]:
    path = os.path.join(HERE, "osm_stops.json")
    if not os.path.exists(path):
        return []
    try:
        els = json.load(open(path, encoding="utf-8"))["elements"]
    except Exception:
        return []
    return [{"name": e["tags"]["name"], "op": "OpenStreetMap", "lat": e["lat"], "lon": e["lon"]} for e in els if e.get("tags", {}).get("name")]


def main() -> int:
    parsed = json.load(open(os.path.join(HERE, "parsed.json"), encoding="utf-8"))
    ksj = load_ksj()
    ops = {}
    for s in ksj:
        ops[s["op"]] = ops.get(s["op"], 0) + 1
    print("国土数値情報：印西周辺", len(ksj), "件／事業者", dict(sorted(ops.items(), key=lambda kv: -kv[1])[:8]))
    own = [s for s in ksj if "印西" in s["op"]]
    tiers = [
        ("国土数値情報（印西市・2022年）", own),
        ("国土数値情報（ほかの事業者・2022年）", [s for s in ksj if "印西" not in s["op"]]),
        ("ちばレインボーバスの公開データ（2024年版）", load_gtfs("C:/Users/you08/OneDrive/CBI/tools/gtfs-bus-map/data/gtfs_extracted/261afb4412f5/stops.txt", "rainbow")),
        ("印西市の公開データ（宗像・六合）", load_gtfs("C:/Temp/work/bus-map/dl/inzai/stops.txt", "inzai")),
        ("OpenStreetMap", load_osm()),
    ]
    index = []
    for label, items in tiers:
        d = {}
        for s in items:
            d.setdefault(norm(s["name"]), []).append(s)
        index.append((label, d))
        print(f"  {label}: {len(items)}件")

    names = {}
    for t in parsed:
        for s in t["stops"]:
            names.setdefault(norm(s["name"]), {"name": re.sub(r"\((着|発)\)", "", unicodedata.normalize("NFKC", s["name"])), "no": s["no"], "routes": set()})
            names[norm(s["name"])]["routes"].add(t["title"])
            if names[norm(s["name"])]["no"] is None:
                names[norm(s["name"])]["no"] = s["no"]

    out, missing, spread = {}, [], []
    for key, info in names.items():
        hit = None
        for label, d in index:
            if key in d:
                pts = d[key]
                lat = sum(p["lat"] for p in pts) / len(pts)
                lon = sum(p["lon"] for p in pts) / len(pts)
                far = max(dist((lat, lon), (p["lat"], p["lon"])) for p in pts)
                hit = {"lat": round(lat, 6), "lon": round(lon, 6), "source": label, "points": len(pts), "spreadM": round(far)}
                if far > 250:
                    spread.append((info["name"], label, len(pts), round(far)))
                break
        if hit:
            out[key] = {**hit, "name": info["name"], "no": info["no"], "routes": sorted(info["routes"])}
        else:
            missing.append((info["name"], info["no"], sorted(info["routes"])))
    by_src = {}
    for v in out.values():
        by_src[v["source"]] = by_src.get(v["source"], 0) + 1
    print(f"バス停 {len(names)}か所のうち、位置あり {len(out)}・位置なし {len(missing)}")
    for k, v in by_src.items():
        print(f"   {k}: {v}")
    if spread:
        print("⚠ 同じ名前の点が250m以上離れている（別の場所の同名かもしれない）:")
        for s in spread:
            print("   ", s)
    print("位置なし:")
    for name, no, routes in sorted(missing, key=lambda x: (x[2], x[0])):
        print(f"   {no} {name}（{'・'.join(routes)}）")
    json.dump({"stops": out, "missing": [{"name": n, "no": no, "routes": r} for n, no, r in missing]}, open(os.path.join(HERE, "stops_located.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
