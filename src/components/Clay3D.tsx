import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export type ClayMood = 'idle' | 'connecting' | 'listening' | 'talking'
export type ClayShape = 'cube' | 'bean' | 'egg' | 'hexagon' | 'pentagon'
export type ClayTexture = 'felt' | 'clay' | 'speckle'

// ---------- procedural surface textures ----------

/** Tileable value noise on an n×n grid, summed over a few octaves; returns heights in 0–1. */
function noiseField(n: number, base: number, octaves: number, seed: number) {
  let s = seed
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  const out = new Float32Array(n * n)
  let amp = 1
  let total = 0
  for (let o = 0, cells = base; o < octaves; o++, cells *= 2, amp *= 0.5) {
    const grid = Array.from({ length: cells * cells }, rand)
    const at = (x: number, y: number) => grid[((y + cells) % cells) * cells + ((x + cells) % cells)]
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const gx = (x / n) * cells
        const gy = (y / n) * cells
        const x0 = Math.floor(gx)
        const y0 = Math.floor(gy)
        const fx = gx - x0
        const fy = gy - y0
        const sx = fx * fx * (3 - 2 * fx)
        const sy = fy * fy * (3 - 2 * fy)
        const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx
        const bot = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx
        out[y * n + x] += amp * (top * (1 - sy) + bot * sy)
      }
    }
    total += amp
  }
  for (let i = 0; i < out.length; i++) out[i] /= total
  return out
}

/** Turns a height field into a tangent-space normal map. */
function normalMap(h: Float32Array, n: number, strength: number) {
  const c = document.createElement('canvas')
  c.width = c.height = n
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(n, n)
  const at = (x: number, y: number) => h[((y + n) % n) * n + ((x + n) % n)]
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength
      const len = Math.hypot(dx, dy, 1)
      const i = (y * n + x) * 4
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255
      img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255
      img.data[i + 2] = (1 / len) * 255
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return c
}

/**
 * A polygon with rounded corners, flat edge on top (so the hat sits level), extruded into a soft slab with deep
 * rounded bevels. Vertices are merged so the bevels shade smoothly.
 */
function softPolygon(sides: number, radius: number, corner: number, depth: number): THREE.BufferGeometry {
  // Rotate so an edge, not a corner, is at the top.
  const start = Math.PI / 2 + Math.PI / sides
  const v = Array.from({ length: sides }, (_, i) => new THREE.Vector2(Math.cos(start + (i * 2 * Math.PI) / sides) * radius, Math.sin(start + (i * 2 * Math.PI) / sides) * radius))
  const shape = new THREE.Shape()
  v.forEach((p, i) => {
    const prev = v[(i - 1 + sides) % sides]
    const next = v[(i + 1) % sides]
    const a = p.clone().add(prev.clone().sub(p).setLength(corner))
    const b = p.clone().add(next.clone().sub(p).setLength(corner))
    if (i === 0) shape.moveTo(a.x, a.y)
    else shape.lineTo(a.x, a.y)
    shape.quadraticCurveTo(p.x, p.y, b.x, b.y)
  })
  shape.closePath()
  let g: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.26, bevelSize: 0.14, bevelSegments: 12, curveSegments: 16 })
  g.center()
  g.deleteAttribute('normal')
  g = mergeVertices(g, 1e-4)
  g.computeVertexNormals()
  // Extrude UVs are in world units; scale them to roughly 0–1 so textures tile like on the other shapes.
  const uv = g.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 1.9, uv.getY(i) / 1.9)
  return g
}

const tex = (c: HTMLCanvasElement, repeat: number, color = false) => {
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat, repeat)
  t.anisotropy = 4
  if (color) t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** The body's material for each finish. All are matte; they differ in what the surface feels like. */
function bodyMaterial(kind: ClayTexture): THREE.MeshPhysicalMaterial {
  const yellow = new THREE.Color(0xffd31a)
  if (kind === 'felt') {
    // Plush felt: fine fibres in the normal map, and a velvet sheen that glows at the edges.
    const fibres = noiseField(256, 64, 2, 7)
    return new THREE.MeshPhysicalMaterial({ color: yellow, roughness: 1, normalMap: tex(normalMap(fibres, 256, 3.5), 3), normalScale: new THREE.Vector2(0.55, 0.55), sheen: 0.8, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffe066), envMapIntensity: 0.35 })
  }
  if (kind === 'clay') {
    // Hand-made clay: soft, low bumps plus a little grain.
    const bumps = noiseField(256, 6, 4, 11)
    return new THREE.MeshPhysicalMaterial({ color: yellow, roughness: 0.78, normalMap: tex(normalMap(bumps, 256, 9), 1.5), normalScale: new THREE.Vector2(0.6, 0.6), envMapIntensity: 0.45 })
  }
  // Speckled ceramic: matte glaze with small dark flecks.
  const n = 512
  const c = document.createElement('canvas')
  c.width = c.height = n
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#ffd31a'
  ctx.fillRect(0, 0, n, n)
  let seed = 3
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 420; i++) {
    const r = 1.6 + rand() * (rand() < 0.1 ? 4 : 2)
    ctx.fillStyle = rand() < 0.85 ? `rgba(70,45,10,${0.35 + rand() * 0.45})` : 'rgba(255,248,220,0.7)'
    ctx.beginPath()
    ctx.arc(rand() * n, rand() * n, r, 0, Math.PI * 2)
    ctx.fill()
  }
  const glaze = noiseField(256, 8, 3, 5)
  return new THREE.MeshPhysicalMaterial({ map: tex(c, 1.2, true), roughness: 0.7, normalMap: tex(normalMap(glaze, 256, 3), 1.5), normalScale: new THREE.Vector2(0.25, 0.25), envMapIntensity: 0.5 })
}

/**
 * Clay, the desk's voice buddy, rendered in real 3D: a matte yellow body in a little top hat and a satin bowtie.
 * He turns toward the cursor, blinks, floats, and his mouth opens with his voice (`level`, 0–1).
 */
export function Clay3D({ size = 64, level = 0, mood = 'idle', shape = 'hexagon', texture = 'clay' }: { size?: number; level?: number; mood?: ClayMood; shape?: ClayShape; texture?: ClayTexture }) {
  const host = useRef<HTMLDivElement>(null)
  const live = useRef({ level, mood })
  useEffect(() => {
    live.current = { level, mood }
  }, [level, mood])

  useEffect(() => {
    const el = host.current
    if (!el) return
    const w = size
    const h = Math.round(size * 1.38)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(w, h)
    // Neutral tone mapping keeps the yellow saturated (ACES washes it towards cream).
    renderer.toneMapping = THREE.NeutralToneMapping
    renderer.toneMappingExposure = 1
    renderer.outputColorSpace = THREE.SRGBColorSpace
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const pmrem = new THREE.PMREMGenerator(renderer)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env

    const camera = new THREE.PerspectiveCamera(26, w / h, 0.1, 50)
    // Framed with headroom so the hat stays in view as he floats and turns.
    camera.position.set(0, 1, 7.6)
    camera.lookAt(0, 0.24, 0)

    const key = new THREE.DirectionalLight(0xffffff, 2.1)
    key.position.set(-2.5, 3.5, 4)
    const fill = new THREE.DirectionalLight(0xffe2a8, 0.5)
    fill.position.set(3, -1, 3)
    const rim = new THREE.DirectionalLight(0xffffff, 2.2)
    rim.position.set(2.5, 2.5, -3.5)
    scene.add(key, fill, rim)

    // ---------- materials ----------
    const yellow = bodyMaterial(texture)
    const ink = new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.7 })
    const felt = new THREE.MeshPhysicalMaterial({ color: 0x121214, roughness: 0.95, sheen: 0.6, sheenRoughness: 0.6, sheenColor: new THREE.Color(0x4a4a52), envMapIntensity: 0.3 })
    const satin = new THREE.MeshPhysicalMaterial({ color: 0x0e0e10, roughness: 0.65, sheen: 0.7, sheenRoughness: 0.5, sheenColor: new THREE.Color(0x3a3a42), envMapIntensity: 0.4 })
    const mouthMat = new THREE.MeshStandardMaterial({ color: 0x3a1416, roughness: 0.7 })

    // ---------- body ----------
    let bodyGeo: THREE.BufferGeometry
    if (shape === 'cube') bodyGeo = new RoundedBoxGeometry(1.75, 1.6, 1.4, 10, 0.58)
    else if (shape === 'bean') {
      bodyGeo = new THREE.CapsuleGeometry(0.8, 0.5, 24, 64)
      bodyGeo.scale(1.02, 0.92, 0.9)
    } else if (shape === 'hexagon') bodyGeo = softPolygon(6, 0.95, 0.16, 0.72)
    else if (shape === 'pentagon') {
      bodyGeo = softPolygon(5, 1.02, 0.17, 0.72)
      bodyGeo.translate(0, 0.08, 0) // the point-down pentagon carries its weight low; lift it to centre
    } else {
      // Egg: wider low down, narrower at the top.
      const pts: THREE.Vector2[] = []
      for (let i = 0; i <= 64; i++) {
        const y = -1 + (2 * i) / 64
        pts.push(new THREE.Vector2(0.9 * Math.sqrt(Math.max(0, 1 - y * y)) * (1 - 0.16 * y), y * 0.98))
      }
      bodyGeo = new THREE.LatheGeometry(pts, 96)
    }
    if (shape !== 'hexagon' && shape !== 'pentagon') bodyGeo.computeVertexNormals()
    const body = new THREE.Mesh(bodyGeo, yellow)
    const rig = new THREE.Group() // turns toward the cursor
    const bob = new THREE.Group() // floats and squashes
    bob.add(rig)
    rig.add(body)
    scene.add(bob)
    bodyGeo.computeBoundingBox()
    const bottom = bodyGeo.boundingBox!.min.y

    // Puts a feature on the body's front surface at (x, y), facing outward along the surface normal.
    const ray = new THREE.Raycaster()
    const onSurface = (obj: THREE.Object3D, x: number, y: number, lift: number) => {
      ray.set(new THREE.Vector3(x, y, 5), new THREE.Vector3(0, 0, -1))
      const hit = ray.intersectObject(body)[0]
      const p = hit ? hit.point : new THREE.Vector3(x, y, 0.7)
      const n = hit?.face ? hit.face.normal.clone() : new THREE.Vector3(0, 0, 1)
      obj.position.copy(p).addScaledVector(n, lift)
      obj.lookAt(obj.position.clone().add(n))
      rig.add(obj)
      return { p, n }
    }

    // ---------- face ----------
    const eyeGeo = new THREE.SphereGeometry(0.12, 32, 24)
    const eyes: THREE.Group[] = []
    for (const x of [-0.3, 0.3]) {
      const g = new THREE.Group()
      // Plain eyes: simple dark ovals, no highlights.
      const eye = new THREE.Mesh(eyeGeo, ink)
      eye.scale.set(0.8, 1.15, 0.45)
      const pupil = new THREE.Group()
      pupil.add(eye)
      g.add(pupil)
      g.userData.pupil = pupil
      onSurface(g, x, 0.14, 0.02)
      eyes.push(g)
    }

    // A little top hat, tilted at a jaunty angle, with a satin band.
    const top = bodyGeo.boundingBox!.max.y
    const hatX = 0.08
    const hat = new THREE.Group()
    const brimProfile = [new THREE.Vector2(0, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0.56, 0.02), new THREE.Vector2(0.56, 0.05), new THREE.Vector2(0.5, 0.07), new THREE.Vector2(0, 0.07)]
    const brim = new THREE.Mesh(new THREE.LatheGeometry(brimProfile, 64), felt)
    const crownGeo = new THREE.CylinderGeometry(0.31, 0.34, 0.52, 64, 1)
    crownGeo.translate(0, 0.33, 0)
    const crownMesh = new THREE.Mesh(crownGeo, felt)
    const cap = new THREE.Mesh(new THREE.TorusGeometry(0.295, 0.02, 12, 64), felt)
    cap.rotation.x = Math.PI / 2
    cap.position.y = 0.585
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.343, 0.35, 0.1, 64, 1, true), satin)
    band.position.y = 0.13
    hat.add(brim, crownMesh, cap, band)
    // Seat it on the real top surface: sample the head under the whole brim, allow for the tilt (the brim dips
    // to the right and front), and rest it just above the highest point so no part of him pokes through.
    const tiltX = 0.06
    const tiltZ = -0.06
    const reach = 0.56 * 0.92 + 0.03
    let rest = -Infinity
    for (let a = 0; a < 24; a++) {
      for (const r of [0, 0.2, 0.4, reach]) {
        const dx = Math.cos((a / 24) * Math.PI * 2) * r
        const dz = Math.sin((a / 24) * Math.PI * 2) * r
        ray.set(new THREE.Vector3(hatX + dx, 5, 0.02 + dz), new THREE.Vector3(0, -1, 0))
        const hit = ray.intersectObject(body)[0]
        if (hit) rest = Math.max(rest, hit.point.y - dx * Math.sin(tiltZ) + dz * Math.sin(tiltX))
      }
    }
    hat.position.set(hatX, (Number.isFinite(rest) ? rest : top) - 0.055, 0.02)
    hat.rotation.set(tiltX, 0, tiltZ)
    hat.scale.setScalar(0.92)
    rig.add(hat)

    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.017, 12, 32, Math.PI), ink)
    smile.rotation.z = Math.PI
    const smileHolder = new THREE.Group()
    smileHolder.add(smile)
    onSurface(smileHolder, 0, -0.08, 0.025)
    const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.075, 24, 16), mouthMat)
    mouth.scale.set(1, 0.4, 0.4)
    onSurface(mouth, 0, -0.1, 0.02)

    // ---------- bowtie ----------
    const wing = new THREE.Shape()
    wing.moveTo(0, 0)
    wing.bezierCurveTo(0.08, 0.1, 0.24, 0.2, 0.32, 0.16)
    wing.bezierCurveTo(0.37, 0.06, 0.37, -0.06, 0.32, -0.16)
    wing.bezierCurveTo(0.24, -0.2, 0.08, -0.1, 0, 0)
    const wingGeo = new THREE.ExtrudeGeometry(wing, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.03, bevelSegments: 6, curveSegments: 24 })
    wingGeo.translate(0, 0, -0.035)
    const bow = new THREE.Group()
    const right = new THREE.Mesh(wingGeo, satin)
    const left = new THREE.Mesh(wingGeo, satin)
    left.scale.x = -1
    const knot = new THREE.Mesh(new RoundedBoxGeometry(0.13, 0.15, 0.13, 4, 0.045), satin)
    bow.add(left, right, knot)
    bow.scale.setScalar(0.82)
    onSurface(bow, 0, bottom * 0.6, 0.06)

    // Soft contact shadow under him.
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const ctx = c.getContext('2d')!
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
    grad.addColorStop(0, 'rgba(0,0,0,0.55)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 128, 128)
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1.3), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity: 0.7 }))
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = bottom - 0.08
    scene.add(shadow)

    // ---------- motion ----------
    const mouse = { x: 0, y: 0 }
    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect()
      mouse.x = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / 420))
      mouse.y = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / 420))
    }
    window.addEventListener('mousemove', onMove)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let raf = 0
    let nextBlink = 2 + Math.random() * 3
    const start = performance.now()
    const tick = () => {
      raf = requestAnimationFrame(tick)
      if (document.hidden) return
      const t = (performance.now() - start) / 1000
      const { mood: m, level: lv } = live.current
      const talking = m === 'talking' && lv > 0.04

      let ty = mouse.x * 0.5
      let tx = mouse.y * 0.28
      if (m === 'connecting') {
        ty = Math.sin(t * 2.2) * 0.45
        tx = -0.05
      }
      if (m === 'listening') tx += Math.sin(t * 3.4) * 0.06
      rig.rotation.y += (ty - rig.rotation.y) * 0.08
      rig.rotation.x += (tx - rig.rotation.x) * 0.08

      if (!reduced) {
        const float = Math.sin(t * 1.7) * 0.045 + (talking ? lv * 0.05 : 0)
        bob.position.y = float
        const sq = 1 + Math.sin(t * 1.7 + Math.PI / 2) * 0.012
        bob.scale.set(1 / sq, sq, 1 / sq)
      }

      // Blink every few seconds.
      if (t > nextBlink) nextBlink = t + 3.2 + Math.random() * 3
      const since = t - (nextBlink - 3.2)
      const lid = since < 0.14 && since > 0 ? Math.max(0.12, Math.abs(1 - since / 0.07)) : 1
      for (const g of eyes) {
        g.scale.y = lid
        const pupil = g.userData.pupil as THREE.Group
        pupil.position.x = mouse.x * 0.03
        pupil.position.y = -mouse.y * 0.025
      }

      smile.visible = !talking
      mouth.visible = talking
      if (talking) mouth.scale.set(1 + lv * 0.25, 0.35 + lv * 1.1, 0.4)
      shadow.scale.setScalar(1 - bob.position.y * 0.8)

      renderer.render(scene, camera)
    }
    tick()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('mousemove', onMove)
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
      })
      for (const mat of [yellow, ink, felt, satin, mouthMat]) {
        for (const t of [(mat as THREE.MeshPhysicalMaterial).map, (mat as THREE.MeshPhysicalMaterial).normalMap]) t?.dispose()
        mat.dispose()
      }
      env.dispose()
      pmrem.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [size, shape, texture])

  return <div ref={host} style={{ width: size, height: Math.round(size * 1.38) }} aria-hidden="true" />
}
