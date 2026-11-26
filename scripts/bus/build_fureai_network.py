"""ふれあいバス（印西市のコミュニティバス）の時刻表を、バスマップ用のデータ（network.json と同じ形のかけら）にする。

入力（作業フォルダ・--work）:
  parsed.json          … 市の時刻表PDF（令和8年2月1日改正）を座標で読み取ったもの（parse_timetables.py）
  stops_located.json   … バス停名に位置を付けたもの（match_stops.py。国土数値情報 バス停留所 2022年 ほか）
  geocoded_missing.json／nominatim_missing.json … 上で位置が無かったバス停の、町名・施設の目安の位置
出力: scripts/bus/data/fureai.json（build_bus_data.py の --json fureai=… で network.json に混ぜる）

GTFS が公開されていないため、CBI が市の時刻表から起こしたもの。路線の形は持たない
（バスの位置は、バス停どうしを直線で結んで時刻で按分した予測）。位置が目安のバス停には approx を付ける。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata

sys.stdout.reconfigure(encoding="utf-8")

ROUTES = {
    "makinohara": ("ふれあいバス 牧の原循環ルート", "EA580C"),
    "higashi": ("ふれあいバス 東ルート", "9333EA"),
    "naka": ("ふれあいバス 中ルート", "0D9488"),
    "nishi": ("ふれあいバス 西ルート", "CA8A04"),
    "minami": ("ふれあいバス 南ルート", "DB2777"),
    "fusa": ("ふれあいバス 布佐ルート", "4F46E5"),
    "shisho": ("ふれあいバス 印旛・本埜支所ルート", "65A30D"),
}
AGENCY = "印西市 ふれあいバス（運行：京成バス千葉セントラル）"
AGENCY_URL = "https://www.city.inzai.lg.jp/0000017347.html"
AGENCY_TEL = "0476460022"
START = "20260201"  # 令和8年2月1日改正


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s)
    s = re.sub(r"\((着|発)\)", "", s)
    s = re.sub(r"\(.*?\)", "", s)
    s = s.replace("ヶ", "ケ").replace("千葉ニュータウン", "千葉NT").replace(" ", "").replace("　", "")
    for a, b in zip("一二三四五六七八九", "123456789"):
        s = s.replace(a + "丁目", b + "丁目")
    return s


def clean_name(s: str) -> str:
    return re.sub(r"\((着|発)\)", "", unicodedata.normalize("NFKC", s)).strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--holidays-from", default="", help="祝日の一覧を借りる network.json（印西市のGTFSの「平日」から外れている日）")
    args = ap.parse_args()

    def load(name: str, default):
        path = os.path.join(args.work, name)
        return json.load(open(path, encoding="utf-8")) if os.path.exists(path) else default

    parsed = load("parsed.json", [])
    located = load("stops_located.json", {"stops": {}})["stops"]
    approx = {}
    approx.update({norm(k): {**v, "how": "町名の代表点（国土地理院の住所検索）"} for k, v in load("geocoded_missing.json", {}).items()})
    approx.update({norm(k): {**v, "how": "近くの施設の位置（OpenStreetMap）"} for k, v in load("nominatim_missing.json", {}).items()})

    holidays: list[str] = []
    if args.holidays_from:
        net = json.load(open(args.holidays_from, encoding="utf-8"))
        for sid, sv in net["services"].items():
            if sv["days"][:5] == [1, 1, 1, 1, 1] and sv["days"][5:] == [0, 0]:
                holidays = sorted(set(sv["remove"]))
                break
    # 牧の原循環は「12/30〜1/3は土日祝日便」
    year_end = []
    for y in (2026, 2027, 2028):
        year_end += [f"{y}1230", f"{y}1231", f"{y+1}0101", f"{y+1}0102", f"{y+1}0103"]
    special = sorted(set(holidays + year_end))

    services = {
        "fureai:毎日": {"days": [1] * 7, "start": START, "end": "", "add": [], "remove": []},
        "fureai:平日": {"days": [1, 1, 1, 1, 1, 0, 0], "start": START, "end": "", "add": [], "remove": special},
        "fureai:土日祝": {"days": [0, 0, 0, 0, 0, 1, 1], "start": START, "end": "", "add": special, "remove": []},
    }

    stops: dict[str, dict] = {}
    no_pos: set[str] = set()

    def stop_id(name: str) -> str | None:
        key = norm(name)
        sid = "fureai:" + key
        if sid in stops:
            return sid
        if key in located:
            v = located[key]
            stops[sid] = {"id": sid, "name": clean_name(name), "lat": v["lat"], "lon": v["lon"]}
        elif key in approx:
            v = approx[key]
            stops[sid] = {"id": sid, "name": clean_name(name), "lat": v["lat"], "lon": v["lon"], "approx": v["how"]}
        else:
            no_pos.add(clean_name(name))
            return None
        return sid

    routes, trips = [], []
    for key, (rname, color) in ROUTES.items():
        routes.append({"id": "fureai:" + key, "name": rname, "color": color, "agency": AGENCY, "agencyUrl": AGENCY_URL, "agencyTel": AGENCY_TEL, "feed": "fureai"})
    for tb in parsed:
        cap = tb["caption"].strip("()（）")
        if "平日" in cap:
            service, head = "fureai:平日", "循環"
        elif "祝" in cap:
            service, head = "fureai:土日祝", "循環"
        else:
            service, head = "fureai:毎日", (cap if cap.endswith("回り") else "")
        for tr in tb["trips"]:
            st: list[list] = []
            for s, t in zip(tb["stops"], tr["times"]):
                if t is None:
                    continue
                sid = stop_id(s["name"])
                if sid is None:
                    continue
                if st and st[-1][0] == sid:  # (着)(発) の2行：着く時刻と出る時刻にまとめる
                    st[-1][2] = t
                else:
                    st.append([sid, t, t])
            if len(st) < 2:
                continue
            last_name = stops[st[-1][0]]["name"]
            num = re.sub(r"\D", "", tr["label"])
            trips.append({
                "id": f"fureai:{tb['route']}:{service.split(':')[1]}:{cap}:{num}",
                "route": "fureai:" + tb["route"],
                "service": service,
                "headsign": head or last_name,
                "shape": "",
                "st": st,
            })

    out = {
        "source": {"key": "fureai", "publisher": "印西市 ふれあいバス（市の時刻表PDFからCBIが作成）", "start": START, "end": "", "version": "令和8年2月1日改正"},
        "routes": routes,
        "stops": list(stops.values()),
        "shapes": {},
        "trips": trips,
        "services": services,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    ap_n = sum(1 for s in stops.values() if s.get("approx"))
    print(f"路線{len(routes)} バス停{len(stops)}（うち位置が目安 {ap_n}） 便{len(trips)} 祝日など{len(special)}日")
    if no_pos:
        print("⚠ 位置が無く、載せていないバス停:", "・".join(sorted(no_pos)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
