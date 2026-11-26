'use client'

// 印西バスマップの立体表示（2026-11-27 試作）。
// 地図タイルを読まない自作の立体マップ。public/bus/terrain.json（国土地理院の標高を約60m間隔にしたもの＋国道・県道）だけで
// 地形の模型を描き、その上に路線・バス停・動くバスを置く。高さは見やすいように強調している（実際の比率ではない）。
// three.js はこの部品を開いたときにだけ読み込む。
import { useEffect, useRef, useState } from 'react'
import type * as THREE_NS from 'three'

export type Bus3DStop = { id: string; name: string; lat: number; lon: number }
export type Bus3DLine = { route: string; color: string; pts: [number, number][] } // [緯度, 経度]
export type Bus3DBus = { id: string; color: string; lat: number; lon: number; label: string }

type Terrain = {
  lat0: number
  lat1: number
  lon0: number
  lon1: number
  cols: number
  rows: number
  water: number
  h: number[] // 0.1m 単位
  roads: { k: string; p: [number, number][] }[]
  credit: string
  builtAt: string
}

const EXAG = 5 // 高さの強調（印西は標高差が約40mしかなく、そのままだと平らに見える）
const LOW_M = 3 // これより低い所は水色（沼・川・低い土地）

type Three = typeof THREE_NS

type World = {
  THREE: Three
  scene: THREE_NS.Scene
  camera: THREE_NS.PerspectiveCamera
  renderer: THREE_NS.WebGLRenderer
  controls: { update(): void; dispose(): void; target: THREE_NS.Vector3 }
  layer: THREE_NS.Group // 路線とバス停（選び直したら作り直す）
  busLayer: THREE_NS.Group
  toXZ(lat: number, lon: number): [number, number]
  yAt(lat: number, lon: number): number
  stopMesh: THREE_NS.InstancedMesh | null
  stopNames: string[]
  mark: THREE_NS.Mesh
  hereMark: THREE_NS.Mesh
  span: number
  buses: Map<string, { obj: THREE_NS.Group; from: THREE_NS.Vector3; to: THREE_NS.Vector3; t0: number }>
}

function colorFor(m: number): [number, number, number] {
  // 低い土地は水色、台地へ向かって緑→薄い茶
  const stops: [number, [number, number, number]][] = [
    [0, [0.47, 0.69, 0.84]],
    [LOW_M, [0.55, 0.75, 0.86]],
    [LOW_M + 0.01, [0.73, 0.86, 0.62]],
    [12, [0.6, 0.78, 0.5]],
    [24, [0.78, 0.78, 0.55]],
    [45, [0.74, 0.64, 0.46]],
  ]
  for (let i = 1; i < stops.length; i++) {
    if (m <= stops[i][0]) {
      const [a, ca] = stops[i - 1]
      const [b, cb] = stops[i]
      const f = b > a ? (m - a) / (b - a) : 0
      return [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f]
    }
  }
  return stops[stops.length - 1][1]
}

// 点の並びから、幅のある帯の面を作る
function ribbon(THREE: Three, pts: [number, number, number][], width: number): THREE_NS.BufferGeometry | null {
  if (pts.length < 2) return null
  const pos: number[] = []
  const idx: number[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    let dx = b[0] - a[0]
    let dz = b[2] - a[2]
    const len = Math.hypot(dx, dz) || 1
    dx /= len
    dz /= len
    const nx = -dz * (width / 2)
    const nz = dx * (width / 2)
    const p = pts[i]
    pos.push(p[0] + nx, p[1], p[2] + nz, p[0] - nx, p[1], p[2] - nz)
    if (i > 0) {
      const k = (i - 1) * 2
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  return g
}

function labelSprite(THREE: Three, text: string, bg: string): THREE_NS.Sprite {
  const c = document.createElement('canvas')
  const g = c.getContext('2d')!
  const font = 'bold 44px sans-serif'
  g.font = font
  const w = Math.min(900, Math.ceil(g.measureText(text).width) + 36)
  c.width = w
  c.height = 64
  g.font = font
  g.fillStyle = bg
  g.beginPath()
  g.roundRect(0, 0, w, 64, 14)
  g.fill()
  g.fillStyle = '#fff'
  g.textBaseline = 'middle'
  g.fillText(text, 18, 34, w - 36)
  const tex = new THREE.CanvasTexture(c)
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }))
  sp.scale.set((w / 64) * 0.034, 0.034, 1) // 画面上の大きさを一定に（遠くても読める）
  sp.renderOrder = 5
  return sp
}

function disposeGroup(group: THREE_NS.Group) {
  group.traverse((o) => {
    const m = o as THREE_NS.Mesh
    if (m.geometry) m.geometry.dispose()
    const mat = m.material as THREE_NS.Material | THREE_NS.Material[] | undefined
    const one = (x: THREE_NS.Material) => {
      const map = (x as THREE_NS.SpriteMaterial).map
      if (map) map.dispose()
      x.dispose()
    }
    if (Array.isArray(mat)) mat.forEach(one)
    else if (mat) one(mat)
  })
  group.clear()
}

export function Bus3D({
  stops,
  lines,
  buses,
  selectedStop,
  onPickStop,
  here,
  focusN,
  resetN,
}: {
  stops: Bus3DStop[]
  lines: Bus3DLine[]
  buses: Bus3DBus[]
  selectedStop: string | null
  onPickStop: (name: string) => void
  here: [number, number] | null // 現在地（緯度・経度）。分かっていれば、そこを中心に開く
  focusN: number // 「現在地」を押すたびに増える（もう一度その場所へ寄せる）
  resetN: number // 「全体」を押すたびに増える
}) {
  const el = useRef<HTMLDivElement>(null)
  const world = useRef<World | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [credit, setCredit] = useState('')
  const pickRef = useRef(onPickStop)
  useEffect(() => {
    pickRef.current = onPickStop
  }, [onPickStop])

  // 立体の世界を作る（一度だけ）
  useEffect(() => {
    let cancelled = false
    let raf = 0
    let ro: ResizeObserver | null = null
    const cleanups: (() => void)[] = []
    ;(async () => {
      try {
        const [THREE, oc, res] = await Promise.all([import('three'), import('three/examples/jsm/controls/OrbitControls.js'), fetch('/bus/terrain.json')])
        if (!res.ok) throw new Error(String(res.status))
        const t = (await res.json()) as Terrain
        if (cancelled || !el.current) return
        const box = el.current

        const latMid = (t.lat0 + t.lat1) / 2
        const lonMid = (t.lon0 + t.lon1) / 2
        const mLat = 110540
        const mLon = 111320 * Math.cos((latMid * Math.PI) / 180)
        const toXZ = (lat: number, lon: number): [number, number] => [(lon - lonMid) * mLon, -(lat - latMid) * mLat]
        const hAt = (lat: number, lon: number): number => {
          const fc = ((lon - t.lon0) / (t.lon1 - t.lon0)) * (t.cols - 1)
          const fr = ((t.lat1 - lat) / (t.lat1 - t.lat0)) * (t.rows - 1)
          const c = Math.max(0, Math.min(t.cols - 2, Math.floor(fc)))
          const r = Math.max(0, Math.min(t.rows - 2, Math.floor(fr)))
          const u = Math.max(0, Math.min(1, fc - c))
          const v = Math.max(0, Math.min(1, fr - r))
          const at = (rr: number, cc: number) => {
            const x = t.h[rr * t.cols + cc]
            return x === t.water ? 0 : x / 10
          }
          return at(r, c) * (1 - u) * (1 - v) + at(r, c + 1) * u * (1 - v) + at(r + 1, c) * (1 - u) * v + at(r + 1, c + 1) * u * v
        }
        const yAt = (lat: number, lon: number) => hAt(lat, lon) * EXAG

        const scene = new THREE.Scene()
        scene.background = new THREE.Color('#dbeafe')
        const width = (t.lon1 - t.lon0) * mLon
        const depth = (t.lat1 - t.lat0) * mLat
        const span = Math.max(width, depth)
        const camera = new THREE.PerspectiveCamera(40, box.clientWidth / Math.max(1, box.clientHeight), 50, span * 6)
        camera.position.set(0, span * 0.5, span * 0.52)
        const renderer = new THREE.WebGLRenderer({ antialias: true })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
        renderer.setSize(box.clientWidth, box.clientHeight)
        renderer.domElement.style.touchAction = 'none'
        box.appendChild(renderer.domElement)
        const controls = new oc.OrbitControls(camera, renderer.domElement)
        controls.enableDamping = true
        controls.maxPolarAngle = Math.PI * 0.47
        controls.minDistance = 600
        controls.maxDistance = span * 2.2
        controls.target.set(0, 0, 0)

        scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9a7a, 1.15))
        const sun = new THREE.DirectionalLight(0xffffff, 1.3)
        sun.position.set(-span, span, span * 0.4)
        scene.add(sun)

        // 地形
        const pos = new Float32Array(t.cols * t.rows * 3)
        const col = new Float32Array(t.cols * t.rows * 3)
        for (let r = 0; r < t.rows; r++) {
          const lat = t.lat1 - ((t.lat1 - t.lat0) * r) / (t.rows - 1)
          for (let c = 0; c < t.cols; c++) {
            const lon = t.lon0 + ((t.lon1 - t.lon0) * c) / (t.cols - 1)
            const i = (r * t.cols + c) * 3
            const raw = t.h[r * t.cols + c]
            const m = raw === t.water ? 0 : raw / 10
            const [x, z] = toXZ(lat, lon)
            pos[i] = x
            pos[i + 1] = m * EXAG
            pos[i + 2] = z
            const [cr, cg, cb] = colorFor(m)
            col[i] = cr
            col[i + 1] = cg
            col[i + 2] = cb
          }
        }
        const idx: number[] = []
        for (let r = 0; r < t.rows - 1; r++) {
          for (let c = 0; c < t.cols - 1; c++) {
            const a = r * t.cols + c
            idx.push(a, a + t.cols, a + 1, a + 1, a + t.cols, a + t.cols + 1)
          }
        }
        const tg = new THREE.BufferGeometry()
        tg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
        tg.setAttribute('color', new THREE.BufferAttribute(col, 3))
        tg.setIndex(idx)
        tg.computeVertexNormals()
        scene.add(new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ vertexColors: true })))

        // 国道・県道（位置の手がかり）
        const roadMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthTest: false, depthWrite: false })
        for (const road of t.roads) {
          const pts = road.p.map(([lat, lon]) => {
            const [x, z] = toXZ(lat, lon)
            return [x, yAt(lat, lon) + 4, z] as [number, number, number]
          })
          const g = ribbon(THREE, pts, road.k === 'trunk' ? 34 : 20)
          if (!g) continue
          const mesh = new THREE.Mesh(g, roadMat)
          mesh.renderOrder = 1
          scene.add(mesh)
        }

        const layer = new THREE.Group()
        const busLayer = new THREE.Group()
        scene.add(layer, busLayer)
        // えらんだバス停の印
        const mark = new THREE.Mesh(new THREE.ConeGeometry(110, 260, 16), new THREE.MeshBasicMaterial({ color: 0xfacc15, depthTest: false }))
        mark.rotation.x = Math.PI
        mark.renderOrder = 4
        mark.visible = false
        scene.add(mark)

        // 現在地の印（青い玉と柱）
        const hereMark = new THREE.Mesh(new THREE.SphereGeometry(95, 20, 14), new THREE.MeshBasicMaterial({ color: 0x2563eb, depthTest: false }))
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 260, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }))
        pole.position.y = -130
        hereMark.add(pole)
        hereMark.renderOrder = 6
        hereMark.visible = false
        scene.add(hereMark)

        const w: World = { THREE, scene, camera, renderer, controls, layer, busLayer, toXZ, yAt, stopMesh: null, stopNames: [], mark, hereMark, span, buses: new Map() }
        world.current = w
        setCredit(t.credit)

        // バス停を押す（指を動かさずに離したときだけ）
        const ray = new THREE.Raycaster()
        let down: { x: number; y: number } | null = null
        const onDown = (e: PointerEvent) => {
          down = { x: e.clientX, y: e.clientY }
        }
        const onUp = (e: PointerEvent) => {
          if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8 || !w.stopMesh) return
          const rect = renderer.domElement.getBoundingClientRect()
          const v = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
          ray.setFromCamera(v, camera)
          const hit = ray.intersectObject(w.stopMesh)[0]
          if (hit && hit.instanceId != null) pickRef.current(w.stopNames[hit.instanceId])
        }
        renderer.domElement.addEventListener('pointerdown', onDown)
        renderer.domElement.addEventListener('pointerup', onUp)
        cleanups.push(() => {
          renderer.domElement.removeEventListener('pointerdown', onDown)
          renderer.domElement.removeEventListener('pointerup', onUp)
        })

        ro = new ResizeObserver(() => {
          const cw = box.clientWidth
          const ch = Math.max(1, box.clientHeight)
          renderer.setSize(cw, ch)
          camera.aspect = cw / ch
          camera.updateProjectionMatrix()
        })
        ro.observe(box)

        const loop = () => {
          raf = requestAnimationFrame(loop)
          const now = performance.now()
          for (const b of w.buses.values()) {
            const f = Math.min(1, (now - b.t0) / 1000) // 1秒かけて次の位置へ
            b.obj.position.lerpVectors(b.from, b.to, f)
          }
          controls.update()
          renderer.render(scene, camera)
        }
        loop()
        setReady(true)
      } catch {
        if (!cancelled) setError('立体の地図を表示できませんでした。「平面」でご利用ください。')
      }
    })()
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      ro?.disconnect()
      cleanups.forEach((fn) => fn())
      const w = world.current
      if (w) {
        disposeGroup(w.layer)
        disposeGroup(w.busLayer)
        w.controls.dispose()
        w.renderer.dispose()
        w.renderer.domElement.remove()
      }
      world.current = null
    }
  }, [])

  // 路線の帯とバス停（路線を選び直したら作り直す）
  useEffect(() => {
    const w = world.current
    if (!w || !ready) return
    const { THREE } = w
    disposeGroup(w.layer)
    for (const line of lines) {
      const pts = line.pts.map(([lat, lon]) => {
        const [x, z] = w.toXZ(lat, lon)
        return [x, w.yAt(lat, lon) + 9, z] as [number, number, number]
      })
      const g = ribbon(THREE, pts, 55)
      if (!g) continue
      const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(line.color), side: THREE.DoubleSide, depthTest: false, depthWrite: false }))
      mesh.renderOrder = 2
      w.layer.add(mesh)
    }
    const inst = new THREE.InstancedMesh(new THREE.CylinderGeometry(42, 42, 70, 14), new THREE.MeshLambertMaterial({ color: 0xffffff }), Math.max(1, stops.length))
    inst.count = stops.length
    const m4 = new THREE.Matrix4()
    const named = new Set<string>()
    stops.forEach((s, i) => {
      const [x, z] = w.toXZ(s.lat, s.lon)
      const y = w.yAt(s.lat, s.lon)
      m4.makeTranslation(x, y + 35, z)
      inst.setMatrixAt(i, m4)
      // 名前の札は、目印になるバス停（駅・病院・支所など）だけ。同じ名前は1つ
      if (/駅|病院|支所|市役所/.test(s.name) && !named.has(s.name)) {
        named.add(s.name)
        const sp = labelSprite(THREE, s.name, 'rgba(15,23,42,0.82)')
        sp.position.set(x, y + 330, z)
        w.layer.add(sp)
      }
    })
    inst.instanceMatrix.needsUpdate = true
    inst.renderOrder = 3
    w.layer.add(inst)
    w.stopMesh = inst
    w.stopNames = stops.map((s) => s.name)
  }, [ready, lines, stops])

  // えらんだバス停に印を立てる
  useEffect(() => {
    const w = world.current
    if (!w || !ready) return
    const s = selectedStop ? stops.find((x) => x.name === selectedStop) : null
    w.mark.visible = !!s
    if (s) {
      const [x, z] = w.toXZ(s.lat, s.lon)
      w.mark.position.set(x, w.yAt(s.lat, s.lon) + 230, z)
    }
  }, [ready, selectedStop, stops])

  // 現在地が分かっていれば、そこを中心に近づいた視点にする（開いたとき・「現在地」を押したとき）
  useEffect(() => {
    const w = world.current
    if (!w || !ready) return
    w.hereMark.visible = !!here
    if (!here) return
    const [x, z] = w.toXZ(here[0], here[1])
    const y = w.yAt(here[0], here[1])
    w.hereMark.position.set(x, y + 300, z)
    w.controls.target.set(x, y, z)
    w.camera.position.set(x, y + 2300, z + 2600)
  }, [ready, here, focusN])

  // 「全体」：はじめの視点へ戻す
  useEffect(() => {
    const w = world.current
    if (!w || !ready || resetN === 0) return
    w.controls.target.set(0, 0, 0)
    w.camera.position.set(0, w.span * 0.5, w.span * 0.52)
  }, [ready, resetN])

  // バスを動かす（1秒ごとに届く位置へ、なめらかに寄せる）
  useEffect(() => {
    const w = world.current
    if (!w || !ready) return
    const { THREE } = w
    const seen = new Set<string>()
    const now = performance.now()
    for (const b of buses) {
      seen.add(b.id)
      const [x, z] = w.toXZ(b.lat, b.lon)
      const to = new THREE.Vector3(x, w.yAt(b.lat, b.lon) + 60, z)
      const cur = w.buses.get(b.id)
      if (cur) {
        cur.from.copy(cur.obj.position)
        cur.to.copy(to)
        cur.t0 = now
        const dx = to.x - cur.from.x
        const dz = to.z - cur.from.z
        if (Math.hypot(dx, dz) > 1) cur.obj.children[0].rotation.y = Math.atan2(-dz, dx)
      } else {
        const g = new THREE.Group()
        const body = new THREE.Mesh(new THREE.BoxGeometry(230, 90, 100), new THREE.MeshLambertMaterial({ color: new THREE.Color(b.color) }))
        const roof = new THREE.Mesh(new THREE.BoxGeometry(236, 14, 106), new THREE.MeshLambertMaterial({ color: 0xffffff }))
        roof.position.y = 52
        body.add(roof)
        body.renderOrder = 4
        g.add(body)
        const sp = labelSprite(THREE, '🚌 ' + b.label, 'rgba(180,83,9,0.9)')
        sp.position.y = 260
        g.add(sp)
        g.position.copy(to)
        w.busLayer.add(g)
        w.buses.set(b.id, { obj: g, from: to.clone(), to: to.clone(), t0: now })
      }
    }
    for (const [id, b] of w.buses) {
      if (seen.has(id)) continue
      const tmp = new THREE.Group()
      tmp.add(b.obj)
      disposeGroup(tmp)
      w.busLayer.remove(b.obj)
      w.buses.delete(id)
    }
  }, [ready, buses])

  return (
    <div className="space-y-1">
      {error ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{error}</p> : null}
      <div ref={el} data-testid="bus-3d" className="relative h-[55vh] min-h-[320px] w-full overflow-hidden rounded-lg border border-slate-300 bg-sky-100 dark:border-slate-700">
        {!ready && !error ? <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-600">立体の地図を準備しています…</p> : null}
      </div>
      <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        1本指でまわす・2本指でひろげる／うごかす。白い丸い柱がバス停です（押すと下に時刻表）。土地の高さは約{EXAG}倍に強調しています。水色は標高{LOW_M}m未満の低い土地や水面です。青い玉は現在地です（この端末の中だけで使い、どこにも送りません）。{credit}
      </p>
    </div>
  )
}
