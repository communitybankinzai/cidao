"""京成バス千葉セントラル 印西営業所（旧ちばレインボーバス）の「路線の線とバス停」だけを起こす。

元データは、ちばレインボーバスが公開していた GTFS（2024-10-01〜2025-09-30・CC BY 4.0）。
有効期間が切れているので、時刻は使わない（便は「どの日も走らない」扱いにし、地図の線とバス停だけに使う）。
今の路線は、京成バス千葉セントラル 印西営業所の全線路線図（2026年7月版）と線名で見比べた。

使い方:
  python scripts/bus/build_keisei_lines.py --gtfs C:/Temp/work/bus-map/dl/rainbow.zip --out scripts/bus/data/keisei_lines.json
出力は build_bus_data.py の --json keisei=… で network.json に混ぜる。標準ライブラリだけで動く。
"""
from __future__ import annotations
import argparse, csv, io, json, sys, zipfile

AGENCY = "京成バス千葉セントラル 印西営業所（旧ちばレインボーバス）"
AGENCY_URL = "https://www.keiseibus.co.jp/route-bus/"
AGENCY_TEL = "0476460022"  # 船尾車庫（全線路線図の問い合わせ先）
# 印西市内を通る線（線名 → 色。色は公式の路線図に寄せた）
LINES = {
    "神崎線": "0B6B3A", "高花線": "E6007E", "西の原線": "9AA800", "小林線": "B0127A",
    "滝野循環線": "F28C1E", "北口循環線": "6A3FA0", "鹿黒循環線": "2B2F8F", "印旛学園線": "8D4B3A",
}

# 公式の全線路線図（2026年7月版）に合わせた、バス停の今の名前（古いデータの名前 → 今の名前）
RENAME = {
    "千葉NT中央駅": "千葉ニュータウン中央駅", "千葉NT中央駅北口": "千葉ニュータウン中央駅北口", "原山三丁目": "原山３丁目",
    "タウンセンター北": "ビジネスモール北", "タウンセンター中央北": "ビジネスモール中央", "タウンセンター南": "ビジネスモール南",
    "薬園台１丁目": "薬円台１丁目", "薬園台２丁目": "薬円台２丁目", "自衛隊": "習志野駐屯地", "二宮支所": "二宮出張所", "桑橋": "桑の橋",
}

def table(zf, name):
    names = {n.split("/")[-1]: n for n in zf.namelist()}
    with zf.open(names[name]) as f:
        return [{(k or "").strip(): (v or "").strip() for k, v in r.items()} for r in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig", newline=""))]

def main() -> int:
    ap = argparse.ArgumentParser(); ap.add_argument("--gtfs", required=True); ap.add_argument("--out", required=True)
    a = ap.parse_args()
    with zipfile.ZipFile(a.gtfs) as zf:
        routes, stops, trips, sts, shapes, info = (table(zf, n) for n in ("routes.txt", "stops.txt", "trips.txt", "stop_times.txt", "shapes.txt", "feed_info.txt"))
    def line_of(r):
        n = (r.get("route_short_name") or "").replace("西sの原線", "西の原線")  # 元データの打ち間違い
        return n if n in LINES else None
    route_line = {r["route_id"]: line_of(r) for r in routes}
    by_shape: dict[str, list] = {}
    for p in shapes:
        by_shape.setdefault(p["shape_id"], []).append((int(p["shape_pt_sequence"]), round(float(p["shape_pt_lat"]), 5), round(float(p["shape_pt_lon"]), 5)))
    st_by_trip: dict[str, list] = {}
    for s in sts:
        st_by_trip.setdefault(s["trip_id"], []).append((int(s["stop_sequence"]), s["stop_id"]))
    out = {"routes": [], "stops": [], "shapes": {}, "trips": [], "services": {"keisei:none": {"days": [0] * 7, "start": "", "end": "", "add": [], "remove": []}},
           "source": {"key": "keisei", "publisher": "京成バス千葉セントラル 印西営業所（旧ちばレインボーバスの公開データ・線とバス停のみ。時刻は入れていません）",
                      "start": info[0].get("feed_start_date", ""), "end": info[0].get("feed_end_date", ""), "version": info[0].get("feed_version", ""), "noTimes": True}}
    for name, color in LINES.items():
        out["routes"].append({"id": "keisei:" + name, "name": name, "color": color, "agency": AGENCY, "agencyUrl": AGENCY_URL, "agencyTel": AGENCY_TEL, "feed": "keisei", "noTimes": True})
    seen, used = set(), set()
    for t in trips:
        line = route_line.get(t["route_id"])
        if not line: continue
        seq = [sid for _, sid in sorted(st_by_trip.get(t["trip_id"], []))]
        key = (line, t.get("shape_id", ""), tuple(seq))
        if key in seen or len(seq) < 2: continue
        seen.add(key)
        shp = t.get("shape_id", "")
        if shp in by_shape: out["shapes"]["keisei:" + shp] = [[p[1], p[2]] for p in sorted(by_shape[shp])]
        used.update(seq)
        out["trips"].append({"id": f"keisei:{line}:{len(out['trips'])}", "route": "keisei:" + line, "service": "keisei:none", "headsign": t.get("trip_headsign", ""),
                             "shape": "keisei:" + shp if shp in by_shape else "", "st": [["keisei:" + sid, 0, 0] for sid in seq]})
    for s in stops:
        if s["stop_id"] in used:
            out["stops"].append({"id": "keisei:" + s["stop_id"], "name": RENAME.get(s["stop_name"], s["stop_name"]), "lat": round(float(s["stop_lat"]), 6), "lon": round(float(s["stop_lon"]), 6)})
    with open(a.out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    import collections
    c = collections.Counter(t["route"] for t in out["trips"])
    print(f"線{len(out['routes'])} バス停{len(out['stops'])} 通り方{len(out['trips'])} 形{len(out['shapes'])}", dict(c))
    return 0

if __name__ == "__main__":
    sys.exit(main())
