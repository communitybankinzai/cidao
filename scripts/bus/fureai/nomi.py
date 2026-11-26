import json, sys, time, urllib.parse, urllib.request
sys.stdout.reconfigure(encoding='utf-8')
Q = {'印西中学校': '印西市立印西中学校', '印西総合病院': '印西総合病院', '別所谷津公園': '別所谷津公園', '牧の原小学校北': '印西市立牧の原小学校', '原南街区公園': '原南街区公園'}
out = {}
for name, q in Q.items():
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode({'q': q, 'format': 'json', 'limit': 3, 'countrycodes': 'jp', 'viewbox': '140.02,35.89,140.30,35.72', 'bounded': 1})
    r = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'bus-map-builder'}), timeout=20))
    print(name, '→', [(x['lat'], x['lon'], x['display_name'][:50]) for x in r[:2]])
    if r: out[name] = {'lat': round(float(r[0]['lat']), 6), 'lon': round(float(r[0]['lon']), 6), 'title': r[0]['display_name'][:60]}
    time.sleep(1.2)
json.dump(out, open('nominatim_missing.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
