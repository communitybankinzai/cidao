"""市の「バス停位置図」PDF（令和8年2月の再編・新設／移設／廃止）から、新設・移設のバス停の位置を割り出す。

図の中の番号の四角・丸印の位置（PDF の座標）は、図形と文字のデータから取り出したもの。
同じ図に写っている、位置の分かっているバス停（国土数値情報 2022年）を基準点にして、
図の座標 → 緯度経度 の一次変換（アフィン）を最小二乗で求め、新設・移設のバス停に当てる。
基準点での食い違い（m）も出す。結果は map_located.json。
"""
import json
import math
import re
import sys
import unicodedata

sys.stdout.reconfigure(encoding="utf-8")


def norm(s):
    s = unicodedata.normalize("NFKC", s)
    s = re.sub(r"\(.*?\)", "", s)
    s = s.replace("ヶ", "ケ").replace("千葉ニュータウン", "千葉NT").replace(" ", "")
    for a, b in zip("一二三四五六七八九", "123456789"):
        s = s.replace(a + "丁目", b + "丁目")
    return s


located = json.load(open("stops_located.json", encoding="utf-8"))["stops"]

MAPS = {
    "牧の原循環・東ルートの位置図": {
        "control": {"印西牧の原駅北口": (722, 517), "東の原1丁目": (1050, 752), "東の原公園前": (921, 728), "西の原2丁目": (540, 686),
                    "西の原小学校西": (383, 648), "西の原4丁目": (317, 576), "牧の原北": (613, 453)},
        "target": {"牧の原4丁目南": (687, 439), "牧の原3丁目": (580, 386), "別所谷津公園": (551, 309), "牧の原小学校北": (614, 234),
                   "印西総合病院": (673, 237), "牧の原4丁目北": (733, 294), "草深": (928, 471), "牧の原6丁目": (1048, 532),
                   "原南街区公園": (657, 701), "西の原5丁目": (194, 515), "滝": (1006, 94)},
    },
    "中ルートの位置図": {
        "control": {"市役所": (552, 154), "総合福祉センター": (663, 134), "原山東街区公園": (243, 1018), "原山団地": (179, 1050),
                    "高花保健福祉センター": (408, 1071), "高花2丁目3": (479, 1106), "高花3丁目": (531, 1003)},
        "target": {"印西中学校": (593, 272), "古新田": (516, 410), "鹿黒南": (415, 568), "鹿黒南5丁目": (284.5, 695.5),
                   "泉新田": (268, 797), "天王脇": (259, 884), "原山東": (252, 985)},
    },
    "西・南ルートの位置図": {
        "control": {"印西郵便局前": (350, 265), "ハートヴィレッヂ前": (185, 716), "中央駅前地域交流館前": (698, 130), "北総花の丘公園": (906, 186)},
        "target": {"戸神": (611, 488), "武西学園台南": (388, 649), "戸神台": (560, 255)},
    },
}


def solve3(A, b):
    """3元連立一次方程式（ガウスの消去法）。"""
    M = [row[:] + [bv] for row, bv in zip(A, b)]
    for i in range(3):
        piv = max(range(i, 3), key=lambda r: abs(M[r][i]))
        M[i], M[piv] = M[piv], M[i]
        for r in range(3):
            if r != i:
                f = M[r][i] / M[i][i]
                M[r] = [x - f * y for x, y in zip(M[r], M[i])]
    return [M[i][3] / M[i][i] for i in range(3)]


def fit(points):  # [(x, y, value)] → value ≈ a*x + b*y + c
    A = [[0.0] * 3 for _ in range(3)]
    b = [0.0] * 3
    for x, y, v in points:
        row = [x, y, 1.0]
        for i in range(3):
            b[i] += row[i] * v
            for j in range(3):
                A[i][j] += row[i] * row[j]
    return solve3(A, b)


out = {}
for title, m in MAPS.items():
    ctrl = []
    for name, (x, y) in m["control"].items():
        k = norm(name)
        if k not in located:
            print(f"  ⚠ 基準点にできない（位置なし）: {name}")
            continue
        ctrl.append((name, x, y, located[k]["lat"], located[k]["lon"]))
    fa = fit([(x, y, la) for _, x, y, la, lo in ctrl])
    fo = fit([(x, y, lo) for _, x, y, la, lo in ctrl])
    conv = lambda x, y: (fa[0] * x + fa[1] * y + fa[2], fo[0] * x + fo[1] * y + fo[2])
    errs = []
    for name, x, y, la, lo in ctrl:
        pa, po = conv(x, y)
        errs.append((math.hypot((pa - la) * 110540, (po - lo) * 91000), name))
    rms = math.sqrt(sum(e * e for e, _ in errs) / len(errs))
    scale = math.hypot(fo[0] * 91000, fa[0] * 110540)
    print(f"== {title}: 基準点 {len(ctrl)}／食い違い 平均的に {rms:.0f}m・最大 {max(errs)[0]:.0f}m（{max(errs)[1]}）／1ポイント＝約{scale:.2f}m")
    for e, name in sorted(errs, reverse=True)[:3]:
        print(f"     基準点 {name}: {e:.0f}m")
    for name, (x, y) in m["target"].items():
        la, lo = conv(x, y)
        old = located.get(norm(name))
        moved = f"・2022年の位置から {math.hypot((la - old['lat']) * 110540, (lo - old['lon']) * 91000):.0f}m" if old else ""
        print(f"   {name}: {la:.6f}, {lo:.6f}{moved}")
        out[name] = {"lat": round(la, 6), "lon": round(lo, 6), "map": title, "rmsM": round(rms), "controls": len(ctrl)}
json.dump(out, open("map_located.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("書き出し map_located.json", len(out))
