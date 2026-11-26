import json, sys, time, urllib.parse, urllib.request
sys.stdout.reconfigure(encoding='utf-8')
d = json.load(open('stops_located.json', encoding='utf-8'))
# バス停名 → 国土地理院の住所検索に渡す語（町名・施設名）。バス停そのものの位置ではなく、目安の位置になる
Q = {
 '印西中学校': '印西市立印西中学校', '古新田': '千葉県印西市鹿黒', '鹿黒南': '千葉県印西市鹿黒南', '鹿黒南5丁目': '千葉県印西市鹿黒南五丁目',
 '大塚三丁目入口': '千葉県印西市大塚三丁目', '戸神': '千葉県印西市戸神', '武西学園台南': '千葉県印西市武西学園台', '滝': '千葉県印西市滝',
 '印西総合病院': '千葉県印西市牧の台一丁目', '別所谷津公園': '千葉県印西市牧の原四丁目', '原南街区公園': '千葉県印西市原',
 '牧の原3丁目': '千葉県印西市牧の原三丁目', '牧の原4丁目北': '千葉県印西市牧の原四丁目', '牧の原4丁目南': '千葉県印西市牧の原四丁目',
 '牧の原6丁目': '千葉県印西市牧の原六丁目', '牧の原小学校北': '千葉県印西市牧の原五丁目', '草深': '千葉県印西市草深', '西の原5丁目': '千葉県印西市西の原五丁目',
}
out = {}
for m in d['missing']:
    q = Q.get(m['name'])
    if not q: print('語なし', m['name']); continue
    url = 'https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + urllib.parse.quote(q)
    try:
        r = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'bus-map-builder'}), timeout=20))
    except Exception as e:
        print('失敗', m['name'], e); continue
    hit = [x for x in r if '印西市' in x['properties'].get('title', '')][:1]
    if hit:
        lon, lat = hit[0]['geometry']['coordinates']
        out[m['name']] = {'lat': round(lat, 6), 'lon': round(lon, 6), 'title': hit[0]['properties']['title'], 'q': q}
        print(m['name'], '→', hit[0]['properties']['title'], lat, lon)
    else:
        print('見つからず', m['name'], q, [x['properties'].get('title') for x in r[:3]])
    time.sleep(0.5)
json.dump(out, open('geocoded_missing.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
