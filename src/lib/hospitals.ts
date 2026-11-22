// 印西市の医療機関（医科・歯科）の一覧。画面は /hospitals（病院マップ・2026-11-23）。
// もとの資料：
//   ・印西市「印西市内の医療機関」（令和8年8月1日現在）＝名前・電話・所在地・診療科。市のホームページでの公開に医療機関が了解したものだけが載っている
//   ・厚生労働省「医療情報ネット」のオープンデータ（2026年6月1日時点・CC BY 4.0）＝位置・公式サイト
//   ・位置が国のデータに無いものは、同じ建物の医療機関の位置か、国土地理院の住所検索で補った（approx＝丁目までしか分からず、おおよその位置）
// 診療日・診療時間は載せない（変わりやすく、古い時間を見て行くと閉まっていることがあるため）。歯科は 2026-11-23 に足した（位置・公式サイト・診療科は国の歯科診療所のデータ）。
// 直すとき：市の一覧が新しくなったら HOSPITALS_AS_OF を変え、名前・電話・所在地を照らし合わせる。作り直しの道具は C:/Temp/oneoff/iryo/build.py・build_dental.py（控え）。

export const HOSPITALS_AS_OF = '2026年8月1日'
export const HOSPITALS_CITY_URL = 'https://www.city.inzai.lg.jp/0000021700.html'
export const HOSPITALS_EMERGENCY_URL = 'https://www.city.inzai.lg.jp/0000001776.html'
export const HOSPITALS_MHLW_URL = 'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/iryou/newpage_43373.html'

export type Hospital = {
  id: string
  name: string
  kind: '病院' | '診療所' | '歯科'
  /** 電話（市の一覧にあるものだけ。無いときは空） */
  tel: string
  addr: string
  /** 建物の名前・階 */
  bld: string
  dept: string[]
  /** 公式サイト（国のデータにあるものだけ） */
  url: string
  lat: number
  lon: number
  /** 位置がおおよそ（丁目まで） */
  approx: boolean
  /** 市の一覧に無く、国のデータだけにある */
  natOnly: boolean
}

export const HOSPITALS: Hospital[] = [
  { id: 'h01', name: "安孫子内科胃腸科クリニック", kind: "診療所", tel: "0476-42-2649", addr: "印西市大森3417-2", bld: "", dept: ["内科", "胃腸科"], url: "", lat: 35.836643, lon: 140.142471, approx: false, natOnly: false },
  { id: 'h02', name: "印西診療所", kind: "診療所", tel: "0476-42-5011", addr: "印西市大森2550-10", bld: "", dept: ["内科", "小児科", "泌尿器科", "呼吸器内科", "循環器内科"], url: "", lat: 35.835114, lon: 140.145599, approx: false, natOnly: false },
  { id: 'h03', name: "大久保メディカルクリニック", kind: "診療所", tel: "0476-33-7120", addr: "印西市鹿黒南3-2-6", bld: "", dept: ["内科", "消化器内科", "内視鏡内科", "肝臓内科", "循環器内科", "整形外科", "リハビリテーション科"], url: "", lat: 35.817455, lon: 140.136932, approx: true, natOnly: false },
  { id: 'h04', name: "皮膚科伊藤医院", kind: "診療所", tel: "0476-42-2645", addr: "印西市木下1509-45", bld: "", dept: ["皮膚科"], url: "", lat: 35.839026, lon: 140.152851, approx: false, natOnly: false },
  { id: 'h05', name: "岩井内科クリニック", kind: "診療所", tel: "0476-46-7665", addr: "印西市高花5-1-1", bld: "", dept: ["内科", "胃腸科", "循環器科"], url: "", lat: 35.795616, lon: 140.133521, approx: false, natOnly: false },
  { id: 'h06', name: "斉藤おとな＆こども眼科クリニック", kind: "診療所", tel: "0476-47-0303", addr: "印西市高花5-1-3", bld: "", dept: ["眼科"], url: "http://www.saitoganka.com/annai.html", lat: 35.795611, lon: 140.133843, approx: false, natOnly: false },
  { id: 'h07', name: "すこやか内科クリニック印西", kind: "診療所", tel: "0476-33-6585", addr: "印西市戸神604-16", bld: "", dept: ["一般内科", "糖尿病内科", "腎臓内科"], url: "https://www.sukoyaka-naika.net/", lat: 35.793963, lon: 140.118561, approx: false, natOnly: false },
  { id: 'h08', name: "印西千葉ニュータウン頭痛・脳神経内科クリニック", kind: "診療所", tel: "0476-36-4798", addr: "印西市中央北1-1", bld: "APOLLO PLANT MALL 1F", dept: ["脳神経内科"], url: "", lat: 35.80204, lon: 140.115689, approx: false, natOnly: false },
  { id: 'h09', name: "木刈クリニック", kind: "診療所", tel: "0476-46-8707", addr: "印西市木刈4-3-2", bld: "", dept: ["内科", "胃腸科", "外科"], url: "", lat: 35.809284, lon: 140.105194, approx: false, natOnly: false },
  { id: 'h10', name: "コスモス皮膚科", kind: "診療所", tel: "0476-47-0011", addr: "印西市中央北1-1", bld: "APOLLO PLANT MALL 2F", dept: ["一般皮膚科", "小児皮膚科", "アレルギー科", "美容皮膚科", "形成外科"], url: "http://www.cosmos-hifuka.jp", lat: 35.80204, lon: 140.115689, approx: false, natOnly: false },
  { id: 'h11', name: "斉藤おとな＆こどもクリニック", kind: "診療所", tel: "0476-47-0099", addr: "印西市木刈4-3-4", bld: "", dept: ["外科", "胃腸科", "肛門科", "整形外科", "リハビリテーション科", "内科", "皮膚科"], url: "", lat: 35.809281, lon: 140.105, approx: false, natOnly: false },
  { id: 'h12', name: "千葉ニュータウン駅前こどもクリニック", kind: "診療所", tel: "0476-85-5511", addr: "印西市中央北1-1", bld: "APOLLO PLANT MALL 2F", dept: ["小児科", "アレルギー科"], url: "", lat: 35.80204, lon: 140.115689, approx: false, natOnly: false },
  { id: 'h13', name: "千葉ニュータウン駅前耳鼻咽喉科クリニック", kind: "診療所", tel: "0476-40-1133", addr: "印西市中央北1-1", bld: "APOLLO PLANT MALL 2F", dept: ["耳鼻咽喉科", "アレルギー科", "小児耳鼻咽喉科"], url: "", lat: 35.80204, lon: 140.115689, approx: false, natOnly: false },
  { id: 'h14', name: "千葉ニュータウン駅前つかだクリニック", kind: "診療所", tel: "0476-48-2000", addr: "印西市中央北1-1", bld: "APOLLO PLANT MALL 2F", dept: ["内科", "乳腺外科", "消化器内科"], url: "https://tsukada.clinic/", lat: 35.80204, lon: 140.115689, approx: false, natOnly: false },
  { id: 'h15', name: "千葉ニュータウン整形外科リハビリテーションクリニック", kind: "診療所", tel: "0476-85-7430", addr: "印西市中央北1-1", bld: "APOLLO PLANT MALL 2F", dept: ["整形外科", "リハビリテーション科"], url: "", lat: 35.80204, lon: 140.115689, approx: false, natOnly: false },
  { id: 'h16', name: "千葉れいわ眼科", kind: "診療所", tel: "0476-85-6502", addr: "印西市中央北3-2", bld: "イオンモール千葉ニュータウン 2F", dept: ["眼科"], url: "", lat: 35.802212, lon: 140.112183, approx: false, natOnly: false },
  { id: 'h17', name: "豊田眼科", kind: "診療所", tel: "0476-47-4714", addr: "印西市中央北1-1", bld: "APOLLO PLANT MALL 2F", dept: ["眼科"], url: "http://www.toyoda-ganka.com/", lat: 35.80204, lon: 140.115689, approx: false, natOnly: false },
  { id: 'h18', name: "北総メンタルクリニック", kind: "診療所", tel: "", addr: "印西市中央北1-1", bld: "APOLLO PLANT MALL 2F", dept: ["心療内科", "精神科"], url: "https://hokusohmental.com/", lat: 35.80204, lon: 140.115689, approx: false, natOnly: false },
  { id: 'h19', name: "ラーバン駅前クリニック", kind: "診療所", tel: "0476-36-5196", addr: "印西市中央北2-1-3", bld: "サンクタス千葉ニュータウン中央 1F", dept: ["一般内科", "循環器内科", "頭痛外来", "糖尿病・内分泌代謝内科", "脳神経外科", "泌尿器科"], url: "https://rurbanekimae.jp", lat: 35.80111, lon: 140.114642, approx: false, natOnly: false },
  { id: 'h20', name: "千葉ニュータウンレディースクリニック", kind: "診療所", tel: "0476-47-2227", addr: "印西市中央北2-1-3", bld: "サンクタス千葉ニュータウン中央 1F", dept: ["産科", "婦人科"], url: "https://chibanew-lc.com", lat: 35.80111, lon: 140.114642, approx: false, natOnly: false },
  { id: 'h21', name: "牧の里クリニック", kind: "診療所", tel: "0476-97-1321", addr: "印西市小林北2-6-14", bld: "", dept: ["内科", "小児科"], url: "https://makinosato-clinic.com/", lat: 35.831847, lon: 140.19232, approx: false, natOnly: false },
  { id: 'h22', name: "印西花の丘整形外科", kind: "診療所", tel: "0476-94-7111", addr: "印西市中央南1-4-3", bld: "", dept: ["整形外科", "リハビリテーション科", "リウマチ科", "放射線科"], url: "", lat: 35.799309, lon: 140.119659, approx: false, natOnly: false },
  { id: 'h23', name: "内野診療所", kind: "診療所", tel: "050-3185-1691", addr: "印西市内野1-5-5", bld: "", dept: ["内科", "小児科", "皮膚科"], url: "", lat: 35.797318, lon: 140.127121, approx: false, natOnly: false },
  { id: 'h24', name: "キャップスクリニック千葉ニュータウン中央", kind: "診療所", tel: "0476-36-7275", addr: "印西市中央南1-8", bld: "千葉ニュータウン中央駅前センタービル 1F", dept: ["小児科"], url: "", lat: 35.798561, lon: 140.117098, approx: false, natOnly: false },
  { id: 'h25', name: "千葉ニュータウン駅前腎クリニック", kind: "診療所", tel: "0476-37-3000", addr: "印西市中央南1-8", bld: "千葉ニュータウン中央駅前センタービル 1F", dept: ["内科", "腎臓内科", "人工透析内科"], url: "https://www.chiba-jinclinic.jp/", lat: 35.798552, lon: 140.117039, approx: false, natOnly: false },
  { id: 'h26', name: "千葉ニュータウンクリニック", kind: "診療所", tel: "0476-46-4744", addr: "印西市内野1-5-1", bld: "", dept: ["外科", "胃腸科", "整形外科", "泌尿器科", "肛門科", "内科"], url: "", lat: 35.797744, lon: 140.127463, approx: false, natOnly: false },
  { id: 'h27', name: "千葉ニュータウンサザンクリニック", kind: "診療所", tel: "0476-85-4744", addr: "印西市中央南1-7-4", bld: "", dept: ["内科", "血液内科", "胃腸内科", "消化器内科", "内視鏡内科"], url: "https://chibant-sazancl.com/", lat: 35.798177, lon: 140.118322, approx: false, natOnly: false },
  { id: 'h28', name: "千葉ニュータウン中央ヒフ科クリニック", kind: "診療所", tel: "0476-94-5805", addr: "印西市中央南2-2-1", bld: "フォルテ千葉ニュータウン 2F", dept: ["皮膚科", "小児皮膚科", "アレルギー科", "美容皮膚科"], url: "https://chiba-skinclinic.com", lat: 35.797385, lon: 140.114822, approx: false, natOnly: false },
  { id: 'h29', name: "みらいウィメンズ駅前クリニック", kind: "診療所", tel: "0476-40-1203", addr: "印西市中央南1-1-1", bld: "千葉ニュータウン中央南口ビル 1F", dept: ["産科", "婦人科"], url: "https://miraiwcl-station.com/", lat: 35.799661, lon: 140.117533, approx: false, natOnly: false },
  { id: 'h30', name: "いんざいさくらクリニック", kind: "診療所", tel: "0476-85-4700", addr: "印西市原1-2", bld: "ビッグホップ内", dept: ["内科", "訪問診療", "腎臓内科", "人工透析"], url: "https://inzai-sakura.clinic", lat: 35.803383, lon: 140.164971, approx: false, natOnly: false },
  { id: 'h31', name: "印西循環器内科クリニック", kind: "診療所", tel: "0476-33-6091", addr: "印西市草深2504-8", bld: "", dept: ["内科", "循環器内科"], url: "", lat: 35.797256, lon: 140.157364, approx: false, natOnly: false },
  { id: 'h32', name: "いんざい腎・泌尿器科クリニック", kind: "診療所", tel: "0476-37-7781", addr: "印西市西の原5-11", bld: "", dept: ["泌尿器科"], url: "", lat: 35.804577, lon: 140.143631, approx: true, natOnly: false },
  { id: 'h33', name: "いんざい整形外科クリニック", kind: "診療所", tel: "0476-85-8001", addr: "印西市西の原5-12-2", bld: "", dept: ["整形外科", "リハビリテーション科"], url: "", lat: 35.80426, lon: 140.144714, approx: false, natOnly: false },
  { id: 'h34', name: "いんざい糖尿病・甲状腺クリニック", kind: "診療所", tel: "0476-37-8991", addr: "印西市西の原5-12-1", bld: "印西医療クリニックビル 2F", dept: ["内科", "糖尿病内科", "甲状腺内科", "内分泌内科", "代謝内科"], url: "https://inzai-dm.com/%e3%82%a2%e3%82%af%e3%82%bb%e3%82%b9", lat: 35.804111, lon: 140.144823, approx: false, natOnly: false },
  { id: 'h35', name: "スマイル心療内科クリニック", kind: "診療所", tel: "0476-85-5001", addr: "印西市牧の原3-4-30", bld: "", dept: ["心療内科", "精神科", "一般内科"], url: "https://smile-clinic.net/", lat: 35.807826, lon: 140.157863, approx: false, natOnly: false },
  { id: 'h36', name: "清宮クリニック", kind: "診療所", tel: "0476-33-3077", addr: "印西市西の原3-12-1", bld: "", dept: ["内科", "循環器内科", "呼吸器内科"], url: "http://www.seimiya-clinic.com", lat: 35.802127, lon: 140.153227, approx: false, natOnly: false },
  { id: 'h37', name: "千葉新都市ラーバンクリニック", kind: "診療所", tel: "0476-40-7711", addr: "印西市草深138", bld: "", dept: ["脳神経外科・頭痛外来", "脳神経内科", "泌尿器科", "内分泌代謝内科（糖尿）", "循環器科", "消化器科", "リハビリテーション科", "脊椎・骨粗しょう症外来", "総合診療科"], url: "https://www.chibashintoshi.or.jp", lat: 35.797638, lon: 140.142709, approx: false, natOnly: false },
  { id: 'h38', name: "千葉北総内科クリニック", kind: "診療所", tel: "0476-40-7431", addr: "印西市草深2221-3", bld: "", dept: ["内科", "人工透析内科", "腎臓内科"], url: "http://www.cn-clinic.jp", lat: 35.798302, lon: 140.161785, approx: false, natOnly: false },
  { id: 'h39', name: "つちや耳鼻咽喉科医院", kind: "診療所", tel: "0476-47-3387", addr: "印西市草深1203-10", bld: "", dept: ["耳鼻咽喉科"], url: "http://cms.aiakos.co.jp/clinic/tcy3387", lat: 35.810142, lon: 140.132587, approx: false, natOnly: false },
  { id: 'h40', name: "奈良整形外科", kind: "診療所", tel: "0476-46-9011", addr: "印西市草深1204-4", bld: "", dept: ["整形外科"], url: "http://www.naraseikei.jp/sp/", lat: 35.809509, lon: 140.13314, approx: false, natOnly: false },
  { id: 'h41', name: "印西そよかぜ内科・呼吸器内科", kind: "診療所", tel: "0476-37-6700", addr: "印西市西の原5-12-1", bld: "印西医療クリニックビル 1F", dept: ["内科", "呼吸器内科"], url: "https://inzai-cl.com/", lat: 35.804111, lon: 140.144823, approx: false, natOnly: false },
  { id: 'h42', name: "はぐくみBaby＆Kid'sクリニック", kind: "診療所", tel: "0476-85-6492", addr: "印西市西の原5-12-2", bld: "", dept: ["小児科"], url: "https://hagukumi-bkc.com/", lat: 35.80426, lon: 140.144714, approx: false, natOnly: false },
  { id: 'h43', name: "牧の原いとうクリニック", kind: "診療所", tel: "0476-47-5011", addr: "印西市原4-1", bld: "", dept: ["内科", "小児科", "外科", "脳神経外科", "脳神経内科"], url: "http://www.makiito.jp/", lat: 35.800073, lon: 140.162867, approx: false, natOnly: false },
  { id: 'h44', name: "牧の原眼科クリニック", kind: "診療所", tel: "0476-37-3020", addr: "印西市牧の原1-3", bld: "牧の原モア内", dept: ["眼科"], url: "http://makinoharaec.com", lat: 35.805977, lon: 140.163426, approx: false, natOnly: false },
  { id: 'h45', name: "牧の原なのはな耳鼻咽喉科", kind: "診療所", tel: "0476-45-1187", addr: "印西市草深2220-31", bld: "", dept: ["耳鼻咽喉科", "アレルギー科"], url: "http://www.nanohana-jibika.jp", lat: 35.798077, lon: 140.162496, approx: false, natOnly: false },
  { id: 'h46', name: "マハナレディースクリニック", kind: "診療所", tel: "0476-37-5812", addr: "印西市原1-2", bld: "ビッグホップ内", dept: ["産婦人科"], url: "https://www.mahana.clinic", lat: 35.802984, lon: 140.165878, approx: false, natOnly: false },
  { id: 'h47', name: "みらいウィメンズクリニック", kind: "診療所", tel: "0476-40-1200", addr: "印西市原4-2-2", bld: "", dept: ["産婦人科", "麻酔科"], url: "https://miraiwcl.com", lat: 35.799469, lon: 140.162445, approx: false, natOnly: false },
  { id: 'h48', name: "DKスポーツ＆整形クリニック", kind: "診療所", tel: "0476-98-1711", addr: "印西市平賀3780", bld: "", dept: ["リハビリテーション科", "整形外科"], url: "https://drk-clinic.com", lat: 35.750945, lon: 140.255568, approx: false, natOnly: false },
  { id: 'h49', name: "いしばし内科クリニック", kind: "診療所", tel: "0476-80-5180", addr: "印西市鎌苅2092-1", bld: "", dept: ["内科", "循環器内科", "小児科"], url: "", lat: 35.784257, lon: 140.201538, approx: false, natOnly: false },
  { id: 'h50', name: "亀谷アイクリニック", kind: "診療所", tel: "0476-94-5130", addr: "印西市鎌苅2004-12", bld: "", dept: ["眼科（主に手術専門）"], url: "https://kameya-eyeclinic.com/", lat: 35.786774, lon: 140.200755, approx: false, natOnly: false },
  { id: 'h51', name: "西佐倉印西病院", kind: "病院", tel: "0476-99-0261", addr: "印西市岩戸1844-10", bld: "", dept: ["精神（神経）科", "神経内科", "内科"], url: "https://nishisakura-inzai.com/", lat: 35.755643, lon: 140.174742, approx: false, natOnly: false },
  { id: 'h52', name: "つがねさわ医院", kind: "診療所", tel: "0476-80-3616", addr: "印西市平賀1870-3", bld: "", dept: ["内科", "脳神経内科", "糖尿病・内分泌内科", "消化器内科"], url: "https://tsuganesawaclinic.com", lat: 35.750487, lon: 140.254957, approx: false, natOnly: false },
  { id: 'h53', name: "日本医科大学千葉北総病院", kind: "病院", tel: "0476-99-1111", addr: "印西市鎌苅1715", bld: "", dept: ["循環器内科", "脳神経内科", "腎臓内科", "血液内科", "糖尿病・内分泌代謝内科", "消化器内科", "呼吸器内科", "小児科", "放射線科", "メンタルヘルス科", "皮膚科", "外科・消化器外科", "乳腺科", "心臓血管外科", "呼吸器外科", "脳神経外科", "整形外科", "眼科", "女性診療科・産科", "耳鼻咽喉科", "泌尿器科", "麻酔科", "形成外科", "リハビリテーション科", "緩和ケア科", "歯科"], url: "https://www.nms.ac.jp/hokuso-h/", lat: 35.781158, lon: 140.198169, approx: false, natOnly: false },
  { id: 'h54', name: "あんべこどもクリニック", kind: "診療所", tel: "0476-80-9611", addr: "印西市竜腹寺350-2", bld: "", dept: ["小児科", "アレルギー科"], url: "https://anbe-kodomo.com", lat: 35.806638, lon: 140.180036, approx: false, natOnly: false },
  { id: 'h55', name: "ばんどうクリニック", kind: "診療所", tel: "0476-37-8877", addr: "印西市竜腹寺349-1", bld: "", dept: ["内科", "内視鏡内科", "外科", "消化器内科", "肝臓内科", "肛門外科"], url: "https://bando-cl.com", lat: 35.806094, lon: 140.179358, approx: false, natOnly: false },
  { id: 'h56', name: "ふじた皮フ科医院", kind: "診療所", tel: "0476-80-8081", addr: "印西市竜腹寺350-2", bld: "", dept: ["皮膚科"], url: "", lat: 35.806638, lon: 140.180036, approx: false, natOnly: false },
  { id: 'h57', name: "もとの金城クリニック", kind: "診療所", tel: "0476-97-7333", addr: "印西市竜腹寺350-2", bld: "", dept: ["内科", "循環器科"], url: "http://kinjo.biz/", lat: 35.806638, lon: 140.180036, approx: false, natOnly: false },
  { id: 'h58', name: "印西総合病院", kind: "病院", tel: "0476-33-3000", addr: "印西市牧の台1-1-1", bld: "", dept: ["婦人科", "小児科", "小児外科", "内科", "整形外科", "外科", "リハビリテーション科", "皮膚科", "耳鼻咽喉科", "泌尿器科", "脳神経外科", "総合内科", "眼科", "形成外科", "心臓血管外科"], url: "http://www.inzai-hospital.jp/", lat: 35.813062, lon: 140.163276, approx: false, natOnly: false },
  { id: 'h59', name: "すずき小倉台医院", kind: "診療所", tel: "", addr: "印西市小倉台4-12", bld: "", dept: ["内科", "呼吸器内科", "小児科", "アレルギー科"], url: "https://suzukioguradai-iin.com", lat: 35.806359, lon: 140.112164, approx: false, natOnly: true },
  { id: 'h60', name: "めぐみこころのクリニック", kind: "診療所", tel: "", addr: "印西市原1-2ビックホップガーデンモール印西", bld: "", dept: ["精神科", "心療内科", "老年精神科"], url: "http://megumi-cocoro.clinic/", lat: 35.803383, lon: 140.164971, approx: false, natOnly: true },
  // ここから歯科（市の一覧の歯科のページ・38件。2026-11-23 追加）
  { id: 'd01', name: "いんざい歯科医院", kind: '歯科', tel: "0476-42-0648", addr: "印西市木下1632", bld: "", dept: ["歯科", "矯正歯科", "歯科口腔外科", "小児歯科"], url: "", lat: 35.839237, lon: 140.147851, approx: false, natOnly: false },
  { id: 'd02', name: "印西森のはいしゃさん", kind: '歯科', tel: "0476-36-8882", addr: "印西市鹿黒南3-4-81", bld: "", dept: ["歯科"], url: "", lat: 35.817455, lon: 140.136932, approx: true, natOnly: false },
  { id: 'd03', name: "うちだ歯科", kind: '歯科', tel: "0476-36-7887", addr: "印西市大森2454-3", bld: "", dept: ["歯科"], url: "", lat: 35.834, lon: 140.147903, approx: false, natOnly: false },
  { id: 'd04', name: "大越歯科医院", kind: '歯科', tel: "0476-42-2097", addr: "印西市大森4470-14", bld: "", dept: ["歯科"], url: "", lat: 35.836918, lon: 140.138245, approx: false, natOnly: false },
  { id: 'd05', name: "きおろし歯科", kind: '歯科', tel: "0476-42-7881", addr: "印西市木下698", bld: "", dept: ["歯科", "矯正歯科", "歯科口腔外科", "小児歯科"], url: "", lat: 35.836304, lon: 140.149215, approx: false, natOnly: false },
  { id: 'd06', name: "コスモス三国歯科", kind: '歯科', tel: "0476-42-0008", addr: "印西市大森2552-9", bld: "", dept: ["歯科", "矯正歯科", "歯科口腔外科", "小児歯科"], url: "http://www.cosmos-dental.com/", lat: 35.834659, lon: 140.143707, approx: false, natOnly: false },
  { id: 'd07', name: "高花歯科クリニック", kind: '歯科', tel: "0476-46-8241", addr: "印西市高花5-2-1", bld: "", dept: ["歯科", "矯正歯科", "小児歯科"], url: "", lat: 35.795511, lon: 140.134085, approx: false, natOnly: false },
  { id: 'd08', name: "ほりえ歯科医院", kind: '歯科', tel: "0476-46-8889", addr: "印西市結縁寺525-3", bld: "", dept: ["歯科", "小児歯科"], url: "", lat: 35.79298, lon: 140.135568, approx: false, natOnly: false },
  { id: 'd09', name: "印西歯科クリニック", kind: '歯科', tel: "0476-48-1186", addr: "印西市中央北3-1-1", bld: "イオンモール千葉ニュータウン イオン棟 3F", dept: ["歯科", "矯正歯科", "歯科口腔外科", "小児歯科", "小児矯正歯科"], url: "http://inzai-dental.com", lat: 35.802926, lon: 140.113758, approx: false, natOnly: false },
  { id: 'd10', name: "グリーン歯科", kind: '歯科', tel: "0476-42-0877", addr: "印西市小倉683-4", bld: "", dept: ["歯科"], url: "", lat: 35.810989, lon: 140.114548, approx: false, natOnly: false },
  { id: 'd11', name: "クローバー歯科", kind: '歯科', tel: "0476-47-1313", addr: "印西市小倉台4-11", bld: "", dept: ["歯科", "矯正歯科", "歯科口腔外科", "小児歯科"], url: "http://www.dentalclinic-clover.com/", lat: 35.806451, lon: 140.112439, approx: false, natOnly: false },
  { id: 'd12', name: "ココロデンタルクリニック", kind: '歯科', tel: "0476-46-7711", addr: "印西市武西学園台1-3-65", bld: "", dept: ["歯科", "矯正歯科", "歯科口腔外科", "小児歯科", "小児矯正歯科"], url: "http://www.cocolo-dc.org", lat: 35.796244, lon: 140.11275, approx: false, natOnly: false },
  { id: 'd13', name: "千葉ニュータウン河合歯科矯正歯科", kind: '歯科', tel: "0476-40-0040", addr: "印西市中央北1-469", bld: "アルカサール 2F", dept: ["歯科"], url: "", lat: 35.801483, lon: 140.116714, approx: false, natOnly: false },
  { id: 'd14', name: "千葉ニュータウンごう歯科クリニック", kind: '歯科', tel: "0476-29-5581", addr: "印西市泉野1-144-6", bld: "ベイシア千葉ニュータウン店内", dept: ["歯科", "矯正歯科", "歯科口腔外科", "小児歯科"], url: "http://www.go-dc.net/", lat: 35.804257, lon: 140.123194, approx: false, natOnly: false },
  { id: 'd15', name: "千葉ニュータウン中央つきのわ歯科", kind: '歯科', tel: "0476-37-8456", addr: "印西市中央南2-2-1", bld: "フォルテ千葉ニュータウン 2F", dept: ["歯科", "矯正歯科", "歯科口腔外科", "小児歯科", "小児矯正歯科"], url: "https://www.tsukinowa-dc.com", lat: 35.797149, lon: 140.114878, approx: false, natOnly: false },
  { id: 'd16', name: "千葉ニュータウン中央ひの歯科", kind: '歯科', tel: "0476-85-8388", addr: "印西市中央北1-1", bld: "APOLLO PLANT MALL 2F", dept: ["歯科", "矯正歯科", "歯科口腔外科", "小児歯科"], url: "https://www.dental-hino.com", lat: 35.80204, lon: 140.115689, approx: false, natOnly: false },
  { id: 'd17', name: "ニュータウン中央歯科室", kind: '歯科', tel: "0476-40-1231", addr: "印西市中央北2-1-3", bld: "サンクタス千葉ニュータウン中央 1F", dept: ["歯科", "矯正歯科", "歯科口腔外科", "小児歯科", "小児矯正歯科"], url: "https://www.kaiseikai-newtown.jp/", lat: 35.80111, lon: 140.114642, approx: false, natOnly: false },
  { id: 'd18', name: "大沢歯科医院", kind: '歯科', tel: "0476-97-6431", addr: "印西市小林北5-1-2", bld: "", dept: ["歯科", "矯正歯科", "小児歯科"], url: "https://www.0308.jp", lat: 35.831311, lon: 140.197303, approx: false, natOnly: false },
  { id: 'd19', name: "川村歯科医院", kind: '歯科', tel: "0476-97-1001", addr: "印西市小林浅間1-3-7", bld: "", dept: ["歯科", "矯正歯科", "歯科口腔外科", "小児歯科"], url: "", lat: 35.827886, lon: 140.194123, approx: false, natOnly: false },
  { id: 'd20', name: "杉田歯科医院", kind: '歯科', tel: "0476-97-2220", addr: "印西市小林北2-2-1", bld: "", dept: ["歯科", "小児歯科"], url: "", lat: 35.832302, lon: 140.194314, approx: false, natOnly: false },
  { id: 'd21', name: "千葉ニュータウンデンタルクリニック", kind: '歯科', tel: "0476-46-5011", addr: "印西市内野1-5-2", bld: "", dept: ["歯科", "歯科口腔外科", "小児歯科"], url: "", lat: 35.797318, lon: 140.127121, approx: false, natOnly: false },
  { id: 'd22', name: "宮本歯科医院", kind: '歯科', tel: "0476-45-0777", addr: "印西市原山1-7-3", bld: "", dept: ["歯科"], url: "", lat: 35.801535, lon: 140.128679, approx: false, natOnly: false },
  { id: 'd23', name: "ユキ・デンタルクリニック", kind: '歯科', tel: "0476-47-0418", addr: "印西市原山2-11", bld: "", dept: ["歯科", "小児歯科", "小児矯正歯科"], url: "", lat: 35.800671, lon: 140.132304, approx: false, natOnly: false },
  { id: 'd24', name: "いいづか歯科クリニック", kind: '歯科', tel: "0476-47-1179", addr: "印西市草深2419-9", bld: "", dept: ["歯科", "矯正歯科", "歯科口腔外科", "小児歯科"], url: "https://iizuka-shika.jp", lat: 35.799258, lon: 140.153447, approx: false, natOnly: false },
  { id: 'd25', name: "印西牧の原歯科", kind: '歯科', tel: "0476-36-8991", addr: "印西市原1-1-7", bld: "", dept: ["歯科", "矯正歯科", "歯科口腔外科", "小児歯科"], url: "", lat: 35.802144, lon: 140.166773, approx: false, natOnly: false },
  { id: 'd26', name: "おがわ歯科", kind: '歯科', tel: "0476-33-3190", addr: "印西市草深2330-2", bld: "", dept: ["歯科", "矯正歯科", "歯科口腔外科", "小児歯科"], url: "https://www.ogawashika.net", lat: 35.797337, lon: 140.165771, approx: false, natOnly: false },
  { id: 'd27', name: "ガーデンモール印西歯科", kind: '歯科', tel: "0476-48-2118", addr: "印西市原1-2", bld: "ビッグホップ内", dept: ["歯科", "矯正歯科", "歯科口腔外科", "小児歯科"], url: "http://dentist-zon.com/", lat: 35.803383, lon: 140.164971, approx: false, natOnly: false },
  { id: 'd28', name: "かめだ歯科医院", kind: '歯科', tel: "0476-47-1441", addr: "印西市草深259-14", bld: "", dept: ["歯科", "矯正歯科", "歯科口腔外科", "小児歯科"], url: "http://www.kameda-shika.jp/", lat: 35.792199, lon: 140.151117, approx: false, natOnly: false },
  { id: 'd29', name: "鈴木歯科クリニック", kind: '歯科', tel: "0476-33-6990", addr: "印西市西の原2-2-1", bld: "", dept: ["歯科", "矯正歯科", "歯科口腔外科", "小児歯科"], url: "https://inzai-suzuki.com", lat: 35.800124, lon: 140.158574, approx: false, natOnly: false },
  { id: 'd30', name: "千葉ニュータウンおとなこども歯科", kind: '歯科', tel: "0476-37-7950", addr: "印西市牧の原2-1", bld: "ジョイフル本田千葉ニュータウン店 2F", dept: ["歯科", "矯正歯科", "歯科口腔外科", "小児歯科"], url: "https://www.chibanewtown-dental.com/", lat: 35.80663, lon: 140.156143, approx: false, natOnly: false },
  { id: 'd31', name: "西の原歯科クリニック", kind: '歯科', tel: "0476-46-1818", addr: "印西市西の原3-11", bld: "", dept: ["歯科"], url: "", lat: 35.802166, lon: 140.15358, approx: false, natOnly: false },
  { id: 'd32', name: "のざき歯科クリニック", kind: '歯科', tel: "0476-33-7294", addr: "印西市草深1618-16", bld: "", dept: ["歯科", "矯正歯科", "歯科口腔外科", "小児歯科", "小児矯正歯科"], url: "https://www.nozaki-dc.com", lat: 35.80513, lon: 140.173514, approx: false, natOnly: false },
  { id: 'd33', name: "牧の原モアはとがい歯科", kind: '歯科', tel: "0476-37-8080", addr: "印西市牧の原1-3", bld: "牧の原モア内", dept: ["歯科"], url: "", lat: 35.804539, lon: 140.166428, approx: false, natOnly: false },
  { id: 'd34', name: "もとうち歯科医院", kind: '歯科', tel: "0476-46-8411", addr: "印西市草深205-4", bld: "", dept: ["歯科"], url: "", lat: 35.795254, lon: 140.142853, approx: false, natOnly: false },
  { id: 'd35', name: "いだいまえ歯科医院", kind: '歯科', tel: "0476-80-5585", addr: "印西市鎌苅2092-1", bld: "", dept: ["歯科", "歯科口腔外科", "小児歯科"], url: "http://idaimae.jp", lat: 35.784257, lon: 140.201538, approx: false, natOnly: false },
  { id: 'd36', name: "印旛日本医大前佐藤歯科", kind: '歯科', tel: "0476-98-0403", addr: "印西市若萩3-19-10", bld: "", dept: ["歯科"], url: "", lat: 35.789013, lon: 140.209869, approx: false, natOnly: false },
  { id: 'd37', name: "FM歯科クリニック印西牧の原", kind: '歯科', tel: "0476-37-6476", addr: "印西市滝野3-1", bld: "フォレストモール印西牧の原", dept: ["歯科", "矯正歯科", "歯科口腔外科", "小児歯科"], url: "http://www.fidc.jp/", lat: 35.806788, lon: 140.178611, approx: false, natOnly: false },
  { id: 'd38', name: "滝野歯科医院", kind: '歯科', tel: "0476-80-9511", addr: "印西市滝野2-1-3", bld: "", dept: ["歯科"], url: "", lat: 35.807957, lon: 140.178635, approx: false, natOnly: false },
]

// 絞り込みのボタン。診療科の名前にこの言葉が入っていれば当てはまる
export const HOSPITAL_FILTERS: { key: string; label: string; words: string[] }[] = [
  { key: 'naika', label: '内科', words: ['内科'] },
  { key: 'shonika', label: '小児科', words: ['小児科'] },
  { key: 'geka', label: '外科・整形外科', words: ['外科'] },
  { key: 'ganka', label: '眼科', words: ['眼科'] },
  { key: 'jibika', label: '耳鼻科', words: ['耳鼻'] },
  { key: 'hifuka', label: '皮膚科', words: ['皮膚', '皮フ'] },
  { key: 'sanfujinka', label: '産科・婦人科', words: ['産科', '婦人科', '産婦人科', '女性'] },
  { key: 'kokoro', label: '心療内科・精神科', words: ['心療内科', '精神'] },
  { key: 'shika', label: '歯科', words: ['歯科'] },
]

export function matchesHospitalFilter(h: Hospital, key: string): boolean {
  const f = HOSPITAL_FILTERS.find((x) => x.key === key)
  if (!f) return true
  // 歯科は「歯科」のボタンだけに出す（「歯科口腔外科」が外科に、「小児歯科」が小児科に混ざらないように）
  if (key === 'shika') return h.kind === '歯科' || h.dept.includes('歯科')
  if (h.kind === '歯科') return false
  // 「内科」は「心療内科」だけの所を除く（からだの内科を探す人のため）
  if (key === 'naika') return h.dept.some((d) => d.includes('内科') && !d.includes('心療内科'))
  return h.dept.some((d) => f.words.some((w) => d.includes(w)))
}
