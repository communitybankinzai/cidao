// node scripts/build-disaster-road-places.cjs <map/pipeline/osm_roads_raw.json> <map/underpass-mlit.json>
// Uses already downloaded open data; no API calls or invented coordinates.
const fs = require('node:fs');
const path = require('node:path');
const [osmPath, underpassPath] = process.argv.slice(2);
if (!osmPath || !underpassPath) throw new Error('Pass OSM road JSON and MLIT underpass JSON paths');
const osm = JSON.parse(fs.readFileSync(osmPath, 'utf8'));
const mlit = JSON.parse(fs.readFileSync(underpassPath, 'utf8'));
const groups = new Map();
const inArea = p => p.lat >= 35.72 && p.lat <= 35.92 && p.lon >= 140.03 && p.lon <= 140.34;
for (const e of osm.elements) {
  const name = e.tags?.['bridge:name'] || e.tags?.['name:ja'] || e.tags?.name;
  if (!name || !/(橋|隧道|トンネル)$/.test(name) || !e.geometry?.length || !e.geometry.every(inArea)) continue;
  const group = groups.get(name) || []; group.push(e); groups.set(name, group);
}
const points = [];
for (const [name, elements] of groups) {
  const ps = elements.flatMap(e => e.geometry), ys = ps.map(p => p.lat), xs = ps.map(p => p.lon);
  // Duplicate names in separated places and long road sections are not resolvable to one point.
  if (Math.hypot((Math.max(...ys) - Math.min(...ys)) * 111000, (Math.max(...xs) - Math.min(...xs)) * 90000) > 500) continue;
  const p = ps[Math.floor(ps.length / 2)];
  points.push({ name, aliases: [name], lat: p.lat, lng: p.lon,
    sourceUrl: 'https://www.openstreetmap.org/way/' + elements[0].id,
    basis: 'OpenStreetMapの橋・隧道の代表点（2026-07-24取得、付近の位置の目安）' });
}
for (const p of mlit.points.filter(inArea)) points.push({ name: p.name, aliases: [p.name], lat: p.lat, lng: p.lon,
  sourceUrl: mlit.source.url, basis: '国土交通省アンダーパス箇所マップの地点（2026-09-23取得）' });
const credit = '国土交通省 全国のアンダーパス箇所マップ（公共データ利用規約1.0）および © OpenStreetMap contributors（ODbL 1.0）を加工';
fs.writeFileSync(path.join(__dirname, '../src/lib/disaster-sns-road-places.json'), JSON.stringify({ credit, points }, null, 2) + '\n');
console.log(`Saved ${points.length} precise named road landmarks`);
