"""バスマップ（/bus）のデータを作る。

GTFS の zip（複数可）を読み、地図で使う1つの JSON（public/bus/network.json）にまとめる。
バスの位置は、この JSON の「便ごとの各バス停の時刻」と「バス停の位置（あれば路線の形）」から、
画面側で計算する予測である（実際の位置ではない）。

使い方:
  python scripts/bus/build_bus_data.py --out public/bus/network.json \
      --gtfs inzai=C:/Temp/work/bus-map/dl/inzai.zip

  --gtfs は「なまえ=zipの場所」。何度でも書ける。なまえは ID の頭に付く（会社が違っても ID がぶつからないように）。

標準ライブラリだけで動く（Python 3.9 以上）。
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import zipfile
from datetime import datetime, timezone, timedelta

JST = timezone(timedelta(hours=9))
DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def read_table(zf: zipfile.ZipFile, name: str) -> list[dict]:
    """zip の中の表を読む。無ければ空。BOM と前後の空白を取る。"""
    names = {n.split("/")[-1]: n for n in zf.namelist()}
    if name not in names:
        return []
    with zf.open(names[name]) as f:
        text = io.TextIOWrapper(f, encoding="utf-8-sig", newline="")
        rows = []
        for row in csv.DictReader(text):
            rows.append({(k or "").strip(): (v or "").strip() for k, v in row.items()})
        return rows


def to_sec(hms: str) -> int | None:
    """6:02:00 や 25:10:00 を、その日の0時からの秒にする。"""
    if not hms:
        return None
    p = hms.split(":")
    if len(p) != 3:
        return None
    return int(p[0]) * 3600 + int(p[1]) * 60 + int(p[2])


def num(s: str) -> float | None:
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def load_feed(key: str, path: str) -> dict:
    out = {"routes": [], "stops": [], "shapes": {}, "trips": [], "services": {}, "source": None}
    with zipfile.ZipFile(path) as zf:
        agencies = {a.get("agency_id", ""): a for a in read_table(zf, "agency.txt")}
        feed_info = (read_table(zf, "feed_info.txt") or [{}])[0]
        routes = read_table(zf, "routes.txt")
        stops = read_table(zf, "stops.txt")
        trips = read_table(zf, "trips.txt")
        stop_times = read_table(zf, "stop_times.txt")
        shapes = read_table(zf, "shapes.txt")
        calendar = read_table(zf, "calendar.txt")
        calendar_dates = read_table(zf, "calendar_dates.txt")

    if not routes or not stops or not trips or not stop_times:
        raise SystemExit(f"[{key}] routes / stops / trips / stop_times のどれかが空です: {path}")

    pre = key + ":"

    # 運行する日（曜日＋例外の日）
    for c in calendar:
        out["services"][pre + c["service_id"]] = {
            "days": [1 if c.get(d) == "1" else 0 for d in DAY_KEYS],
            "start": c.get("start_date", ""),
            "end": c.get("end_date", ""),
            "add": [],
            "remove": [],
        }
    for cd in calendar_dates:
        sid = pre + cd["service_id"]
        sv = out["services"].setdefault(sid, {"days": [0] * 7, "start": "", "end": "", "add": [], "remove": []})
        (sv["add"] if cd.get("exception_type") == "1" else sv["remove"]).append(cd["date"])

    # 路線
    all_same_color = len({r.get("route_color", "") for r in routes}) <= 1 and len(routes) > 1
    for r in routes:
        ag = agencies.get(r.get("agency_id", ""), {})
        name = r.get("route_long_name") or r.get("route_short_name") or r["route_id"]
        out["routes"].append(
            {
                "id": pre + r["route_id"],
                "name": name,
                # 全路線が同じ色のデータは、色を使わない（画面側で割り当てる）
                "color": "" if all_same_color else r.get("route_color", ""),
                "agency": ag.get("agency_name", ""),
                "agencyUrl": ag.get("agency_url", ""),
                "agencyTel": ag.get("agency_phone", ""),
                "feed": key,
            }
        )

    # バス停（乗り場だけ。location_type が 1 の親は外す）
    for s in stops:
        if s.get("location_type", "0") not in ("", "0"):
            continue
        lat, lon = num(s.get("stop_lat", "")), num(s.get("stop_lon", ""))
        if lat is None or lon is None:
            continue
        out["stops"].append({"id": pre + s["stop_id"], "name": s["stop_name"], "lat": round(lat, 6), "lon": round(lon, 6)})

    # 路線の形（lat, lon, 起点からの距離m）
    by_shape: dict[str, list] = {}
    for p in shapes:
        lat, lon = num(p.get("shape_pt_lat", "")), num(p.get("shape_pt_lon", ""))
        if lat is None or lon is None:
            continue
        by_shape.setdefault(p["shape_id"], []).append(
            (int(p.get("shape_pt_sequence") or 0), round(lat, 5), round(lon, 5), num(p.get("shape_dist_traveled", "")))
        )
    for sid, pts in by_shape.items():
        pts.sort()
        has_dist = all(p[3] is not None for p in pts)
        out["shapes"][pre + sid] = [[p[1], p[2]] + ([round(p[3])] if has_dist else []) for p in pts]

    # 便（バス停ごとの時刻）
    st_by_trip: dict[str, list] = {}
    for st in stop_times:
        sec = to_sec(st.get("departure_time") or st.get("arrival_time") or "")
        if sec is None:
            continue
        arr = to_sec(st.get("arrival_time") or "") or sec
        st_by_trip.setdefault(st["trip_id"], []).append(
            (int(st.get("stop_sequence") or 0), pre + st["stop_id"], arr, sec, num(st.get("shape_dist_traveled", "")))
        )
    for t in trips:
        sts = sorted(st_by_trip.get(t["trip_id"], []))
        if len(sts) < 2:
            continue
        shape_id = pre + t["shape_id"] if t.get("shape_id") else ""
        use_dist = shape_id in out["shapes"] and all(s[4] is not None for s in sts) and len(out["shapes"][shape_id][0]) == 3
        out["trips"].append(
            {
                "id": pre + t["trip_id"],
                "route": pre + t["route_id"],
                "service": pre + t["service_id"],
                "headsign": t.get("trip_headsign", ""),
                "shape": shape_id if shape_id in out["shapes"] else "",
                # [バス停ID, 着く秒, 出る秒, 起点からの距離m（形があるときだけ）]
                "st": [[s[1], s[2], s[3]] + ([round(s[4])] if use_dist else []) for s in sts],
            }
        )

    out["source"] = {
        "key": key,
        "publisher": feed_info.get("feed_publisher_name", ""),
        "start": feed_info.get("feed_start_date", ""),
        "end": feed_info.get("feed_end_date", ""),
        "version": feed_info.get("feed_version", ""),
    }
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--gtfs", action="append", default=[], metavar="NAME=ZIP")
    args = ap.parse_args()
    if not args.gtfs:
        print("--gtfs なまえ=zip を1つ以上指定してください", file=sys.stderr)
        return 1

    net = {
        "builtAt": datetime.now(JST).strftime("%Y-%m-%d %H:%M"),
        "sources": [],
        "routes": [],
        "stops": [],
        "shapes": {},
        "trips": [],
        "services": {},
    }
    for spec in args.gtfs:
        if "=" not in spec:
            print(f"--gtfs は「なまえ=zip」の形で書いてください: {spec}", file=sys.stderr)
            return 1
        key, path = spec.split("=", 1)
        feed = load_feed(key, path)
        net["sources"].append(feed["source"])
        net["routes"] += feed["routes"]
        net["stops"] += feed["stops"]
        net["shapes"].update(feed["shapes"])
        net["trips"] += feed["trips"]
        net["services"].update(feed["services"])
        print(f"[{key}] 路線{len(feed['routes'])} バス停{len(feed['stops'])} 便{len(feed['trips'])} 形{len(feed['shapes'])}")

    # 使われていないバス停・形は捨てる
    used_stops = {s[0] for t in net["trips"] for s in t["st"]}
    used_shapes = {t["shape"] for t in net["trips"] if t["shape"]}
    net["stops"] = [s for s in net["stops"] if s["id"] in used_stops]
    net["shapes"] = {k: v for k, v in net["shapes"].items() if k in used_shapes}

    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(net, f, ensure_ascii=False, separators=(",", ":"))
    print(f"書き出し: {args.out}（路線{len(net['routes'])} バス停{len(net['stops'])} 便{len(net['trips'])}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
