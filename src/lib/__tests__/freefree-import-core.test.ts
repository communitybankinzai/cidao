import { test, expect } from 'vitest'
import {
  addressKey, nameKeys, normalizePhone, websiteHost, DedupIndex, postToDedupRecord, toCandidateDraft,
  mapCategory, collectByBbox, buildPostDraft, checkPublishable, inTargetCity, makeSourceId, normalizeDisplayText, findRiskyPhrases, areaLabelFromLocation, areaFromAddress, buildIntroPrompt, sanitizeIntro,
  bboxFromCenter, bboxWithinLimit, isValidBbox, IMPORT_NOTICE, SEARCH_LIMIT,
  type OpenpoiFacility, type Bbox,
} from '../freefree-import-core'
import { FREEFREE_CATEGORIES } from '../freefree-categories'

const assert = {
  ok: (v: unknown, _msg?: string) => expect(v).toBeTruthy(),
  equal: (a: unknown, b: unknown, _msg?: string) => expect(a).toBe(b),
}

test('店名の表記揺れ: 法人格・全半角・スペース・ハイフン・支店名', () => {
  const k = (s: string) => nameKeys(s)
  assert.ok(k('株式会社ABC').includes('abc'))
  assert.ok(k('（株）ABC').includes('abc'))
  assert.ok(k('ABC').includes('abc'))
  assert.ok(k('ＡＢＣ 印西店').includes('abc'))
  assert.ok(k('ABC印西市店').includes('abc'))
  assert.equal(k('カフェ・ド－ナツ')[0], k('カフェドナツ')[0])
  assert.ok(k('ＡＢＣ  カフェ')[0] === k('abcカフェ')[0])
  assert.ok(k('らーめん太郎')[0] === k('ラーメン太郎')[0], 'ひらがな/カタカナ')
})

test('住所キー: 丁目番地・漢数字・全角・都道府県・建物名', () => {
  const a = addressKey('千葉県印西市大塚一丁目３番地')
  assert.equal(a, addressKey('印西市大塚1-3'))
  assert.equal(a, addressKey('千葉県印西市大塚１丁目３番２号 ABCビル2F').replace(/-2$/, ''))
  assert.equal(addressKey('印西市'), '', '数字が無い住所は特定力なし')
  assert.equal(addressKey(''), '')
})

test('電話・URL', () => {
  assert.equal(normalizePhone('０４７６-４２-１２３４'), '0476421234')
  assert.equal(normalizePhone('12'), '')
  assert.equal(websiteHost('https://www.Example.com/a'), 'example.com')
  assert.equal(websiteHost('example.com'), 'example.com')
})

const post = (o: Partial<Parameters<typeof postToDedupRecord>[0]> & { id: string; title: string }) => postToDedupRecord(o)

test('重複判定: 名称+住所一致=duplicate', () => {
  const idx = new DedupIndex([post({ id: 'p1', title: '株式会社ABC', address: '千葉県印西市大塚1-3' })])
  const r = idx.judge({ name: 'ABC', address: '印西市大塚一丁目3番', lat: null, lon: null })
  assert.equal(r.status, 'duplicate')
  assert.equal(r.matchId, 'p1')
})

test('重複判定: 名称+座標近似=possible / 遠い=none', () => {
  const idx = new DedupIndex([post({ id: 'p1', title: 'ABC印西店', lat: 35.8, lon: 140.12 })])
  assert.equal(idx.judge({ name: 'ABC', address: null, lat: 35.8004, lon: 140.1203 }).status, 'possible')
  assert.equal(idx.judge({ name: 'ABC', address: null, lat: 35.85, lon: 140.2 }).status, 'none')
})

test('重複判定: 名称+電話=duplicate, 名称+Web=possible', () => {
  const idx = new DedupIndex([
    { kind: 'candidate', id: 'c1', name: 'パン工房ミナミ', address: null, lat: 35.7, lon: 140.0, phone: '0476-42-1234' },
    { kind: 'candidate', id: 'c2', name: 'こむぎ堂', address: null, lat: 35.7, lon: 140.0, website: 'https://www.komugi.example/' },
  ])
  assert.equal(idx.judge({ name: 'パン工房ミナミ', address: null, lat: 35.9, lon: 140.2, phone: '0476421234' }).status, 'duplicate')
  assert.equal(idx.judge({ name: 'こむぎ堂', address: null, lat: 35.9, lon: 140.2, website: 'komugi.example' }).status, 'possible')
})

test('重複判定: 別名の店は none・自分自身は除外', () => {
  const idx = new DedupIndex([{ kind: 'candidate', id: 'c1', name: 'ABC', address: '印西市大塚1-3', lat: 35.8, lon: 140.12 }])
  assert.equal(idx.judge({ name: 'XYZ', address: '印西市大塚1-3', lat: 35.8, lon: 140.12 }).status, 'none')
  assert.equal(idx.judge({ selfId: 'c1', name: 'ABC', address: '印西市大塚1-3', lat: 35.8, lon: 140.12 }).status, 'none')
})

test('重複判定: 名称の部分一致+近い=possible', () => {
  const idx = new DedupIndex([post({ id: 'p1', title: '焼肉レストラン太郎', lat: 35.8, lon: 140.12 })])
  assert.equal(idx.judge({ name: '焼肉レストラン太郎 千葉NT中央店', address: null, lat: 35.8001, lon: 140.1201 }).status, 'possible')
})

test('カテゴリー変換: 既知・名称ヒント・未分類・FreeFreeに存在するキーのみ', () => {
  const keys = new Set<string>(FREEFREE_CATEGORIES.map((c) => c.key))
  for (const c of ['restaurant', 'cafe', 'retail_other', 'education', 'medical', 'service_other', 'tourism', 'public_facility', 'grocery', 'bakery', 'fast_food', 'bar_izakaya', 'lodging']) {
    const m = mapCategory(c, c, 'x')
    assert.ok(m.key && keys.has(m.key), c)
  }
  assert.equal(mapCategory('unknown', 'unknown', '〇〇事務所').key, null)
  assert.equal(mapCategory('unknown', 'unknown', 'ラーメン太郎').key, 'food')
  assert.equal(mapCategory(null, null, 'ほげ').key, null)
})

test('OpenPOI→候補: 座標・名称なしは捨て、source_idは安定', () => {
  const f: OpenpoiFacility = { name: 'ＡＢＣ', city: '印西市', lat: '35.8', lng: 140.1, category: 'cafe', licenses: ['CC0-1.0'], attributions: ['x'] }
  const d = toCandidateDraft(f)!
  assert.equal(d.category, 'food')
  assert.equal(d.source_id, makeSourceId('abc', 35.8, 140.1))
  assert.equal(toCandidateDraft({ name: 'x', lat: '', lng: '' }), null)
  assert.equal(toCandidateDraft({ name: '', lat: 1, lng: 1 }), null)
  assert.equal(toCandidateDraft({ ...f, licenses: undefined })!.licenses.length, 0)
})

test('市区町村の絞り込み', () => {
  assert.ok(inTargetCity({ city: '印西市' }, '印西市'))
  assert.ok(!inTargetCity({ city: '白井市' }, '印西市'))
  assert.ok(inTargetCity({ city: '', address: '千葉県印西市大塚1' }, '印西市'))
  assert.ok(!inTargetCity({ city: '', address: '' }, '印西市'))
})

test('bbox 分割取得: 200件で分割・境界重複を除去・件数上限で打ち切り', async () => {
  const total = 450
  const all: OpenpoiFacility[] = Array.from({ length: total }, (_, i) => ({ name: `店${i}`, lat: 35 + (i % 30) * 0.01, lng: 140 + Math.floor(i / 30) * 0.01, source: 'overture' }))
  const fetcher = async (b: Bbox) => all.filter((f) => (f.lng as number) >= b[0] && (f.lng as number) <= b[2] && (f.lat as number) >= b[1] && (f.lat as number) <= b[3]).slice(0, SEARCH_LIMIT)
  const r = await collectByBbox(fetcher, [139.9, 34.9, 140.3, 35.4], { delayMs: 0 })
  assert.equal(r.facilities.length, total)
  assert.ok(r.requests > 1)
  assert.equal(r.aborted, false)
  assert.equal(r.truncatedCells, 0)
  const r2 = await collectByBbox(fetcher, [139.9, 34.9, 140.3, 35.4], { delayMs: 0, maxRequests: 2 })
  assert.equal(r2.aborted, true)
  assert.ok(r2.truncatedCells > 0)
  const r3 = await collectByBbox(fetcher, [139.9, 34.9, 140.3, 35.4], { delayMs: 0, deadlineAt: 0, now: () => 1 })
  assert.equal(r3.requests, 0)
  assert.equal(r3.aborted, true)
})

test('bbox 検証・center変換', () => {
  assert.ok(isValidBbox([140, 35, 141, 36]))
  assert.ok(!isValidBbox([141, 35, 140, 36]))
  assert.ok(!isValidBbox([1, 2, 3]))
  assert.ok(bboxWithinLimit([140.05, 35.72, 140.3, 35.9]))
  assert.ok(!bboxWithinLimit([130, 30, 141, 40]))
  const b = bboxFromCenter(35.8, 140.15, 1000)
  assert.ok(b[0] < 140.15 && b[2] > 140.15 && b[1] < 35.8 && b[3] > 35.8)
})

test('投稿内容: タイトル40字・本文1000字・編集優先・出典注記', () => {
  const c = { name: 'あ'.repeat(60), prefecture: '千葉県', city: '印西市', address: null, openpoi_category: 'cafe', category: 'food', phone: null, website: null, opening_hours: null, description: null }
  const d = buildPostDraft(c)
  assert.ok(Array.from(d.title).length <= 40)
  assert.ok(d.body.includes(IMPORT_NOTICE))
  assert.equal(d.location, '千葉県印西市')
  const e = buildPostDraft(c, { title: '編集後', phone: '0476-00-0000', website: 'https://ex.example', category: 'retail' })
  assert.equal(e.title, '編集後')
  assert.equal(e.category, 'retail')
  assert.ok(e.body.includes('0476-00-0000'))
  assert.equal(e.links[0].url, 'https://ex.example')
  assert.ok(Array.from(buildPostDraft(c, { body: 'x'.repeat(2000) }).body).length <= 1000)
})

test('登録可否: 重複・未分類・登録済み・除外は止める', () => {
  const draft = { title: 't', body: 'b', category: 'food', location: null, address: null, links: [] }
  const ok = { import_status: 'candidate', duplicate_status: 'none' }
  assert.equal(checkPublishable(ok, draft).ok, true)
  assert.equal(checkPublishable({ ...ok, import_status: 'imported' }, draft).ok, false)
  assert.equal(checkPublishable({ ...ok, import_status: 'excluded' }, draft).ok, false)
  assert.equal(checkPublishable({ ...ok, duplicate_status: 'duplicate' }, draft).ok, false)
  assert.equal(checkPublishable({ ...ok, duplicate_status: 'duplicate' }, draft, { allowDuplicate: true }).ok, true)
  assert.equal(checkPublishable({ ...ok, duplicate_status: 'possible' }, draft).ok, false)
  assert.equal(checkPublishable({ ...ok, duplicate_status: 'possible' }, draft, { confirmPossible: true }).ok, true)
  assert.equal(checkPublishable(ok, { ...draft, category: null }).ok, false)
})

test('表示用の正規化: 全角の英数字・ハイフンを半角に。店名の長音は残す', () => {
  expect(normalizeDisplayText('千葉県印西市武西１２０５－４９')).toBe('千葉県印西市武西1205-49')
  expect(normalizeDisplayText('印西市大森２５３５ー１')).toBe('印西市大森2535-1')
  expect(normalizeDisplayText('木まぐれＫｏｐｉｔｉａｍ')).toBe('木まぐれKopitiam')
  expect(normalizeDisplayText('コーヒー　ショップ')).toBe('コーヒー ショップ')
  expect(normalizeDisplayText('ﾗｰﾒﾝ太郎')).toBe('ラーメン太郎')
})

test('投稿内容: OpenPOI由来の全角は半角にそろえ、運営の編集は変えない', () => {
  const c = { name: 'ＡＢＣ食堂', prefecture: '千葉県', city: '印西市', address: '千葉県印西市武西１２０５－４９', openpoi_category: 'restaurant', category: 'food', phone: null, website: null, opening_hours: null, description: null }
  const d = buildPostDraft(c)
  expect(d.title).toBe('ABC食堂')
  expect(d.address).toBe('千葉県印西市武西1205-49')
  expect(d.body).toContain('武西1205-49')
  expect(d.location).toBe('千葉県印西市武西1205-49')
  expect(buildPostDraft(c, { address: '武西１２０５' }).address).toBe('武西１２０５')
})

test('投稿内容: 紹介文・営業時間を入れると本文に入る（紹介文が先頭）', () => {
  const c = { name: 'ABC食堂', prefecture: '千葉県', city: '印西市', address: '印西市大塚1-3', openpoi_category: 'restaurant', category: 'food', phone: null, website: null, opening_hours: null, description: null }
  const d = buildPostDraft(c, { description: 'マレーシア料理のお店です。', opening_hours: '11:00〜20:00（月曜定休）' })
  expect(d.body.startsWith('マレーシア料理のお店です。')).toBe(true)
  expect(d.body).toContain('🕐 営業時間：11:00〜20:00（月曜定休）')
  expect(buildPostDraft(c).body).not.toContain('🕐')
  expect(buildPostDraft({ ...c, description: 'DB由来の説明' }).body.startsWith('DB由来の説明')).toBe(true)
  expect(buildPostDraft(c, { description: '', body: '手書き本文' }).body).toBe('手書き本文')
})

test('紹介文: 評価・推測の言葉を見つける（全角半角・大小は吸収）', () => {
  expect(findRiskyPhrases('武西にある飲食店です。')).toEqual([])
  expect(findRiskyPhrases('地元で人気の老舗です。おいしい料理がリーズナブル。').sort()).toEqual(['人気', 'おいしい', 'リーズナブル', '老舗'].sort())
  expect(findRiskyPhrases('ＮＯ．１の店')).toEqual(['No.1'])
  expect(findRiskyPhrases('no.1です')).toEqual(['No.1'])
})

test('紹介文: 住所から町名を取り出す', () => {
  expect(areaFromAddress('千葉県印西市武西１２０５－４９', '印西市')).toBe('武西')
  expect(areaFromAddress('印西市大塚1-3', '印西市')).toBe('大塚')
  expect(areaFromAddress('', '印西市')).toBe(null)
  expect(areaFromAddress('印西市', '印西市')).toBe(null)
})

test('紹介文: 指示に事実・禁止事項・参考テキストが入る', () => {
  const facts = { name: 'ABC食堂', kind: '飲食店', prefecture: '千葉県', city: '印西市', area: '武西', address: '千葉県印西市武西1205-49' }
  const a = buildIntroPrompt(facts, '')
  expect(a.system).toContain('口コミ')
  expect(a.system).toContain('推測')
  expect(a.user).toContain('店名：ABC食堂')
  expect(a.user).toContain('千葉県印西市武西')
  expect(a.user).toContain('参考テキスト】なし')
  const b = buildIntroPrompt(facts, '11時から20時まで営業しています。')
  expect(b.user).toContain('11時から20時まで営業しています。')
  expect(b.user).not.toContain('参考テキスト】なし')
  expect(buildIntroPrompt(facts, 'あ'.repeat(9000)).user.length).toBeLessThan(5000)
})

test('紹介文: AIの返答を整える', () => {
  expect(sanitizeIntro('  「武西にある飲食店です。」\n')).toBe('武西にある飲食店です。')
  expect(sanitizeIntro('紹介文：武西にある店です。')).toBe('武西にある店です。')
  expect(sanitizeIntro('   ')).toBe(null)
  expect(Array.from(sanitizeIntro('あ'.repeat(800))!).length).toBe(500)
})

test('エリア表記: 所在地から「市＋町名」を取り出す', () => {
  expect(areaLabelFromLocation('千葉県印西市武西１２０５－４９')).toBe('印西市武西')
  expect(areaLabelFromLocation('印西市大塚1-3')).toBe('印西市大塚')
  expect(areaLabelFromLocation('千葉県印西市')).toBe('印西市')
  expect(areaLabelFromLocation('')).toBe(null)
  expect(areaLabelFromLocation(null)).toBe(null)
})
