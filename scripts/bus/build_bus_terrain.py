"""バスマップ（/bus）の立体表示に使う、地形と主な道路のファイルを作る。

public/bus/network.json のバス停の範囲（＋余白）について、国土地理院の標高タイル（文字の版・z14）を読み、
約60m間隔の格子にして public/bus/terrain.json に書く。主な道路（国道・県道）も同じ範囲で切り出して入れる。
画面は、このファイルだけで地形の模型を描く（地図タイルを読まない）。

使い方:
  python scripts/bus/build_bus_terrain.py --network public/bus/network.json --out public/bus/terrain.json \
      --cache C:/Temp/work/bus-map/demcache \
      --roads "C:/…/site/inzai-disaster-map/pipeline/data/pref_roads_main.json.gz"

  --roads は省ける（道路なしで作る）。形は {"ways":[{"key":"trunk:16","path":[[緯度,経度],…]},…]}。

出典：標高＝国土地理院 標高タイル（基盤地図情報数値標高モデル）／道路＝© OpenStreetMap contributors（ODbL）。
標準ライブラリだけで動く。タイルは --cache に貯め、2回目からは通信しない。
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone, timedelta

Z = 14
N = 2 ** Z
TILE_URL = "https://cyberjapandata.gsi.go.jp/xyz/dem/{z}/{x}/{y}.txt"
JST = timezone(timedelta(hours=9))
WATER = -9999  # 標高なし（沼・川など）の印


def tile_xy(lat: float, lon: float) -> tuple[float, float]:
    x = (lon + 180.0) / 360.0 * N
    y = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * N
    return x, y


def load_tile(cache: str, x: int, y: int) -> list[list[float | None]] | None:
    path = os.path.join(cache, f"{Z}_{x}_{y}.txt")
    if not os.path.exists(path):
        url = TILE_URL.format(z=Z, x=x, y=y)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "bus-map-terrain-builder"})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
        except Exception as e:  # 海の上などはタイルが無い（404）
            print(f"  タイルなし {x},{y}: {e}", file=sys.stderr)
            data = b""
        with open(path, "wb") as f:
            f.write(data)
        time.sleep(0.3)  # 続けて取りすぎない
    with open(path, encoding="utf-8") as f:
        text = f.read().strip()
    if not text:
        return None
    rows = []
    for line in text.split("\n"):
        rows.append([None if v == "e" else float(v) for v in line.split(",")])
    return rows if len(rows) == 256 else None


def clip_segments(path: list[list[float]], box: tuple[float, float, float, float]) -> list[list[list[float]]]:
    """範囲の中にある点の続きだけを取り出す（線分の厳密な切り詰めはしない）。"""
    lat0, lat1, lon0, lon1 = box
    out, cur = [], []
    for lat, lon in path:
        if lat0 <= lat <= lat1 and lon0 <= lon <= lon1:
            cur.append([round(lat, 5), round(lon, 5)])
        else:
            if len(cur) >= 2:
                out.append(cur)
            cur = []
    if len(cur) >= 2:
        out.append(cur)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--network", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--cache", required=True)
    ap.add_argument("--roads", default="")
    ap.add_argument("--margin-km", type=float, default=1.5)
    ap.add_argument("--cell-m", type=float, default=60.0)
    args = ap.parse_args()

    os.makedirs(args.cache, exist_ok=True)
    net = json.load(open(args.network, encoding="utf-8"))
    lats = [s["lat"] for s in net["stops"]]
    lons = [s["lon"] for s in net["stops"]]
    mid = (min(lats) + max(lats)) / 2
    dlat = args.margin_km / 110.54
    dlon = args.margin_km / (111.32 * math.cos(math.radians(mid)))
    lat0, lat1 = min(lats) - dlat, max(lats) + dlat
    lon0, lon1 = min(lons) - dlon, max(lons) + dlon

    height_m = (lat1 - lat0) * 110540
    width_m = (lon1 - lon0) * 111320 * math.cos(math.radians(mid))
    rows = max(2, round(height_m / args.cell_m) + 1)
    cols = max(2, round(width_m / args.cell_m) + 1)
    print(f"範囲 緯度{lat0:.4f}〜{lat1:.4f} 経度{lon0:.4f}〜{lon1:.4f}／約{width_m/1000:.1f}km×{height_m/1000:.1f}km／格子 {cols}×{rows}")

    tiles: dict[tuple[int, int], list | None] = {}
    heights: list[int] = []
    for r in range(rows):  # 北から南へ
        lat = lat1 - (lat1 - lat0) * r / (rows - 1)
        for c in range(cols):  # 西から東へ
            lon = lon0 + (lon1 - lon0) * c / (cols - 1)
            fx, fy = tile_xy(lat, lon)
            tx, ty = int(fx), int(fy)
            if (tx, ty) not in tiles:
                tiles[(tx, ty)] = load_tile(args.cache, tx, ty)
            t = tiles[(tx, ty)]
            v = None
            if t:
                px = min(255, int((fx - tx) * 256))
                py = min(255, int((fy - ty) * 256))
                v = t[py][px]
            heights.append(WATER if v is None else round(v * 10))  # 0.1m 単位の整数
    land = [h for h in heights if h != WATER]
    print(f"タイル {len(tiles)}枚／標高 {min(land)/10:.1f}〜{max(land)/10:.1f}m／標高なし（水面など）{len(heights)-len(land)}点")

    roads: list[dict] = []
    if args.roads:
        opener = gzip.open if args.roads.endswith(".gz") else open
        with opener(args.roads, "rt", encoding="utf-8") as f:
            ways = json.load(f)["ways"]
        for w in ways:
            for seg in clip_segments(w["path"], (lat0, lat1, lon0, lon1)):
                roads.append({"k": w.get("key", "").split(":")[0], "p": seg})
        print(f"道路 {len(roads)}本")

    out = {
        "builtAt": datetime.now(JST).strftime("%Y-%m-%d %H:%M"),
        "lat0": round(lat0, 6), "lat1": round(lat1, 6), "lon0": round(lon0, 6), "lon1": round(lon1, 6),
        "cols": cols, "rows": rows, "water": WATER,
        "h": heights,
        "roads": roads,
        "credit": "標高：国土地理院 標高タイル／道路：© OpenStreetMap contributors",
    }
    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"書き出し {args.out}（{os.path.getsize(args.out)/1024:.0f}KB）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
