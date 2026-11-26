"""バス停からバス停までを、道路に沿ってたどる。

道路のつながりは、防災MAPの道順チェック用のデータ（cbi-site の inzai-disaster-map/simulation-data/route_graph.json・
OpenStreetMap contributors・ODbL）を読む。交差点と道の端が「点」、その間が「区間」。一方通行は区間の向きとして入っている。

使い方（ほかのスクリプトから）:
    roads = Roads("route_graph.json")
    path = roads.path((lat1, lon1), (lat2, lon2))   # [(lat, lon), …] か None（たどれないとき）
"""
from __future__ import annotations

import heapq
import json
import math

CELL = 0.002  # 探すための升目（約200m）
SNAP_MAX_M = 150.0  # バス停から道路までの距離の上限


def dist_m(a, b) -> float:
    return math.hypot((a[0] - b[0]) * 110540.0, (a[1] - b[1]) * 111320.0 * math.cos(math.radians((a[0] + b[0]) / 2)))


class Roads:
    def __init__(self, path: str):
        d = json.load(open(path, encoding="utf-8"))
        q = d["quantize"]
        flat = d["nodes"]
        self.nodes: list[tuple[float, float]] = []
        nq = []
        la = lo = 0
        for i in range(0, len(flat), 2):
            la += flat[i]
            lo += flat[i + 1]
            nq.append((la, lo))
            self.nodes.append((la / q, lo / q))
        self.geo: list[list[tuple[float, float]]] = []  # 区間の形（点aから点bへ）
        self.cum: list[list[float]] = []  # 区間の始まりからの距離
        self.ends: list[tuple[int, int, int]] = []
        self.adj: list[list[tuple[int, float, int, bool]]] = [[] for _ in self.nodes]  # (相手の点, 長さ, 区間, 順向きか)
        self.adj_any: list[list[tuple[int, float, int, bool]]] = [[] for _ in self.nodes]  # 一方通行を無視したもの
        self.grid: dict[tuple[int, int], list[int]] = {}
        for ei, e in enumerate(d["edges"]):
            a, b, ow = e[0], e[1], e[2]
            pts = [self.nodes[a]]
            pl, pn = nq[a]
            for k in range(3, len(e), 2):
                pl += e[k]
                pn += e[k + 1]
                pts.append((pl / q, pn / q))
            pts.append(self.nodes[b])
            cum = [0.0]
            for u, v in zip(pts, pts[1:]):
                cum.append(cum[-1] + dist_m(u, v))
            self.geo.append(pts)
            self.cum.append(cum)
            self.ends.append((a, b, ow))
            length = cum[-1]
            if ow in (0, 1):
                self.adj[a].append((b, length, ei, True))
            if ow in (0, -1):
                self.adj[b].append((a, length, ei, False))
            self.adj_any[a].append((b, length, ei, True))
            self.adj_any[b].append((a, length, ei, False))
            cells = set()
            for u, v in zip(pts, pts[1:]):
                for cy in range(int(min(u[0], v[0]) / CELL), int(max(u[0], v[0]) / CELL) + 1):
                    for cx in range(int(min(u[1], v[1]) / CELL), int(max(u[1], v[1]) / CELL) + 1):
                        cells.add((cy, cx))
            for c in cells:
                self.grid.setdefault(c, []).append(ei)

    # ---- いちばん近い道路の上の点 ----
    def snap(self, p: tuple[float, float]):
        c = self.snaps(p, 1)
        return c[0] if c else None

    def snaps(self, p: tuple[float, float], limit: int = 4, slack: float = 45.0):
        """近い道路の上の点を、近い順にいくつか返す（中央で分かれた道の反対側・交差する道も候補にするため）。"""
        cy, cx = int(p[0] / CELL), int(p[1] / CELL)
        found: dict[int, tuple] = {}
        seen = set()
        kx = 111320.0 * math.cos(math.radians(p[0]))
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for ei in self.grid.get((cy + dy, cx + dx), ()):
                    if ei in seen:
                        continue
                    seen.add(ei)
                    pts, cum = self.geo[ei], self.cum[ei]
                    for i in range(len(pts) - 1):
                        ax, ay = (pts[i][1] - p[1]) * kx, (pts[i][0] - p[0]) * 110540.0
                        bx, by = (pts[i + 1][1] - p[1]) * kx, (pts[i + 1][0] - p[0]) * 110540.0
                        vx, vy = bx - ax, by - ay
                        den = vx * vx + vy * vy
                        t = 0.0 if den == 0 else max(0.0, min(1.0, -(ax * vx + ay * vy) / den))
                        px, py = ax + vx * t, ay + vy * t
                        off = math.hypot(px, py)
                        if ei not in found or off < found[ei][0]:
                            s = cum[i] + (cum[i + 1] - cum[i]) * t
                            pt = (pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t)
                            found[ei] = (off, ei, s, pt)
        order = sorted(found.values())
        if not order or order[0][0] > SNAP_MAX_M:
            return []
        keep = [b for b in order if b[0] <= order[0][0] + slack][:limit]
        return [{"edge": b[1], "s": b[2], "pt": b[3], "off": b[0]} for b in keep]

    def _slice(self, ei: int, s0: float, s1: float) -> list[tuple[float, float]]:
        """区間 ei の、始まりからの距離 s0 → s1 の部分（s0 > s1 なら逆向き）。"""
        if s0 > s1:
            return list(reversed(self._slice(ei, s1, s0)))
        pts, cum = self.geo[ei], self.cum[ei]

        def at(s: float):
            for i in range(len(pts) - 1):
                if s <= cum[i + 1] or i == len(pts) - 2:
                    f = 0.0 if cum[i + 1] == cum[i] else (s - cum[i]) / (cum[i + 1] - cum[i])
                    f = max(0.0, min(1.0, f))
                    return (pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f)
            return pts[-1]

        out = [at(s0)]
        for i in range(1, len(pts) - 1):
            if s0 < cum[i] < s1:
                out.append(pts[i])
        out.append(at(s1))
        return out

    def _search(self, A, B, adj, limit: float):
        a0, b0, ow0 = self.ends[A["edge"]]
        a1, b1, ow1 = self.ends[B["edge"]]
        L0, L1 = self.cum[A["edge"]][-1], self.cum[B["edge"]][-1]
        free = adj is self.adj_any
        heap, best, prev = [], {}, {}
        if free or ow0 in (0, 1):
            heapq.heappush(heap, (L0 - A["s"], b0, -1, None))
        if free or ow0 in (0, -1):
            heapq.heappush(heap, (A["s"], a0, -1, None))
        goal_cost, goal_node = None, None
        while heap:
            c, n, pn, pe = heapq.heappop(heap)
            if n in best:
                continue
            best[n] = c
            prev[n] = (pn, pe)
            if goal_cost is not None and c >= goal_cost:
                break
            if c > limit:
                break
            if n == a1 and (free or ow1 in (0, 1)):
                t = c + B["s"]
                if goal_cost is None or t < goal_cost:
                    goal_cost, goal_node = t, n
            if n == b1 and (free or ow1 in (0, -1)):
                t = c + (L1 - B["s"])
                if goal_cost is None or t < goal_cost:
                    goal_cost, goal_node = t, n
            for m, w, ei, fwd in adj[n]:
                if m not in best:
                    heapq.heappush(heap, (c + w, m, n, (ei, fwd)))
        if goal_cost is None or goal_cost > limit:
            return None
        # たどった区間を前へさかのぼる
        chain = []
        n = goal_node
        while True:
            pn, pe = prev[n]
            if pe is None:
                first = n
                break
            chain.append(pe)
            n = pn
        chain.reverse()
        pts: list[tuple[float, float]] = []
        pts += self._slice(A["edge"], A["s"], L0 if first == b0 else 0.0)
        for ei, fwd in chain:
            g = self.geo[ei]
            pts += (g if fwd else list(reversed(g)))[1:]
        pts += self._slice(B["edge"], 0.0 if goal_node == a1 else L1, B["s"])[1:]
        return pts

    def _between(self, A, B, limit: float):
        if A["edge"] == B["edge"]:
            ow = self.ends[A["edge"]][2]
            if (B["s"] >= A["s"] and ow in (0, 1)) or (B["s"] <= A["s"] and ow in (0, -1)):
                return self._slice(A["edge"], A["s"], B["s"]), ""
        pts = self._search(A, B, self.adj, limit)
        if pts:
            return pts, ""
        pts = self._search(A, B, self.adj_any, limit)
        if pts:
            return pts, "一方通行を無視"
        return None, "たどれない"

    @staticmethod
    def length(pts) -> float:
        return sum(dist_m(u, v) for u, v in zip(pts, pts[1:]))

    def path(self, p0, p1):
        """p0 → p1 を道なりにたどった点の並びと、注記。たどれなければ (None, 理由)。

        いちばん近い道路どうしでたどり、遠回り（直線の2.2倍＋300m超）になったときだけ、
        近くのほかの道路（中央で分かれた道の反対側など）も候補にして、いちばん短いものを選ぶ。
        """
        A, B = self.snap(p0), self.snap(p1)
        if not A or not B:
            return None, "道路が近くに無い"
        straight = dist_m(p0, p1)
        limit = max(straight * 3.5 + 800.0, 2500.0)
        pts, note = self._between(A, B, limit)
        if pts is not None and self.length(pts) <= straight * 2.2 + 300.0:
            return pts, note
        best = (self.length(pts), pts, note) if pts is not None else None
        for a in self.snaps(p0):
            for b in self.snaps(p1):
                if a["edge"] == A["edge"] and b["edge"] == B["edge"]:
                    continue
                cand, cnote = self._between(a, b, limit)
                if cand is None:
                    continue
                ln = self.length(cand) + a["off"] + b["off"]
                if best is None or ln < best[0]:
                    best = (ln, cand, (cnote + "・" if cnote else "") + "近くの別の道から")
        if best is None:
            return None, "たどれない"
        return best[1], best[2]
