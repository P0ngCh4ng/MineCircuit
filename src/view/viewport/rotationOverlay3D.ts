// 3D表示の「回転」（docs/ui.md「回転の表示」）。
// - 箱：計算で回るとしたブロックを、速さの段階の色の半透明の箱で包む
// - 輪：力の流れ（#207）を出したブロックのうち回っているものに、回る向きを示す輪の矢印を軸に垂直に付ける。
//   輪はブロックより少し大きく、軸の正の向きから見て、正の回転数なら反時計回りに見える（Create と同じ向き）。裏から見れば逆回りに見える
// - 流れ：選んだブロックからの力の流れの矢印（#207）。ブロックの中心どうしを結ぶ棒と、真ん中の矢じり。ブロックに隠れないよう手前に描く
// BlueprintScene とは別の THREE.Group にして、Viewport3D がシーンに足す。

import * as THREE from 'three'
import type { CalcRotation } from '../../calc/calcPlugin'
import type { FlowTrace } from '../../calc/flowTrace'
import { layerVisibility, SHOW_ALL_LAYERS, type LayerDisplay } from '../layers/layerDisplay'
import { FLOW_COLORS } from './layerRenderer2D'
import { ROTATION_COLORS, rotationColorKey, showsDirection } from './rotationColors'

/** 輪の矢印の絵（白。色は1つずつ掛ける）。canvas が使えない環境（テスト）では null */
function ringTexture(): THREE.CanvasTexture | null {
  const canvas = typeof document === 'undefined' ? null : document.createElement('canvas')
  const ctx = canvas?.getContext('2d') ?? null
  if (!canvas || !ctx) return null
  const size = 128
  canvas.width = size
  canvas.height = size
  const c = size / 2
  const r = size * 0.4
  // 画面で反時計回りに 300 度（canvas は y が下向きなので、角度を減らす向き）
  const start = 0
  const end = -(300 * Math.PI) / 180
  // 終わりに矢じり。進む向きは、角度を減らす向きの接線
  const ex = c + r * Math.cos(end)
  const ey = c + r * Math.sin(end)
  const tx = Math.sin(end)
  const ty = -Math.cos(end)
  const nx = Math.cos(end)
  const ny = Math.sin(end)
  const head = size * 0.15
  const draw = (color: string, width: number, grow: number): void => {
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.arc(c, c, r, start, end, true)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(ex + tx * (head + grow), ey + ty * (head + grow))
    ctx.lineTo(ex + nx * (head * 0.8 + grow), ey + ny * (head * 0.8 + grow))
    ctx.lineTo(ex - nx * (head * 0.8 + grow), ey - ny * (head * 0.8 + grow))
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }
  // 暗い縁取りの上に白で描く（色は1つずつ掛けるので、縁は暗いまま、中は速さの色になる）
  draw('#000000', size * 0.13, size * 0.03)
  draw('#ffffff', size * 0.07, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * 輪の矢印の置き方。板の表（+z）を軸の正の向きへ向け、ブロックの中心に置く。
 * 負の回転数なら絵を左右に返して、軸の正の向きから見て時計回りにする
 */
export function ringMatrix(r: CalcRotation, out = new THREE.Matrix4()): THREE.Matrix4 {
  const rotate = new THREE.Matrix4()
  if (r.axis === 'x') rotate.makeRotationY(Math.PI / 2)
  else if (r.axis === 'y') rotate.makeRotationX(-Math.PI / 2)
  const mirror = new THREE.Matrix4().makeScale(r.rpm < 0 ? -1 : 1, 1, 1)
  return out.makeTranslation(r.pos[0] + 0.5, r.pos[1] + 0.5, r.pos[2] + 0.5).multiply(rotate).multiply(mirror)
}

export class RotationOverlay3D {
  readonly group = new THREE.Group()

  private readonly boxGeometry = new THREE.BoxGeometry(1.04, 1.04, 1.04)
  private readonly boxMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false })
  private readonly ringGeometry = new THREE.PlaneGeometry(1.7, 1.7)
  private readonly ringTexture = ringTexture()
  private readonly ringMaterial: THREE.MeshBasicMaterial | null
  private readonly shaftGeometry = new THREE.CylinderGeometry(0.06, 0.06, 1, 8)
  private readonly headGeometry = new THREE.ConeGeometry(0.2, 0.42, 12)
  private readonly flowMaterial = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false })
  private boxes: THREE.InstancedMesh | null = null
  private rings: THREE.InstancedMesh | null = null
  private shafts: THREE.InstancedMesh | null = null
  private heads: THREE.InstancedMesh | null = null

  constructor() {
    this.group.name = 'rotation-overlay'
    this.ringMaterial = this.ringTexture
      ? new THREE.MeshBasicMaterial({
          map: this.ringTexture,
          transparent: true,
          alphaTest: 0.1,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      : null
  }

  /** 出す回転。空なら何も出さない（「回転」を切ったとき）。flow は選んだブロックからの力の流れ（#207） */
  update(rotations: readonly CalcRotation[], display: LayerDisplay = SHOW_ALL_LAYERS, flow: FlowTrace | null = null): void {
    this.clear()
    const shown = rotations.filter((r) => layerVisibility(display, r.pos[1]) !== 'hidden')
    if (shown.length === 0) return
    if (flow) this.addFlow(flow, display)

    const m = new THREE.Matrix4()
    const color = new THREE.Color()
    const boxes = new THREE.InstancedMesh(this.boxGeometry, this.boxMaterial, shown.length)
    boxes.name = 'rotation-boxes'
    boxes.renderOrder = 5
    boxes.raycast = () => {}
    shown.forEach((r, i) => {
      m.makeTranslation(r.pos[0] + 0.5, r.pos[1] + 0.5, r.pos[2] + 0.5)
      boxes.setMatrixAt(i, m)
      boxes.setColorAt(i, color.set(ROTATION_COLORS[rotationColorKey(r)]))
    })
    boxes.instanceMatrix.needsUpdate = true
    if (boxes.instanceColor) boxes.instanceColor.needsUpdate = true
    this.group.add(boxes)
    this.boxes = boxes

    const traced = new Set(flow?.blocks.map((p) => p.join(',')) ?? [])
    const turning = shown.filter((r) => showsDirection(r) && traced.has(r.pos.join(',')))
    if (!this.ringMaterial || turning.length === 0) return
    const rings = new THREE.InstancedMesh(this.ringGeometry, this.ringMaterial, turning.length)
    rings.name = 'rotation-rings'
    rings.renderOrder = 6
    rings.raycast = () => {}
    turning.forEach((r, i) => {
      rings.setMatrixAt(i, ringMatrix(r, m))
      rings.setColorAt(i, color.set(ROTATION_COLORS[rotationColorKey(r)]))
    })
    rings.instanceMatrix.needsUpdate = true
    if (rings.instanceColor) rings.instanceColor.needsUpdate = true
    this.group.add(rings)
    this.rings = rings
  }

  /** 出している箱・輪・流れの矢印の数（テストと状態の確認用） */
  count(): { boxes: number; rings: number; arrows: number } {
    return { boxes: this.boxes?.count ?? 0, rings: this.rings?.count ?? 0, arrows: this.heads?.count ?? 0 }
  }

  /** 力の流れの矢印。どちらかの端が見えている段にあれば描く */
  private addFlow(flow: FlowTrace, display: LayerDisplay): void {
    const arrows = flow.arrows.filter(
      (a) => layerVisibility(display, a.from[1]) !== 'hidden' || layerVisibility(display, a.to[1]) !== 'hidden',
    )
    if (arrows.length === 0) return
    const shafts = new THREE.InstancedMesh(this.shaftGeometry, this.flowMaterial, arrows.length)
    const heads = new THREE.InstancedMesh(this.headGeometry, this.flowMaterial, arrows.length)
    shafts.name = 'flow-shafts'
    heads.name = 'flow-heads'
    const up = new THREE.Vector3(0, 1, 0)
    const from = new THREE.Vector3()
    const to = new THREE.Vector3()
    const dir = new THREE.Vector3()
    const q = new THREE.Quaternion()
    const m = new THREE.Matrix4()
    const color = new THREE.Color()
    arrows.forEach((a, i) => {
      from.set(a.from[0] + 0.5, a.from[1] + 0.5, a.from[2] + 0.5)
      to.set(a.to[0] + 0.5, a.to[1] + 0.5, a.to[2] + 0.5)
      dir.subVectors(to, from)
      const length = dir.length()
      dir.normalize()
      q.setFromUnitVectors(up, dir)
      const mid = from.clone().add(to).multiplyScalar(0.5)
      shafts.setMatrixAt(i, m.compose(mid, q, new THREE.Vector3(1, length, 1)))
      heads.setMatrixAt(i, m.compose(mid.addScaledVector(dir, 0.1), q, new THREE.Vector3(1, 1, 1)))
      color.set(FLOW_COLORS[a.kind])
      shafts.setColorAt(i, color)
      heads.setColorAt(i, color)
    })
    for (const mesh of [shafts, heads]) {
      mesh.renderOrder = 7
      mesh.raycast = () => {}
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      this.group.add(mesh)
    }
    this.shafts = shafts
    this.heads = heads
  }

  dispose(): void {
    this.clear()
    this.boxGeometry.dispose()
    this.boxMaterial.dispose()
    this.ringGeometry.dispose()
    this.ringMaterial?.dispose()
    this.ringTexture?.dispose()
    this.shaftGeometry.dispose()
    this.headGeometry.dispose()
    this.flowMaterial.dispose()
    this.group.removeFromParent()
  }

  private clear(): void {
    for (const mesh of [this.boxes, this.rings, this.shafts, this.heads]) {
      mesh?.removeFromParent()
      mesh?.dispose()
    }
    this.boxes = null
    this.rings = null
    this.shafts = null
    this.heads = null
  }
}
