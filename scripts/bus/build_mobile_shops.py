"""バスマップの「移動販売（移動スーパーなど）」の印のデータを作る。

一覧は、印西市「社会資源マップ 第4版」（2026年4月）の「移動販売をしているお店」（p.8・9・11）と、
市のお知らせ「平賀学園台で市と連携した移動スーパーの運行が開始しました」（2026年6月23日）から、運営が写したもの。
個人のお宅を1件ずつ回る販売（p.10 の戸別販売）は、場所が決まっていないので載せない。

場所の位置は、①バス停の名前（network.json） ②OpenStreetMap の地名検索（Nominatim・1秒に1回） ③国土地理院の住所検索（町名までの目安）
の順に調べる。③で決めたものには approx（位置はおおよそ）を付ける。どれでも見つからないものは、位置なし（一覧だけ）。
結果は --cache に貯め、2回目からは通信しない。

  python scripts/bus/build_mobile_shops.py --network public/bus/network.json --out public/bus/mobile_shops.json --cache C:/Temp/work/bus-map/super/geocache.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")

SRC_MAP = {"label": "印西市 社会資源マップ 第4版（2026年4月）", "url": "https://www.city.inzai.lg.jp/0000016245.html"}
SRC_KASUMI = {"label": "印西市のお知らせ（2026年6月23日）", "url": "https://www.city.inzai.lg.jp/0000021841.html"}

JA = {"op": "JA移動販売（とれたて産直館）", "tel": "0476-48-2200", "goods": "地元産のお米・旬の野菜・果物など", "src": SRC_MAP}
KASUMI = {"op": "カスミ移動スーパー", "tel": "029-850-1850", "goods": "生鮮食品・日配品・加工食品・弁当・日用品など", "src": SRC_MAP}
LAWSON = {"op": "ローソン移動販売", "tel": "0120-63-5499", "goods": "", "src": SRC_MAP}
YUME = {"op": "ゆめこうじょう（パンの移動販売）", "tel": "043-486-4166", "goods": "パン（約70種類）", "src": SRC_MAP}

# (事業者, 曜日, 時刻, 場所の名前, バス停名の手がかり, 地名検索の語, 住所検索の語)
ROWS = [
    (JA, "火曜日", "10:00〜", "木下東集会所つばき会館", "", "つばき会館", "千葉県印西市木下東"),
    (JA, "火曜日", "10:40〜", "木下東町内会防災倉庫前", "", "", "千葉県印西市木下東"),
    (JA, "火曜日", "11:20〜", "ビジネスホテル印西", "", "ビジネスホテル印西", ""),
    (JA, "火曜日", "12:40〜", "印西市役所 正面ロータリー", "市役所", "印西市役所", ""),
    (JA, "火曜日", "14:10〜", "牧の原公園 テニスコート脇駐車場", "", "牧の原公園", "千葉県印西市牧の原"),
    (JA, "水曜日", "10:00〜", "内野西団地 3号棟前", "", "内野西団地", "千葉県印西市内野"),
    (JA, "水曜日", "10:40〜", "内野団地 2-5-6棟前", "", "内野団地", "千葉県印西市内野"),
    (JA, "水曜日", "11:20〜", "内野南第二団地 うちのどんぐりハウス駐車場", "", "うちのどんぐりハウス", "千葉県印西市内野"),
    (JA, "水曜日", "13:30〜", "仲井集会所前", "", "仲井集会所", ""),
    (JA, "水曜日", "14:30〜", "木下駅前 山口サイクル駐車場", "木下駅南口", "", ""),
    (JA, "木曜日", "10:00〜", "高花一丁目 高花団地集会所脇", "", "", "千葉県印西市高花一丁目"),
    (JA, "木曜日", "10:40〜", "高花四丁目 高花第二団地管理事務所駐車場", "", "", "千葉県印西市高花四丁目"),
    (JA, "木曜日", "11:20〜", "千葉新都市ラーバンクリニック", "", "千葉新都市ラーバンクリニック", ""),
    (JA, "木曜日", "13:10〜", "小林大門下一丁目 小林物木雨水調整池内通路", "", "", "千葉県印西市小林大門下一丁目"),
    (JA, "木曜日", "14:00〜", "コスモス薬局印西店前", "", "コスモス薬局 印西店", ""),
    (JA, "木曜日", "15:00〜", "平賀学園台自治会館 テニスコート前", "", "平賀学園台自治会館", "千葉県印西市平賀学園台"),
    (JA, "金曜日", "10:15〜", "吉高台団地内 浄化槽施設周辺", "吉高台", "", ""),
    (JA, "金曜日", "11:00〜", "ウェルガーデン団地 A棟南口前広場", "ウェルガーデン", "", ""),
    (JA, "金曜日", "11:40〜", "日本医科大学千葉北総病院", "日本医大千葉北総病院", "", ""),
    (JA, "金曜日", "14:00〜", "木下東二丁目 旧ヤマザキ駐車場", "木下東二丁目", "", "千葉県印西市木下東二丁目"),
    (JA, "金曜日", "14:30〜", "木下東三丁目 愛の家グループホーム", "木下東三丁目", "愛の家グループホーム印西", "千葉県印西市木下東三丁目"),
    (KASUMI, "月曜日", "11:10〜11:30", "グループホーム秋桜", "", "グループホーム秋桜", ""),
    (KASUMI, "火曜日", "14:45〜15:00", "ウェルガーデン", "ウェルガーデン", "", ""),
    (KASUMI, "火曜日", "15:20〜15:30", "桜苑西の原団地", "", "桜苑西の原", "千葉県印西市西の原"),
    ({**KASUMI, "op": "カスミ移動スーパー（市と連携）", "tel": "070-1379-5160", "src": SRC_KASUMI}, "火曜日", "10:45〜", "さざなみ第2公園（平賀学園台2丁目21）", "", "さざなみ第2公園", "千葉県印西市平賀学園台二丁目"),
    (LAWSON, "第3水曜日", "13:00〜", "トミオコスモステラス印西", "", "コスモステラス印西", ""),
    (LAWSON, "第1・第3土曜日", "12:30〜", "戸神ホームズ", "", "戸神ホームズ", "千葉県印西市戸神"),
    (YUME, "第2・第4木曜日", "14:15〜", "農産物直売所やおやさん草深店", "", "やおやさん草深店", "千葉県印西市草深"),
    (YUME, "金曜日", "8:55〜", "小林コミュニティプラザ", "小林コミュニティプラザ前", "", ""),
    (YUME, "金曜日", "10:00〜", "コスモス薬局印西店", "", "コスモス薬局 印西店", ""),
    (YUME, "金曜日", "10:15〜", "(有)いしかわ あすか典礼", "", "あすか典礼", ""),
    (YUME, "金曜日", "10:35〜", "岩井豆腐店", "", "岩井豆腐店", ""),
    (YUME, "金曜日", "10:50〜", "JA西印旛居宅介護支援事業所", "", "JA西印旛", ""),
    (YUME, "金曜日", "11:00〜", "大野農機", "", "大野農機", ""),
    (YUME, "金曜日", "11:15〜", "中央公民館", "中央公民館", "印西市立中央公民館", ""),
    (YUME, "金曜日", "11:25〜", "印西市木下交流の杜資料館", "", "木下交流の杜歴史資料センター", ""),
    (YUME, "金曜日", "11:35〜", "印西警察署", "", "印西警察署", ""),
    (YUME, "金曜日", "11:50〜", "印西市文化ホール", "", "印西市文化ホール", ""),
    (YUME, "金曜日", "12:05〜", "印西市社会福祉協議会", "総合福祉センター", "印西市社会福祉協議会", ""),
    (YUME, "金曜日", "13:00〜", "ケアサポート印西", "", "ケアサポート印西", ""),
]

BOX = (35.72, 35.87, 140.08, 140.27)  # 印西市のまわり


def get_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "bus-map-builder"})
    return json.load(urllib.request.urlopen(req, timeout=25))


def in_box(lat: float, lon: float) -> bool:
    return BOX[0] <= lat <= BOX[1] and BOX[2] <= lon <= BOX[3]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--network", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--cache", required=True)
    args = ap.parse_args()

    stops = {}
    for s in json.load(open(args.network, encoding="utf-8"))["stops"]:
        stops.setdefault(s["name"], (s["lat"], s["lon"]))
    cache = json.load(open(args.cache, encoding="utf-8")) if os.path.exists(args.cache) else {}

    def nominatim(q: str):
        key = "n:" + q
        if key not in cache:
            url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
                {"q": q, "format": "json", "limit": 3, "countrycodes": "jp", "viewbox": f"{BOX[2]},{BOX[1]},{BOX[3]},{BOX[0]}", "bounded": 1})
            try:
                r = get_json(url)
                cache[key] = [[float(x["lat"]), float(x["lon"]), x["display_name"][:60]] for x in r]
            except Exception as e:
                print("  地名検索に失敗:", q, e)
                return None
            time.sleep(1.2)
        hits = [h for h in cache[key] if in_box(h[0], h[1])]
        return hits[0] if hits else None

    def gsi(q: str):
        key = "g:" + q
        if key not in cache:
            try:
                r = get_json("https://msearch.gsi.go.jp/address-search/AddressSearch?q=" + urllib.parse.quote(q))
                cache[key] = [[x["geometry"]["coordinates"][1], x["geometry"]["coordinates"][0], x["properties"]["title"]] for x in r if "印西市" in x["properties"].get("title", "")][:1]
            except Exception as e:
                print("  住所検索に失敗:", q, e)
                return None
            time.sleep(0.5)
        return cache[key][0] if cache[key] else None

    items, no_pos = [], []
    for info, day, tm, place, stop_hint, nq, gq in ROWS:
        pos, how, approx = None, "", ""
        if stop_hint and stop_hint in stops:
            pos, how = stops[stop_hint], f"バス停「{stop_hint}」の位置"
            approx = "近くのバス停の位置です（販売の場所そのものではありません）"
        if not pos and nq:
            h = nominatim(nq)
            if h:
                pos, how = (h[0], h[1]), f"OpenStreetMap「{h[2]}」"
        if not pos and gq:
            h = gsi(gq)
            if h:
                pos, how = (h[0], h[1]), f"国土地理院の住所検索「{h[2]}」"
                approx = "町の代表点です（販売の場所そのものではありません）"
        item = {"op": info["op"], "tel": info["tel"], "goods": info["goods"], "day": day, "time": tm, "place": place,
                "src": info["src"]["label"], "srcUrl": info["src"]["url"]}
        if pos:
            item.update({"lat": round(pos[0], 6), "lon": round(pos[1], 6)})
            if approx:
                item["approx"] = approx
        else:
            no_pos.append(place)
        items.append(item)
        print(f"{'○' if pos else '×'} {info['op'][:8]} {day} {tm} {place} ← {how or '位置なし'}{'（目安）' if approx else ''}")
    json.dump(cache, open(args.cache, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    out = {"asOf": "2026年4月（社会資源マップ 第4版）・2026年6月（平賀学園台）", "note": "運行の日時・場所は変わることがあります。行く前に、各事業者へお問い合わせください。", "items": items}
    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    n = sum(1 for i in items if "lat" in i)
    print(f"全{len(items)}件／地図に置ける {n}（うち目安 {sum(1 for i in items if i.get('approx'))}）／位置なし {len(no_pos)}: {'・'.join(no_pos)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
