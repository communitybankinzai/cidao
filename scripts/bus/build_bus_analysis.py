"""バスマップの「移動が不便なエリア」の分析データを作る。

国勢調査の250m四方（5次メッシュ）ごとの人口（総数・65歳以上・75歳以上・高齢単身世帯）について、
区画の中心から「最寄りのバス停までの距離」「300m以内のバス停の1日の本数（平日）」「最寄りの駅までの距離」
「最寄りのスーパーまでの距離」を計算し、区分を付けて public/bus/analysis.json に書く。

使い方:
  python scripts/bus/build_bus_analysis.py --mesh <tblT001142Q5340.txt> --network public/bus/network.json \
      --boundary src/lib/inzai-city-boundary.ts --out public/bus/analysis.json [--shops <OSMの店のJSON>]

出典：人口＝e-Stat 統計地理情報システム「国勢調査 5次メッシュ（250mメッシュ）人口及び世帯」（T001142・1次メッシュ5340）
      店＝© OpenStreetMap contributors（ODbL）／バス＝network.json と同じ。
区分は、印西市の公共交通計画（案）の「交通空白地域」の考え方（バス停300m圏外・駅1km圏外）を目安にした、CBI の試算。
市の公式の判定ではない（市街化調整区域かどうか・デマンド交通の対象かどうかは入れていない）。
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from datetime import datetime, timezone, timedelta

sys.stdout.reconfigure(encoding="utf-8")
JST = timezone(timedelta(hours=9))
STOP_NEAR_M = 300  # バス停が「近い」とみなす距離（市の計画の目安）
STOP_FAR_M = 600
STATION_M = 1000  # 駅が「近い」とみなす距離
FEW_BUSES = 20  # 1日の本数がこれ未満なら「本数が少ない」


def dist_m(a, b) -> float:
    return math.hypot((a[0] - b[0]) * 110540.0, (a[1] - b[1]) * 111320.0 * math.cos(math.radians((a[0] + b[0]) / 2)))


def mesh_sw(code: str) -> tuple[float, float]:
    """250mメッシュ（10桁）の南西の角。"""
    lat = int(code[0:2]) / 1.5 + int(code[4]) * (5 / 60) + int(code[6]) * (30 / 3600)
    lon = 100 + int(code[2:4]) + int(code[5]) * (7.5 / 60) + int(code[7]) * (45 / 3600)
    s, t = int(code[8]), int(code[9])
    lat += ((s - 1) // 2) * (15 / 3600) + ((t - 1) // 2) * (7.5 / 3600)
    lon += ((s - 1) % 2) * (22.5 / 3600) + ((t - 1) % 2) * (11.25 / 3600)
    return lat, lon


DLAT, DLON = 7.5 / 3600, 11.25 / 3600


def load_boundary(path: str) -> list[list[tuple[float, float]]]:
    text = open(path, encoding="utf-8").read()
    start = text.index("= [", text.index("const RINGS")) + 2  # 型の書き方（[number, number][][]）の [ を飛ばす
    depth, end = 0, start
    for i in range(start, len(text)):
        if text[i] == "[":
            depth += 1
        elif text[i] == "]":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    rings = json.loads(re.sub(r",\s*\]", "]", text[start:end]))
    if rings and isinstance(rings[0][0], (int, float)):
        rings = [rings]
    return [[(pt[1], pt[0]) for pt in ring] for ring in rings]  # (緯度, 経度)


def inside(rings, lat: float, lon: float) -> bool:
    def in_ring(ring) -> bool:
        ok = False
        j = len(ring) - 1
        for i in range(len(ring)):
            (yi, xi), (yj, xj) = ring[i], ring[j]
            if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
                ok = not ok
            j = i
        return ok

    return in_ring(rings[0]) and not any(in_ring(r) for r in rings[1:])


def num(v: str) -> int:
    try:
        return int(v)
    except ValueError:
        return 0  # 「*」（秘匿）や空欄


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mesh", required=True)
    ap.add_argument("--network", required=True)
    ap.add_argument("--boundary", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--shops", default="")
    ap.add_argument("--other-stops", default="", help="時刻表をまだ入れていない会社（京成バスなど）のバス停。位置だけ使い、本数は数えない")
    args = ap.parse_args()

    rings = load_boundary(args.boundary)
    net = json.load(open(args.network, encoding="utf-8"))
    stops = {s["id"]: s for s in net["stops"]}
    # 平日（月曜に走る便）の、バス停ごとの発車の本数
    weekday = {sid for sid, sv in net["services"].items() if sv["days"][0] == 1}
    dep: dict[str, int] = {}
    for t in net["trips"]:
        if t["service"] not in weekday:
            continue
        for x in t["st"][:-1]:
            dep[x[0]] = dep.get(x[0], 0) + 1
    stop_list = [(s["lat"], s["lon"], s["name"], dep.get(s["id"], 0)) for s in stops.values()]
    stations = [(s["lat"], s["lon"], s["name"]) for s in stops.values() if "駅" in s["name"]]

    others = []
    if args.other_stops:
        others = [(o["lat"], o["lon"], o["name"], o["op"]) for o in json.load(open(args.other_stops, encoding="utf-8"))["stops"]]

    shops = []
    if args.shops:
        try:
            for e in json.load(open(args.shops, encoding="utf-8"))["elements"]:
                tags = e.get("tags", {})
                lat = e.get("lat") or (e.get("center") or {}).get("lat")
                lon = e.get("lon") or (e.get("center") or {}).get("lon")
                if lat is None or tags.get("shop") != "supermarket":
                    continue
                if inside(rings, lat, lon) or True:  # 市の外のスーパーも、近ければ使う人がいるので残す
                    shops.append({"name": tags.get("name") or "スーパー", "lat": round(lat, 6), "lon": round(lon, 6)})
        except Exception as e:  # 店のデータが無くても、ほかの計算は続ける
            print("店のデータを読めません:", e)

    cells = []
    with open(args.mesh, encoding="cp932", errors="replace") as f:
        head = f.readline().rstrip("\n").split(",")
        f.readline()
        col = {h: i for i, h in enumerate(head)}
        for line in f:
            r = line.rstrip("\n").split(",")
            code = r[0]
            pop = num(r[col["T001142001"]])
            if len(code) != 10 or pop <= 0:
                continue
            lat, lon = mesh_sw(code)
            c = (lat + DLAT / 2, lon + DLON / 2)
            if not inside(rings, c[0], c[1]):
                continue
            near = min(stop_list, key=lambda s: dist_m(c, (s[0], s[1])))
            d = dist_m(c, (near[0], near[1]))
            n300 = sum(s[3] for s in stop_list if dist_m(c, (s[0], s[1])) <= STOP_NEAR_M)
            ds = min(dist_m(c, (s[0], s[1])) for s in stations) if stations else 99999
            sm = min((dist_m(c, (s["lat"], s["lon"])) for s in shops), default=None)
            # 時刻表をまだ入れていない会社のバス停（位置だけ分かる）
            on = min(others, key=lambda o: dist_m(c, (o[0], o[1]))) if others else None
            do = dist_m(c, (on[0], on[1])) if on else 99999
            if ds <= STATION_M or (d <= STOP_NEAR_M and n300 >= FEW_BUSES):
                cat = "ok"
            elif do <= STOP_NEAR_M:
                cat = "other"  # ほかの会社のバス停が近い（本数は未集計）
            elif d <= STOP_NEAR_M:
                cat = "few"
            elif min(d, do) <= STOP_FAR_M:
                cat = "far"
            else:
                cat = "none"
            cells.append({
                "lat": round(lat, 6), "lon": round(lon, 6),
                "pop": pop, "p65": num(r[col["T001142019"]]), "p75": num(r[col["T001142022"]]), "solo": num(r[col["T001142049"]]),
                "d": round(d), "stop": near[2], "n": n300, "ds": round(ds),
                **({"sm": round(sm)} if sm is not None else {}),
                **({"do": round(do), "ostop": on[2], "oop": on[3]} if on and do <= STOP_FAR_M else {}),
                "cat": cat,
            })

    # スーパーは、印西市の人が住んでいる区画から1.5km以内のものだけ残す（市の外の遠い店は出さない）
    centers = [(c["lat"] + DLAT / 2, c["lon"] + DLON / 2) for c in cells]
    shops = [sh for sh in shops if any(abs(sh["lat"] - a) < 0.014 and abs(sh["lon"] - b) < 0.017 and dist_m((sh["lat"], sh["lon"]), (a, b)) <= 1500 for a, b in centers)]

    summary = {}
    for k in ("ok", "other", "few", "far", "none"):
        cs = [c for c in cells if c["cat"] == k]
        summary[k] = {"cells": len(cs), "pop": sum(c["pop"] for c in cs), "p65": sum(c["p65"] for c in cs), "p75": sum(c["p75"] for c in cs), "solo": sum(c["solo"] for c in cs)}
    total = {"cells": len(cells), "pop": sum(c["pop"] for c in cells), "p65": sum(c["p65"] for c in cells), "p75": sum(c["p75"] for c in cells)}
    out = {
        "builtAt": datetime.now(JST).strftime("%Y-%m-%d %H:%M"),
        "cell": {"dlat": DLAT, "dlon": DLON},
        "rule": {"stopNearM": STOP_NEAR_M, "stopFarM": STOP_FAR_M, "stationM": STATION_M, "fewBuses": FEW_BUSES},
        "summary": summary, "total": total,
        "cells": cells,
        "shops": shops,
        "routes": [r["name"] for r in net["routes"]],
    }
    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"区画 {total['cells']}／人口 {total['pop']}（65歳以上 {total['p65']}・75歳以上 {total['p75']}）／スーパー {len(shops)}")
    for k, label in (("ok", "便利"), ("other", "ほかの会社のバス停が近い（本数未集計）"), ("few", "本数が少ない"), ("far", "バス停がやや遠い"), ("none", "バス停も駅も遠い")):
        v = summary[k]
        print(f"  {label}: 区画{v['cells']} 人口{v['pop']}（{v['pop']*100/max(1,total['pop']):.1f}%） 65歳以上{v['p65']} 75歳以上{v['p75']} 高齢単身世帯{v['solo']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
